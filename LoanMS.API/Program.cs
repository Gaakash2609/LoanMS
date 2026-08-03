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
    // MUST persist keys to disk, in the same place the SQLite DB already lives
    // (so it survives every restart/redeploy exactly as reliably as the DB does).
    // Without this, ASP.NET Core generates a brand-new, ephemeral key ring on
    // every process start — every secret encrypted with the OLD ring (Gmail SMTP
    // password, InCred client secret, and the Gemini/OpenAI AI keys saved via
    // Settings) silently fails to decrypt after that. AiKeyStore/EmailConfigStore
    // catch that failure quietly and fall back to appsettings.json, which has no
    // OpenAI key at all — so "the key saves fine but extraction still doesn't
    // work" kept happening after every restart, no matter how many times a key
    // was re-saved.
    var dataProtectionBuilder = builder.Services.AddDataProtection()
        .SetApplicationName("LoanMS")
        .PersistKeysToFileSystem(new DirectoryInfo(
            Path.Combine(builder.Environment.ContentRootPath, "dataprotection-keys")));

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
            });
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
    builder.Services.AddScoped<IPasswordResetService, PasswordResetService>();
    builder.Services.AddScoped<LoanMS.Infrastructure.Services.IEmailConfigStore, LoanMS.Infrastructure.Services.EmailConfigStore>();
    builder.Services.AddScoped<IEmailService, LoanMS.Infrastructure.Services.EmailService>();
    builder.Services.AddScoped<ICibilAnalysisService, CibilAnalysisService>();

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
        ?? new[] { "http://localhost:7070", "https://localhost:7071" };

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
            options.SerializerSettings.ReferenceLoopHandling =
                Newtonsoft.Json.ReferenceLoopHandling.Ignore);

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
            // Runs on EVERY startup: creates users if missing, resets passwords to defaults.
            // This guarantees login always works even if DB was partially migrated.
            var adminPw   = builder.Configuration["Seed:AdminPassword"]   ?? "Admin@123";
            var managerPw = builder.Configuration["Seed:ManagerPassword"] ?? "Manager@123";
            var salesPw   = builder.Configuration["Seed:SalesPassword"]   ?? "Sales@123";

            var defaultUsers = new[]
            {
                new { Email = "admin@efin.com",   FullName = "System Admin",    Password = adminPw,   Role = LoanMS.Domain.Enums.UserRole.Admin },
                new { Email = "manager@efin.com", FullName = "Default Manager", Password = managerPw, Role = LoanMS.Domain.Enums.UserRole.Manager },
                new { Email = "sales@efin.com",   FullName = "Default Sales",   Password = salesPw,   Role = LoanMS.Domain.Enums.UserRole.Sales },
            };

            foreach (var u in defaultUsers)
            {
                var existing = db.Users.FirstOrDefault(x => x.Email == u.Email);
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
                    // Always reset password to default on startup so login always works
                    existing.PasswordHash = BCrypt.Net.BCrypt.HashPassword(u.Password, workFactor: 12);
                    existing.IsActive     = true;
                    db.Users.Update(existing);
                    logger.LogInformation("Reset password for: {Email}", u.Email);
                }
            }
            db.SaveChanges();
            logger.LogInformation("Seed users created.");


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
    // UseDefaultFiles enables serving index.html at "/"
    app.UseDefaultFiles();

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

    // Serve React app from /app path (new frontend)
    // Existing wwwroot/index.html is still served at root for backward compatibility
    if (Directory.Exists(Path.Combine(app.Environment.WebRootPath, "react")))
    {
        var reactRoot = Path.Combine(app.Environment.WebRootPath, "react");

        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(reactRoot),
            RequestPath = "/app"
        });

        // Bare "/app" (no trailing slash) does NOT match the "/app/{**path}" fallback
        // below, so without this it used to fall through to the root MapFallbackToFile
        // and render the OLD vanilla UI instead of the React app — this was the
        // "different look and flow" bug. Handle it explicitly here.
        app.MapGet("/app", context =>
        {
            context.Response.ContentType = "text/html";
            return context.Response.SendFileAsync(Path.Combine(reactRoot, "index.html"));
        });

        app.MapFallback("/app/{**path}", context =>
        {
            context.Response.ContentType = "text/html";
            return context.Response.SendFileAsync(Path.Combine(reactRoot, "index.html"));
        });
    }

    app.UseResponseCaching();
    app.UseAuthentication();
    app.UseAuthorization();
    app.MapControllers();
    app.MapFallbackToFile("index.html");

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
