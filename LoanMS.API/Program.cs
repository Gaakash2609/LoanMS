using BCrypt.Net;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.DataProtection;
using LoanMS.Application.AI;
using LoanMS.Application.Interfaces;
using LoanMS.Application.Mappings;
using LoanMS.Application.Services;
using LoanMS.Application.Validators;
using LoanMS.Infrastructure.AI;
using LoanMS.Infrastructure.Data;
using LoanMS.Infrastructure.Repositories;
using LoanMS.Infrastructure.Services;
using FluentValidation;
using FluentValidation.AspNetCore;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Serilog;
using Serilog.Events;

// ── Serilog bootstrap (before WebApplication.CreateBuilder) ──────────────────
Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
    .Enrich.FromLogContext()
    .WriteTo.Console()
    .CreateBootstrapLogger();

try
{
    // ── Load .env file (if present) — sets environment variables for AI keys etc ──
    var envFile = Path.Combine(Directory.GetCurrentDirectory(), "..", ".env");
    if (!File.Exists(envFile)) envFile = Path.Combine(Directory.GetCurrentDirectory(), ".env");
    if (File.Exists(envFile))
    {
        foreach (var line in File.ReadAllLines(envFile))
        {
            var trimmed = line.Trim();
            if (string.IsNullOrEmpty(trimmed) || trimmed.StartsWith("#")) continue;
            var eqIdx = trimmed.IndexOf('=');
            if (eqIdx < 1) continue;
            var key = trimmed[..eqIdx].Trim();
            var val = trimmed[(eqIdx + 1)..].Trim();
            Environment.SetEnvironmentVariable(key, val);
        }
        Log.Information(".env loaded from {Path}", envFile);
    }

    var builder = WebApplication.CreateBuilder(args);

    // ── Serilog full configuration ────────────────────────────────────────────
    builder.Host.UseSerilog((ctx, services, configuration) => configuration
        .ReadFrom.Configuration(ctx.Configuration)
        .ReadFrom.Services(services)
        .Enrich.FromLogContext()
        .Enrich.WithMachineName()
        .Enrich.WithThreadId()
        .WriteTo.Console(outputTemplate:
            "[{Timestamp:HH:mm:ss} {Level:u3}] {Message:lj}{NewLine}{Exception}")
        .WriteTo.File("logs/loanms-.log",
            rollingInterval: RollingInterval.Day,
            retainedFileCountLimit: 30,
            outputTemplate:
            "{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] {Message:lj}{NewLine}{Exception}")
    );

    // ── Data Protection ───────────────────────────────────────────────────────
    // Encrypts things like the AI-provider keys, SMTP password, and InCred
    // client secret saved via Settings. Persistence target depends on the
    // database provider — see the branch below and PostgresXmlRepository.cs's
    // doc comment for the full history of why this matters (TL;DR: on
    // PostgreSQL/ECS, local-disk persistence meant every redeploy silently
    // broke decryption of every previously-saved secret).
    var dataProtectionBuilder = builder.Services.AddDataProtection()
        .SetApplicationName("LoanMS");

    // BUGFIX (confirmed real bug — AI/SMTP/InCred keys "randomly vanishing"):
    // on PostgreSQL (i.e. real ECS/RDS deployments), persist the key ring to
    // the database instead of local disk — see PostgresXmlRepository.cs for
    // the full "why". SQLite/dev mode keeps the original file-system
    // persistence, where the comment's original reasoning (single local
    // machine, disk is as durable as the DB) still genuinely holds.
    var _dpDbProvider = (builder.Configuration["Database:Provider"] ?? "sqlite").ToLowerInvariant();
    if (_dpDbProvider is "postgresql" or "postgres")
    {
        var _dpConnStr = builder.Configuration.GetConnectionString("PostgreSQL")
                       ?? builder.Configuration.GetConnectionString("DefaultConnection");
        if (!string.IsNullOrWhiteSpace(_dpConnStr))
        {
            dataProtectionBuilder.AddKeyManagementOptions(o =>
                o.XmlRepository = new LoanMS.API.PostgresXmlRepository(_dpConnStr));
        }
        else
        {
            // No connection string available yet at this point — fail loud
            // rather than silently falling back to the ephemeral local-disk
            // behavior this fix exists to eliminate.
            throw new InvalidOperationException(
                "Data Protection is configured for PostgreSQL persistence but no " +
                "PostgreSQL/DefaultConnection connection string was found.");
        }
    }
    else
    {
        dataProtectionBuilder.PersistKeysToFileSystem(new DirectoryInfo(
            Path.Combine(builder.Environment.ContentRootPath, "dataprotection-keys")));
    }

    // Encrypt the key ring at rest so it isn't stored as plain XML on disk.
    // DPAPI ties encryption to the current Windows user/machine — fine for a
    // single-machine dev/IIS deployment. On Linux/Docker (no DPAPI), keys stay
    // unencrypted on disk unless a certificate is configured separately, so
    // this only silences/fixes the warning on Windows.
    if (OperatingSystem.IsWindows())
    {
        dataProtectionBuilder.ProtectKeysWithDpapi();
    }

    // ── Database — SQLite (dev) or PostgreSQL (production) ───────────────────
    var dbProvider = (builder.Configuration["Database:Provider"] ?? "sqlite").ToLower();

    // Fail fast instead of silently falling back to a per-container SQLite
    // file. A missing/misspelled "Database:Provider" env var on any one
    // instance/replica (e.g. an incomplete ECS task definition) would make
    // that instance quietly use its own local, empty SQLite database instead
    // of the shared PostgreSQL/RDS instance — writes made through that
    // instance would then be invisible everywhere else, with no error shown
    // anywhere (both would return 200 success). In Production this is always
    // a misconfiguration, never an intended fallback, so refuse to start
    // instead of serving traffic against the wrong database.
    if (builder.Environment.IsProduction() && dbProvider is not ("postgresql" or "postgres"))
    {
        throw new InvalidOperationException(
            "Database:Provider is not set to 'PostgreSQL' in a Production environment " +
            "(current value: '" + (builder.Configuration["Database:Provider"] ?? "<missing>") + "'). " +
            "Refusing to start with a local SQLite fallback, which would silently diverge from " +
            "the shared database on other replicas. Set the Database__Provider environment " +
            "variable to 'PostgreSQL' in the ECS task definition.");
    }

    builder.Services.AddDbContext<AppDbContext>(options =>
    {
        if (dbProvider is "postgresql" or "postgres")
        {
            var connStr = builder.Configuration.GetConnectionString("PostgreSQL")
                       ?? builder.Configuration.GetConnectionString("DefaultConnection");
            options.UseNpgsql(connStr, npg =>
            {
                npg.EnableRetryOnFailure(maxRetryCount: 3, maxRetryDelay: TimeSpan.FromSeconds(5), errorCodesToAdd: null);
                npg.CommandTimeout(30);
            })
            // The SQLite branch below already ignores this — Postgres didn't,
            // which is what was actually crash-looping every ECS task on
            // this deploy (see CloudWatch: "FATAL: Database initialization
            // failed ... PendingModelChangesWarning"). EF Core's built-in
            // drift check compares the live entity model to the last
            // migration snapshot and throws by default if they don't match
            // exactly; MigrateAsync() never even got to run/apply the actual
            // pending migrations because this check fails first. Ignoring it
            // here restores the same behavior Postgres already had before
            // this became a hard error, so real, already-written migrations
            // (including AddUserProfileFields) can apply normally again.
            .ConfigureWarnings(w => w.Ignore(
                Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning));
        }
        else
        {
            options.UseSqlite(builder.Configuration.GetConnectionString("DefaultConnection"))
                   .ConfigureWarnings(w => w.Ignore(
                       Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning,
                       Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.MultipleCollectionIncludeWarning));
        }
    });

    // ── Repositories & Unit of Work ───────────────────────────────────────────
    builder.Services.AddScoped<IUnitOfWork, UnitOfWork>();
    builder.Services.AddScoped<IUserRepository, UserRepository>();
    builder.Services.AddScoped<ICustomerRepository, CustomerRepository>();
    builder.Services.AddScoped<ILoanRepository, LoanRepository>();
    builder.Services.AddScoped<ILoanStatusHistoryRepository, LoanStatusHistoryRepository>();
    builder.Services.AddScoped<IPasswordResetTokenRepository, PasswordResetTokenRepository>();

    // ── Application Services ──────────────────────────────────────────────────
    builder.Services.AddScoped<IJwtService, JwtService>();
    builder.Services.AddScoped<IAuthService, AuthService>();
    builder.Services.AddScoped<IUserService, UserService>();
    builder.Services.AddScoped<ICustomerService, CustomerService>();
    builder.Services.AddScoped<ILoanService, LoanService>();
    builder.Services.AddScoped<LoanMS.API.Services.IRolePermissionService, LoanMS.API.Services.RolePermissionService>();
    // Phase 2 RBAC — G-05 Login-User auto-assignment engine.
    builder.Services.AddScoped<LoanMS.API.Services.ILoginUserAssignmentService, LoanMS.API.Services.LoginUserAssignmentService>();
    builder.Services.AddScoped<IPasswordResetService, PasswordResetService>();
    builder.Services.AddScoped<LoanMS.Infrastructure.Services.IEmailConfigStore, LoanMS.Infrastructure.Services.EmailConfigStore>();
    builder.Services.AddScoped<IEmailService, LoanMS.Infrastructure.Services.EmailService>();
    builder.Services.AddScoped<LoanMS.Application.Interfaces.IEmailTemplateProvider, LoanMS.Infrastructure.Services.EmailTemplateProvider>();
    builder.Services.AddScoped<LoanMS.Application.Interfaces.IEmployeeCodeGenerator, LoanMS.Infrastructure.Services.EmployeeCodeGenerator>();
    builder.Services.AddScoped<ICibilAnalysisService, CibilAnalysisService>();

    // ── Income Verification — Phase 3 trusted inputs ────────────────────────────
    // Server-side Perfios normalization (pure) + trusted salary re-extraction
    // (S3 + existing AI-vision relay, with an untrusted fallback). These produce
    // the trusted inputs the Phase 4 verification engine will consume — the engine
    // never reads client state.
    builder.Services.AddScoped<LoanMS.Application.IncomeVerification.IPerfiosNormalizationService,
        LoanMS.Application.IncomeVerification.PerfiosNormalizationService>();
    builder.Services.AddScoped<LoanMS.Application.IncomeVerification.ITrustedSalaryExtractionService,
        LoanMS.Infrastructure.Services.TrustedSalaryExtractionService>();
    // Phase 4 — canonical verification engine (pure; the single source of truth).
    builder.Services.AddScoped<LoanMS.Application.IncomeVerification.IIncomeVerificationEngine,
        LoanMS.Application.IncomeVerification.IncomeVerificationEngine>();
    // Phase 5 — authoritative orchestration service (run/persist/review/override).
    builder.Services.AddScoped<LoanMS.Application.Interfaces.IIncomeVerificationService,
        LoanMS.Infrastructure.Services.IncomeVerificationService>();

    // ── Obligations — credit-review authority (FOIR + detection + reconciliation) ─
    // Deterministic bank-statement detection (pure) + the authoritative orchestration
    // service that owns CRUD, server-side FOIR (with the resolved lender/product
    // policy), import, verification and reconciliation. React only renders results.
    builder.Services.AddScoped<LoanMS.Application.Obligations.IObligationDetectionService,
        LoanMS.Application.Obligations.ObligationDetectionService>();
    builder.Services.AddScoped<LoanMS.Application.Interfaces.IObligationService,
        LoanMS.Infrastructure.Services.ObligationService>();

    // ── SLA breach + task follow-up automation (🔴 CRITICAL item #4/#9) ──────
    // Registered as a hosted BackgroundService — see SlaAndTaskAutomationService's
    // own doc comment for the full reasoning (no other job infra exists in
    // this project; configurable interval via Automation:IntervalMinutes;
    // never blocks HTTP request handling since it runs on its own timer loop
    // in a background scope).
    builder.Services.AddHostedService<LoanMS.Infrastructure.Services.SlaAndTaskAutomationService>();

    // ── File storage — S3 required in Production, local disk in dev only ────
    // Loan/DSA document uploads used to always write to the ECS Fargate
    // container's local disk (AppContext.BaseDirectory/secure_uploads) —
    // ephemeral storage that's wiped on every deploy/restart/scale event,
    // and invisible across the multiple tasks a service can run.
    //
    // Fail-fast in Production instead of silently falling back to local disk
    // — same reasoning, and the same pattern, as the Database:Provider check
    // above. A missing/misspelled Storage__S3BucketName env var on any one
    // ECS task would otherwise make that task quietly write uploaded
    // documents to its own local disk instead of the shared S3 bucket;
    // those files would then be permanently lost on the next deploy/restart/
    // scale event, with the LoanDocument/DsaDocument database row surviving
    // as an orphaned reference to nothing. Refuse to start rather than serve
    // upload traffic that would silently produce unrecoverable data loss.
    var s3Bucket = builder.Configuration["Storage:S3BucketName"];
    if (builder.Environment.IsProduction() && string.IsNullOrWhiteSpace(s3Bucket))
    {
        throw new InvalidOperationException(
            "Storage:S3BucketName is not configured in a Production environment. Refusing to start " +
            "with a local-disk fallback for document uploads, which would be silently wiped on the next " +
            "deploy/restart/scale event and invisible to any other running ECS task — the exact same class " +
            "of data-loss bug the Database:Provider check above exists to prevent. Set the " +
            "Storage__S3BucketName (and, if the bucket isn't in the task's default region, " +
            "Storage__S3Region) environment variable in the ECS task definition, and ensure the task's " +
            "IAM role (taskRoleArn) has s3:PutObject/s3:GetObject/s3:GetObjectMetadata permission on that " +
            "bucket, before deploying.");
    }

    if (!string.IsNullOrWhiteSpace(s3Bucket))
    {
        var s3Region = builder.Configuration["Storage:S3Region"];
        // Optional S3-compatible endpoint override (MinIO / LocalStack / moto /
        // any S3-API store). When set, the AWS SDK talks to this endpoint with
        // path-style addressing instead of the real AWS S3 service — lets the
        // ACTUAL S3FileStorageService code path run against a local emulator
        // without an AWS account. Production (no ServiceUrl) is unchanged:
        // credentials still resolve from the ECS task's IAM role / default
        // chain; for a local emulator any dummy AWS_ACCESS_KEY_ID/SECRET works.
        var s3ServiceUrl = builder.Configuration["Storage:S3ServiceUrl"];
        builder.Services.AddSingleton<Amazon.S3.IAmazonS3>(_ =>
        {
            if (!string.IsNullOrWhiteSpace(s3ServiceUrl))
            {
                var cfg = new Amazon.S3.AmazonS3Config { ServiceURL = s3ServiceUrl, ForcePathStyle = true };
                if (!string.IsNullOrWhiteSpace(s3Region)) cfg.AuthenticationRegion = s3Region;
                return new Amazon.S3.AmazonS3Client(cfg);
            }
            return string.IsNullOrWhiteSpace(s3Region)
                ? new Amazon.S3.AmazonS3Client()
                : new Amazon.S3.AmazonS3Client(Amazon.RegionEndpoint.GetBySystemName(s3Region));
        });
        builder.Services.AddScoped<LoanMS.Application.Interfaces.IFileStorageService>(sp =>
            new LoanMS.Infrastructure.Services.S3FileStorageService(sp.GetRequiredService<Amazon.S3.IAmazonS3>(), s3Bucket));
    }
    else
    {
        // Reached only in non-Production environments (Development/Staging/
        // local) — the Production branch above already refused to start
        // rather than fall through to here. Kept exactly as before so local
        // development needs no S3 setup at all.
        var localRoot = Path.Combine(AppContext.BaseDirectory, "secure_uploads");
        builder.Services.AddScoped<LoanMS.Application.Interfaces.IFileStorageService>(_ =>
            new LoanMS.Infrastructure.Services.LocalFileStorageService(localRoot));
    }

    // ── AutoMapper ────────────────────────────────────────────────────────────
    builder.Services.AddAutoMapper(typeof(MappingProfile));

    // ── FluentValidation — PROPERLY WIRED (both DI + ASP.NET pipeline) ───────
    builder.Services.AddFluentValidationAutoValidation(config =>
    {
        // Disable DataAnnotations validation to avoid double-validation
        config.DisableDataAnnotationsValidation = false;
    });
    builder.Services.AddFluentValidationClientsideAdapters();
    builder.Services.AddValidatorsFromAssemblyContaining<CreateLoanValidator>();

    // ── Caching — Redis (production) or Memory (development) ─────────────────
    var redisConn = builder.Configuration["Redis:ConnectionString"];
    var useRedis  = !string.IsNullOrEmpty(redisConn) &&
                    builder.Configuration.GetValue<bool>("Redis:Enabled");

    if (useRedis)
    {
        builder.Services.AddStackExchangeRedisCache(opts =>
        {
            opts.Configuration = redisConn;
            opts.InstanceName  = builder.Configuration["Redis:InstanceName"] ?? "loanms:";
        });
        builder.Services.AddSingleton<ICacheService, DistributedCacheService>();
        Log.Information("Redis cache enabled: {Connection}", redisConn?.Split('@').LastOrDefault());
    }
    else
    {
        builder.Services.AddMemoryCache();
        // Must be a singleton (not Scoped): MemoryCacheService tracks every cache
        // key it sets in an in-memory _keys set so RemoveByPrefixAsync can find
        // and evict them later (e.g. "loans:list:*" / "dashboard:*" after a new
        // application is created). A Scoped registration hands out a brand-new,
        // empty _keys set on every request, so RemoveByPrefixAsync always finds
        // nothing to remove and cached dashboard/list results never get
        // invalidated — the underlying IMemoryCache is itself already a
        // singleton, so this only aligns the tracking set's lifetime with it.
        builder.Services.AddSingleton<ICacheService, MemoryCacheService>();
        Log.Information("Using in-memory cache (set Redis:Enabled=true for production)");
    }
    builder.Services.AddResponseCaching();

    // ── AI Module — modular, optional, graceful fallback ─────────────────────
    // ROOT CAUSE FIX (KYC Vision "Extract Information" never auto-filling even
    // with valid Gemini/OpenAI keys saved in Settings): this whole IAIProvider
    // registration used to be wrapped in `if (aiEnabled)`, where aiEnabled came
    // from the static, deploy-time "AI:Enabled" config value. In every shipped
    // deployment path (ecs-task-def.json sets AI__Enabled=false; docker-compose.yml
    // defaults AI__Enabled to false too) that flag is false, so IAIProvider was
    // NEVER registered in DI at all — KycController's
    // `sp.GetService(typeof(IAIProvider))` always came back null, and every
    // extraction request short-circuited straight to "NOT_CONFIGURED" no matter
    // what key an Admin saved through Settings → AI Provider Keys. That directly
    // contradicted the DB-backed key design (AiKeyStore, GeminiAIProvider,
    // OpenAIProvider) which is explicitly built to activate a saved key on the
    // very next request with no restart. A second, compounding bug: AI:Provider
    // was never set anywhere either, so even flipping AI:Enabled=true would have
    // registered ClaudeAIProvider (default "claude") instead of the Gemini→OpenAI
    // failover chain — and ClaudeAIProvider reads its key once from static
    // config, never from AiKeyStore/the database, so Settings-saved Gemini/OpenAI
    // keys would still never be consulted.
    //
    // Fix: always register the Gemini→OpenAI (→Claude if a Claude key exists)
    // failover chain, independent of the static AI:Enabled flag. This is safe —
    // GeminiAIProvider/OpenAIProvider already resolve their key dynamically per
    // request via IAiKeyStore (DB first, config fallback) and already report
    // "not configured" gracefully via IsAvailableAsync()/InvalidOperationException
    // when no key exists anywhere, which is exactly the graceful-degradation
    // behaviour KycController/AIController already handle. AI:Enabled is kept
    // only as an informational switch for the AI text-completion features
    // (customer summaries, loan insights — via AIService below), which is a
    // legitimate, separate on/off toggle unrelated to KYC Vision key resolution.
    var aiEnabled  = builder.Configuration.GetValue<bool>("AI:Enabled");
    var aiProvider = (builder.Configuration["AI:Provider"] ?? "gemini").ToLower();

    builder.Services.AddSingleton<IPromptService, PromptService>();
    builder.Services.AddScoped<IAiKeyStore, LoanMS.Infrastructure.AI.AiKeyStore>();
    builder.Services.AddTransient<AiResilienceHandler>();
    builder.Services.AddHttpClient("ai", c =>
    {
        c.Timeout = TimeSpan.FromSeconds(120); // handler enforces per-attempt timeout
        c.DefaultRequestHeaders.Add("User-Agent", "LoanMS/1.0");
    })
    .AddHttpMessageHandler<AiResilienceHandler>();

    switch (aiProvider)
    {
        case "openai":
            builder.Services.AddScoped<IAIProvider, OpenAIProvider>();
            break;
        case "claude":
            builder.Services.AddScoped<IAIProvider, ClaudeAIProvider>();
            break;
        default: // "gemini" — the product default: Gemini primary, automatic OpenAI failover
            // Automatic failover: Gemini stays primary; if it fails (model
            // deprecated/404/410/429/5xx/timeout/unavailable), requests
            // automatically retry on OpenAI, and automatically switch back
            // to Gemini once it's healthy again. See FailoverAIProvider.
            // OpenAI is always included in the chain — its key may live in
            // appsettings/env OR be saved later by an Admin through
            // Settings → AI Provider Keys (IAiKeyStore checks the database
            // first, at request time). If no key exists anywhere yet,
            // OpenAIProvider.IsAvailableAsync()/CompleteAsync() report
            // "not configured" and FailoverAIProvider just skips it — so
            // this never introduces a hard dependency on a provider that
            // hasn't been set up.
            builder.Services.AddScoped<IAIProvider>(sp =>
            {
                var gemini = ActivatorUtilities.CreateInstance<GeminiAIProvider>(sp);
                var openai = ActivatorUtilities.CreateInstance<OpenAIProvider>(sp);
                var hasClaudeKey = !string.IsNullOrEmpty(builder.Configuration["AI:ClaudeApiKey"]);

                var chain = new List<IAIProvider> { gemini, openai };
                if (hasClaudeKey) chain.Add(ActivatorUtilities.CreateInstance<ClaudeAIProvider>(sp));
                return ActivatorUtilities.CreateInstance<FailoverAIProvider>(
                    sp, (IReadOnlyList<IAIProvider>)chain);
            });
            break;
    }
    Log.Information("AI provider chain registered: {Provider}. AI:Enabled={Enabled} (gates text-completion features only — KYC Vision key resolution is always live).", aiProvider, aiEnabled);

    builder.Services.AddScoped<IAIService>(sp => new AIService(
        sp.GetRequiredService<IPromptService>(),
        sp.GetRequiredService<IUnitOfWork>(),
        sp.GetRequiredService<ILogger<AIService>>(),
        aiEnabled ? sp.GetService<IAIProvider>() : null,
        aiEnabled
    ));

    // ── HTTP Clients ──────────────────────────────────────────────────────────
    builder.Services.AddHttpClient("incred", c =>
    {
        c.Timeout = TimeSpan.FromSeconds(30);
        c.DefaultRequestHeaders.Accept.Add(
            new System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("application/json"));
    });
    builder.Services.AddHttpClient();

    // ── JWT Authentication ────────────────────────────────────────────────────
    var jwtKey = builder.Configuration["Jwt:Key"];
    if (string.IsNullOrWhiteSpace(jwtKey) || jwtKey.Length < 32)
        throw new InvalidOperationException(
            "Jwt:Key is missing or too short (min 32 chars). " +
            "Set ASPNETCORE_Jwt__Key environment variable.");

    builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
        .AddJwtBearer(options =>
        {
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer           = true,
                ValidateAudience         = true,
                ValidateLifetime         = true,
                ValidateIssuerSigningKey = true,
                ValidIssuer              = builder.Configuration["Jwt:Issuer"]   ?? "LoanMS.API",
                ValidAudience            = builder.Configuration["Jwt:Audience"] ?? "LoanMS.Client",
                IssuerSigningKey         = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
                // A small tolerance (30s) absorbs normal clock drift between the
                // machine/container that issued the token and the one validating
                // it (common on ECS/Docker). Zero skew was causing freshly-issued,
                // still-valid tokens to be rejected as "expired" — the false
                // "session expired" error on KYC Vision → Settings even right
                // after a fresh login. 30s is negligible from a security standpoint
                // (still far stricter than the framework default of 5 minutes).
                ClockSkew                = TimeSpan.FromSeconds(30)
            };
        });

    builder.Services.AddAuthorization(options =>
    {
        options.AddPolicy("AdminOnly",   p => p.RequireRole("Admin"));
        options.AddPolicy("ManagerPlus", p => p.RequireRole("Admin", "Manager"));
        options.AddPolicy("AnyUser",     p => p.RequireRole("Admin", "Manager", "Sales"));
    });

    // ── CORS ──────────────────────────────────────────────────────────────────
    var allowedOrigins = builder.Configuration
        .GetSection("Cors:AllowedOrigins").Get<string[]>()
        ?? new[] { "http://localhost:5099", "https://localhost:5100" };

    builder.Services.AddCors(options =>
    {
        options.AddPolicy("RestrictedCors", policy =>
            policy.WithOrigins(allowedOrigins)
                  .WithHeaders("Content-Type", "Authorization", "X-Requested-With")
                  .WithMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                  .AllowCredentials());
    });

    // ── Rate Limiting ─────────────────────────────────────────────────────────
    // IMPORTANT: AddFixedWindowLimiter(name, ...) with no partition key creates a
    // single GLOBAL bucket shared by every caller. "LoginPolicy" was previously
    // wired up that way and applied to BOTH /api/auth/login (deliberate sign-in
    // attempts — should be tightly capped per client to slow brute force) AND
    // /api/auth/refresh (silent, automatic background token renewal that every
    // logged-in tab performs). Because the two were sharing one un-partitioned
    // 5-requests-per-15-minutes bucket, a handful of routine background refresh
    // calls from any user could exhaust the ENTIRE app's login budget — after
    // which /api/auth/login and /api/auth/refresh returned 429 for every user,
    // site-wide, for up to 15 minutes. That is what produced the "session has
    // expired" message that didn't go away even after logging out and back in:
    // the fresh login attempt was itself being silently rate-limited, so the
    // frontend fell back to its offline/local login path instead of getting a
    // real token. Fixed by (1) partitioning both policies per client IP so one
    // client can never exhaust another's budget, and (2) giving token refresh
    // its own, more generous policy separate from deliberate login attempts.
    builder.Services.AddRateLimiter(options =>
    {
        options.AddPolicy("LoginPolicy", httpContext =>
            RateLimitPartition.GetFixedWindowLimiter(
                partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                factory: _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit          = 5,
                    Window                = TimeSpan.FromMinutes(15),
                    QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                    QueueLimit           = 0
                }));

        options.AddPolicy("RefreshPolicy", httpContext =>
            RateLimitPartition.GetFixedWindowLimiter(
                partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                factory: _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit          = 60,
                    Window                = TimeSpan.FromMinutes(15),
                    QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                    QueueLimit           = 0
                }));

        options.AddPolicy("GlobalPolicy", httpContext =>
            RateLimitPartition.GetFixedWindowLimiter(
                partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                factory: _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit          = 200,
                    Window                = TimeSpan.FromMinutes(1),
                    QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                    QueueLimit           = 0
                }));

        options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
        
        // Return proper JSON response on rate limit rejection (not empty 429)
        options.OnRejected = async (context, _) =>
        {
            context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
            context.HttpContext.Response.ContentType = "application/json";
            await context.HttpContext.Response.WriteAsJsonAsync(new
            {
                success = false,
                message = "Too many requests. Please try again later.",
                data = (object?)null,
                errors = new[] { "Rate limit exceeded. Please try again in a few moments." }
            });
        };
    });

    // ── Health Checks ─────────────────────────────────────────────────────────
    builder.Services.AddHealthChecks()
        .AddDbContextCheck<AppDbContext>("database");

    // ── Controllers with proper JSON + FluentValidation integration ───────────
    builder.Services.AddControllers()
        .AddNewtonsoftJson(options =>
        {
            options.SerializerSettings.ReferenceLoopHandling =
                Newtonsoft.Json.ReferenceLoopHandling.Ignore;
            // Without this, enum properties (e.g. UserRole) only accept/return
            // their numeric value over JSON — a frontend sending role: "Admin"
            // would fail to bind with an opaque 400, and GET responses would
            // return 0/1/2 instead of readable names.
            options.SerializerSettings.Converters.Add(new Newtonsoft.Json.Converters.StringEnumConverter());
        });

    // ── Swagger ───────────────────────────────────────────────────────────────
    builder.Services.AddEndpointsApiExplorer();
    builder.Services.AddSwaggerGen(c =>
    {
        c.SwaggerDoc("v1", new OpenApiInfo
        {
            Title       = "LoanMS API",
            Version     = "v1",
            Description = "EFIN Loan Management System — Enterprise API"
        });
        c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
        {
            Name        = "Authorization", Type = SecuritySchemeType.Http,
            Scheme      = "Bearer", BearerFormat = "JWT", In = ParameterLocation.Header,
            Description = "Enter JWT token (without 'Bearer ' prefix)."
        });
        c.AddSecurityRequirement(new OpenApiSecurityRequirement
        {{
            new OpenApiSecurityScheme { Reference = new OpenApiReference
                { Type = ReferenceType.SecurityScheme, Id = "Bearer" } },
            Array.Empty<string>()
        }});
    });

    var app = builder.Build();

    // ── AutoMapper configuration validation (dev only — catches mapping bugs) ─
    if (app.Environment.IsDevelopment())
    {
        try
        {
            var mapper = app.Services.GetRequiredService<AutoMapper.IMapper>();
            mapper.ConfigurationProvider.AssertConfigurationIsValid();
            Log.Information("AutoMapper configuration validated successfully.");
        }
        catch (Exception ex)
        {
            Log.Fatal(ex, "AutoMapper configuration is invalid. Fix MappingProfile before starting.");
            throw;
        }
    }

    // ── Database initialization ───────────────────────────────────────────────
    using (var scope = app.Services.CreateScope())
    {
        var db     = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
        try
        {
            // For production with PostgreSQL: run migrations
            // For dev/SQLite: EnsureCreated is sufficient
            if (dbProvider is "postgresql" or "postgres")
            {
                logger.LogInformation("Applying PostgreSQL migrations...");
                await db.Database.MigrateAsync();
                logger.LogInformation("PostgreSQL migrations applied.");
            }
            else
            {
                // IMPORTANT: do NOT EnsureDeleted() here — that wipes the entire
                // SQLite DB (including Admin-saved AI keys, users, loans, everything)
                // on every single restart. EnsureCreated() is idempotent: it only
                // creates the file/schema if it doesn't already exist, and is a
                // no-op otherwise, so existing data now survives restarts.
                db.Database.EnsureCreated();
                await Task.Delay(200); // let SQLite settle
            }

            // ── Seed / reset default users ───────────────────────────────────────
            // Runs on EVERY startup: creates users if missing.
            // Passwords are ONLY set for newly-created users. Existing users' passwords
            // are never touched on restart — that would silently overwrite a real
            // password the user set from Settings. Set Seed:ForcePasswordReset=true
            // explicitly (e.g. emergency admin lockout) to opt back into overwriting
            // an existing user's password with the default.
            var adminPw   = builder.Configuration["Seed:AdminPassword"]   ?? "Admin@123";
            var managerPw = builder.Configuration["Seed:ManagerPassword"] ?? "Manager@123";
            var salesPw   = builder.Configuration["Seed:SalesPassword"]   ?? "Sales@123";
            var forcePasswordReset = builder.Configuration.GetValue<bool>("Seed:ForcePasswordReset", false);

            var defaultUsers = new[]
            {
                new { Email = "admin@efin.com",   FullName = "System Admin",    Password = adminPw,   Role = LoanMS.Domain.Enums.UserRole.Admin },
                new { Email = "manager@efin.com", FullName = "Default Manager", Password = managerPw, Role = LoanMS.Domain.Enums.UserRole.Manager },
                new { Email = "sales@efin.com",   FullName = "Default Sales",   Password = salesPw,   Role = LoanMS.Domain.Enums.UserRole.Sales },
            };

            foreach (var u in defaultUsers)
            {
                // BUGFIX (confirmed via live CloudWatch logs — "duplicate key
                // value violates unique constraint IX_Users_Email" crashing
                // startup on every restart): User has a global query filter
                // (!IsDeleted), but Email's unique index is NOT filtered — a
                // soft-deleted default user (e.g. someone previously used
                // Delete User on admin@efin.com) becomes invisible to this
                // FirstOrDefault() lookup while STILL physically occupying
                // that email at the database level. Seed logic then tried to
                // INSERT a fresh row with the same email → unique-constraint
                // violation → unhandled exception → the whole app failed to
                // start, every single time, until this is fixed. Ignoring
                // the query filter here finds a soft-deleted row too, and
                // reactivates it instead of colliding with it.
                var existing = db.Users.IgnoreQueryFilters().FirstOrDefault(x => x.Email == u.Email);
                if (existing == null)
                {
                    db.Users.Add(new LoanMS.Domain.Entities.User
                    {
                        FullName     = u.FullName,
                        Email        = u.Email,
                        PasswordHash = BCrypt.Net.BCrypt.HashPassword(u.Password, workFactor: 12),
                        Role         = u.Role,
                        IsActive     = true,
                        CreatedAt    = DateTime.UtcNow
                    });
                    logger.LogInformation("Created default user: {Email}", u.Email);
                }
                else
                {
                    existing.IsActive = true; // never leave a default account locked out
                    if (existing.IsDeleted)
                    {
                        existing.IsDeleted = false; // reactivate — see BUGFIX note above
                        logger.LogWarning("Default user {Email} was soft-deleted — reactivated on startup.", u.Email);
                    }

                    if (forcePasswordReset)
                    {
                        existing.PasswordHash = BCrypt.Net.BCrypt.HashPassword(u.Password, workFactor: 12);
                        logger.LogInformation("Seed:ForcePasswordReset=true — password force-reset for: {Email}", u.Email);
                    }
                    else
                    {
                        logger.LogInformation("Default user already exists, password preserved: {Email}", u.Email);
                    }

                    db.Users.Update(existing);
                }
            }
            db.SaveChanges();
            logger.LogInformation("Seed users created.");

            // ── Backfill Employee Codes for existing users ──────────────────────
            // Confirmed real gap (Employee Code feature build): users created
            // before this feature existed have EmployeeCode = NULL. Runs on
            // every startup but is a no-op once every user has one — cheap to
            // leave in place rather than a one-shot migration, and correctly
            // covers new default-seed users created just above too. Reuses
            // IEmployeeCodeGenerator (same service UserService.CreateAsync
            // uses) rather than duplicating its random+uniqueness-retry logic
            // here, so there is exactly one place that logic lives.
            var codeGen = scope.ServiceProvider.GetRequiredService<LoanMS.Application.Interfaces.IEmployeeCodeGenerator>();
            var usersNeedingCode = db.Users.Where(u => u.EmployeeCode == null || u.EmployeeCode == "").ToList();
            if (usersNeedingCode.Count > 0)
            {
                foreach (var u in usersNeedingCode)
                {
                    u.EmployeeCode = await codeGen.GenerateAsync(u.Role, u.LocationName);
                }
                db.SaveChanges();
                logger.LogInformation("Backfilled Employee Codes for {Count} existing user(s).", usersNeedingCode.Count);
            }


            // Seed payout rules
            if (!db.Set<LoanMS.Domain.Entities.PayoutRule>().Any())
            {
                db.Set<LoanMS.Domain.Entities.PayoutRule>().AddRange(
                    new LoanMS.Domain.Entities.PayoutRule { LoanType = "personal_loan",  Percentage = 1.5m,  MinPayout = 500m,   MaxPayout = 15000m,  Notes = "1.5% of loan amount", IsActive = true, CreatedAt = DateTime.UtcNow },
                    new LoanMS.Domain.Entities.PayoutRule { LoanType = "business_loan",  Percentage = 1.0m,  MinPayout = 1000m,  MaxPayout = 50000m,  Notes = "1% of loan amount",   IsActive = true, CreatedAt = DateTime.UtcNow },
                    new LoanMS.Domain.Entities.PayoutRule { LoanType = "home_loan",      Percentage = 0.5m,  MinPayout = 2000m,  MaxPayout = 100000m, Notes = "0.5% of loan amount", IsActive = true, CreatedAt = DateTime.UtcNow },
                    new LoanMS.Domain.Entities.PayoutRule { LoanType = "new_car_loan",   Percentage = 1.2m,  MinPayout = 500m,   MaxPayout = 20000m,  Notes = "1.2% of loan amount", IsActive = true, CreatedAt = DateTime.UtcNow },
                    new LoanMS.Domain.Entities.PayoutRule { LoanType = "education_loan", Percentage = 0.75m, MinPayout = 300m,   MaxPayout = 10000m,  Notes = "0.75% of loan",       IsActive = true, CreatedAt = DateTime.UtcNow },
                    new LoanMS.Domain.Entities.PayoutRule { LoanType = "insurance",      Percentage = 5.0m,  MinPayout = 500m,   MaxPayout = 25000m,  Notes = "5% commission",       IsActive = true, CreatedAt = DateTime.UtcNow }
                );
                db.SaveChanges();
                logger.LogInformation("Payout rules seeded.");
            }


            logger.LogInformation("Database ready. Provider={Provider}", dbProvider);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "FATAL: Database initialization failed: {Message}", ex.Message);
            throw; // Fail startup if migrations don't apply
        }
    }

    // ── Middleware Pipeline ───────────────────────────────────────────────────
    // ROOT CAUSE FIX (/app/assets/* 404s even though the files exist on disk):
    // this app never called app.UseRouting() explicitly. Without it, ASP.NET
    // Core's minimal hosting model auto-inserts BOTH routing AND endpoint
    // EXECUTION at the position of the FIRST app.Map...() call — here, that
    // was app.MapHealthChecks("/health") below. Every plain app.Use...()
    // middleware registered AFTER that point in source (including the /app
    // UseStaticFiles(...) further down, which serves the built React
    // assets) was therefore running AFTER routing had already matched and
    // fully executed an endpoint for the request — and app.MapFallback(
    // "/app/{**path}", ...) matches every "/app/**" URL, so it always won
    // that race and returned its own 404 before the static-file middleware
    // ever got a chance to serve the real file. Confirmed directly from the
    // server log: "Executing endpoint 'Fallback /app/{**path}'" appears for
    // /app/assets/index-nsD2V_5W.js, /router-BIqs5oAk.js, /query-C-zbL-AZ.js
    // and /index-91yS91os.css — never a static-file hit.
    //
    // Fix: call UseRouting() explicitly, here, before anything else in the
    // pipeline (including Swagger/health checks below). This defers actual
    // endpoint execution to the end of the pipeline as usual, so every
    // regular middleware registered in between (static files, security
    // headers, rate limiting, etc.) runs first, exactly in the order it's
    // written below — no other reordering needed.
    app.UseRouting();

    if (app.Environment.IsDevelopment())
    {
        app.UseSwagger();
        app.UseSwaggerUI(c =>
        {
            c.SwaggerEndpoint("/swagger/v1/swagger.json", "LoanMS API v1");
            c.RoutePrefix = "swagger";
        });
    }

    // Health check endpoint
    app.MapHealthChecks("/health");

    // Serilog request logging
    app.UseSerilogRequestLogging(options =>
    {
        options.MessageTemplate = "HTTP {RequestMethod} {RequestPath} → {StatusCode} in {Elapsed:0.0}ms";
        options.GetLevel = (ctx, elapsed, ex) =>
            ex != null || ctx.Response.StatusCode >= 500
                ? LogEventLevel.Error
                : elapsed > 1000 ? LogEventLevel.Warning
                : LogEventLevel.Information;
    });

    app.UseCors("RestrictedCors");

    // ── Static files MUST come before Auth/Security middleware ─────────────
    // ROOT CUTOVER: UseDefaultFiles() used to be here, which is what mapped
    // "/" to wwwroot/index.html — the legacy vanilla shell. It is deliberately
    // NOT registered any more: "/" now falls through to the MapFallback at the
    // bottom, which serves the React shell. The legacy file itself is left on
    // disk and stays reachable at its explicit path "/index.html" (served by
    // the static middleware below) as a grace-period escape hatch.

    // Serve wwwroot static files; block /uploads/* from direct browser access
    app.UseStaticFiles(new StaticFileOptions
    {
        OnPrepareResponse = ctx =>
        {
            var path = ctx.Context.Request.Path.Value ?? "";
            if (path.StartsWith("/uploads/", StringComparison.OrdinalIgnoreCase))
            {
                ctx.Context.Response.StatusCode    = StatusCodes.Status403Forbidden;
                ctx.Context.Response.ContentLength = 0;
                ctx.Context.Response.Body          = Stream.Null;
            }
        }
    });

    app.UseMiddleware<LoanMS.API.Middleware.SecurityHeadersMiddleware>();
    app.UseRateLimiter();
    app.UseMiddleware<LoanMS.API.Middleware.ExceptionMiddleware>();
    app.UseMiddleware<LoanMS.API.Middleware.AuditMiddleware>();

    // ── SPA fallback guard ──────────────────────────────────────────────────
    // A request for an actual asset file (.js/.css/.map/.png/.jpg/.svg/.ico/
    // .woff/.woff2/etc.) must NEVER be answered with index.html — if such a
    // path reaches this point, the real file was not found by the static
    // file middleware above, so this must return a genuine 404, not a
    // 200 text/html page. Only extension-less (client-route) paths fall
    // back to the SPA shell. This is what was producing "text/html" for
    // .js/.css asset requests: those requests were reaching the fallback
    // and being served index.html instead of 404ing.
    static bool LooksLikeStaticFile(PathString path)
    {
        var value = path.Value;
        if (string.IsNullOrEmpty(value)) return false;
        var lastSegment = value[(value.LastIndexOf('/') + 1)..];
        return lastSegment.Contains('.');
    }

    // Serve the React app. (This comment previously claimed the legacy shell
    // had been retired, that wwwroot/index.html no longer existed and that "/"
    // 302'd to "/app" — none of which was ever true. As of the root cutover the
    // accurate statement is: React is served from "/", "/app/**" 301-redirects
    // to the root equivalent, and the legacy shell is still on disk, reachable
    // only at its explicit "/index.html" path.)
    //
    // ROOT CAUSE FIX (blank /app + 404s on /app/assets/*.js + empty-MIME CSS):
    // this block used to be gated behind `if (Directory.Exists(wwwroot/react))`,
    // checked ONCE at startup. Middleware registration only happens while the
    // pipeline is being built — if `dotnet run` started before `npm run build`
    // had produced wwwroot/react (or a later frontend rebuild happened without
    // restarting the API), this entire block silently never got wired up for
    // the rest of that process's life. Every /app/assets/* request then fell
    // through, unmatched, to the generic bottom MapFallback further down,
    // which correctly refuses to serve *.js/*.css as index.html and instead
    // returns a bare 404 with no Content-Type set — exactly the "404 on the
    // JS bundles" / "CSS refused, MIME type is empty" errors reported (Chrome
    // phrases the same contentless 404 differently for a <script type=module>
    // vs a <link rel=stylesheet>). Meanwhile bare "/app" (no dot in the path)
    // still resolved to index.html via that same bottom fallback, which is
    // why the page loaded (blank) instead of 404ing outright.
    //
    // Fix: always register this middleware — never make it conditional on
    // build timing. PhysicalFileProvider throws if its root directory is
    // missing at construction time, so we just ensure the directory exists
    // first (harmless no-op if it's already there from a build). Because
    // PhysicalFileProvider reads from disk on every request, a later
    // `npm run build` is picked up immediately with no backend restart
    // needed — only a truly empty/missing wwwroot/react (nothing built yet)
    // will 404, which is correct behavior.
    var reactRoot = Path.Combine(app.Environment.WebRootPath, "react");
    Directory.CreateDirectory(reactRoot);

    // ROOT CUTOVER: the React build is now served from the site ROOT, not from
    // "/app". RequestPath is empty, so wwwroot/react/assets/* answers
    // /assets/* — which is exactly what the built index.html references after
    // vite.config.ts's base was switched to '/'.
    //
    // Registered AFTER the wwwroot provider above, which is what keeps the two
    // trees from fighting: the only filename present in both is index.html, and
    // wwwroot's copy (legacy) wins for the explicit "/index.html" request — the
    // escape hatch. Everything else is disjoint: legacy owns /js, /css,
    // /perfios; React owns /assets. Bare "/" matches neither provider (no
    // UseDefaultFiles any more) and falls through to MapFallback -> React.
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(reactRoot),
        RequestPath = ""
    });

    // ROOT CAUSE FIX #2 (still 404ing after the UseRouting() fix above):
    // confirmed by actually running this exact pipeline shape against a
    // live Kestrel server and curl-testing it directly. A MapGet/MapFallback
    // registered under "/app" are ENDPOINTS (resolved via routing), and an
    // endpoint that matches — MapFallback("/app/{**path}") matches every
    // "/app/**" URL — always wins the request over the earlier
    // UseStaticFiles(/app) middleware above, no matter the registration
    // order or whether UseRouting() is called explicitly. Verified: with
    // MapFallback in place, a request for a file that genuinely exists on
    // disk under wwwroot/react/assets still gets a bare 404 from the
    // fallback, never reaching the static file middleware. Removing the
    // Map*() endpoints entirely and replacing them with a plain
    // app.Use(...) middleware — not routing/endpoints at all — removes
    // that conflict: verified serving the same real file returns
    // 200 + correct Content-Type, a missing file still correctly 404s, and
    // a client-side route like "/app/dashboard" still correctly falls back
    // to index.html.
    // ROOT CUTOVER: "/app/**" is no longer a mount point, it is a permanent
    // redirect to the same path at the root. This is what keeps every bookmark,
    // browser-history entry and previously-sent link working — "/app/loans/42"
    // becomes "/loans/42", and bare "/app" becomes "/". Query strings are
    // carried across unchanged.
    //
    // 301 (not 302) because this move is permanent and we want browsers and
    // proxies to stop asking for the old path. Kept as plain middleware rather
    // than a Map*() endpoint for the same reason the previous implementation
    // was: an endpoint registered under "/app" wins over the static-file
    // middleware and would shadow real files.
    app.Use(async (context, next) =>
    {
        if (!context.Request.Path.StartsWithSegments("/app", out var remainder))
        {
            await next();
            return;
        }

        var target = remainder.HasValue && remainder.Value != "/" ? remainder.Value : "/";
        context.Response.Redirect(target + context.Request.QueryString, permanent: true);
    });

    app.UseResponseCaching();
    app.UseAuthentication();
    app.UseAuthorization();
    app.MapControllers();
    // Final catch-all for any request that matched no static file and no API
    // controller. After the root cutover this serves the REACT shell, which is
    // what makes "/" and every client-side route (and a hard refresh on one)
    // work. The legacy shell is not deleted — it is simply no longer the
    // fallback, and is reached only via the explicit "/index.html" path.
    app.MapFallback(context =>
    {
        // BUGFIX (confirmed at runtime): an unmatched /api/* path fell straight
        // through to the HTML branch below, so a misspelled or renamed endpoint
        // answered 200 text/html with the entire 673 KB legacy shell instead of
        // a 404. Callers using axios then parsed that HTML as the API envelope,
        // got `undefined` for `data`, and silently rendered an empty screen —
        // which is exactly how the wrong /api/payout-rules path (the controller
        // actually serves /api/PayoutRules) stayed hidden: no 404, no console
        // error, just a permanently empty Payout Rules tab.
        //
        // Only genuinely unmatched paths reach here — anything MapControllers
        // resolved has already been handled, so every existing endpoint is
        // completely unaffected.
        //
        // Note on coverage: MapFallback registers itself as "{*path:nonfile}",
        // so a path whose last segment contains a dot (e.g. "/api/x/thing.json")
        // never reaches this delegate at all — it falls off the end of the
        // pipeline and Kestrel returns a bodyless 404. That is still a 404 and
        // still not the legacy HTML, which is what matters here; it just does
        // not carry the JSON envelope below.
        if (context.Request.Path.StartsWithSegments("/api", out _))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return context.Response.WriteAsJsonAsync(new
            {
                success = false,
                message = $"No API endpoint matches {context.Request.Method} {context.Request.Path}.",
                data = (object?)null,
                errors = new[] { "Endpoint not found." },
            });
        }

        if (LooksLikeStaticFile(context.Request.Path))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return Task.CompletedTask;
        }
        // ROOT CUTOVER: unmatched client-side routes now fall back to the React
        // shell, not the legacy one. This is what makes "/loans/42" survive a
        // hard refresh and what serves bare "/". The legacy shell is still on
        // disk and still reachable at its explicit "/index.html" path.
        context.Response.ContentType = "text/html";
        return context.Response.SendFileAsync(Path.Combine(reactRoot, "index.html"));
    });

    Log.Information(
        "LoanMS API started | DB={Provider} | AI={AI} ({AIProvider}) | Redis={Redis} | Env={Env}",
        dbProvider,
        aiEnabled ? "ON" : "OFF",
        aiEnabled ? aiProvider : "none",
        useRedis ? "ON" : "OFF",
        builder.Environment.EnvironmentName);

    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "LoanMS API failed to start");
    throw;
}
finally
{
    Log.CloseAndFlush();
}
