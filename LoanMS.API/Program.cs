using BCrypt.Net;
using System.Text;
using System.Threading.RateLimiting;
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
    builder.Services.AddDataProtection();

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
        builder.Services.AddScoped<ICacheService, MemoryCacheService>();
        Log.Information("Using in-memory cache (set Redis:Enabled=true for production)");
    }
    builder.Services.AddResponseCaching();

    // ── AI Module — modular, optional, graceful fallback ─────────────────────
    var aiEnabled  = builder.Configuration.GetValue<bool>("AI:Enabled");
    var aiProvider = (builder.Configuration["AI:Provider"] ?? "claude").ToLower();

    builder.Services.AddSingleton<IPromptService, PromptService>();
    builder.Services.AddTransient<AiResilienceHandler>();
    builder.Services.AddHttpClient("ai", c =>
    {
        c.Timeout = TimeSpan.FromSeconds(120); // handler enforces per-attempt timeout
        c.DefaultRequestHeaders.Add("User-Agent", "LoanMS/1.0");
    })
    .AddHttpMessageHandler<AiResilienceHandler>();

    if (aiEnabled)
    {
        switch (aiProvider)
        {
            case "openai":
                builder.Services.AddScoped<IAIProvider, OpenAIProvider>();
                break;
            case "gemini":
                // Automatic failover: Gemini stays primary; if it fails (model
                // deprecated/404/410/429/5xx/timeout/unavailable), requests
                // automatically retry on OpenAI, and automatically switch back
                // to Gemini once it's healthy again. See FailoverAIProvider.
                // Falls back to plain Gemini (today's exact behavior) if no
                // OpenAI key is configured, so this never introduces a hard
                // dependency on a provider that hasn't been set up.
                builder.Services.AddScoped<IAIProvider>(sp =>
                {
                    var gemini = ActivatorUtilities.CreateInstance<GeminiAIProvider>(sp);
                    var hasOpenAiKey = !string.IsNullOrEmpty(builder.Configuration["AI:OpenAIApiKey"]);
                    var hasClaudeKey = !string.IsNullOrEmpty(builder.Configuration["AI:ClaudeApiKey"]);
                    if (!hasOpenAiKey && !hasClaudeKey) return gemini;

                    var chain = new List<IAIProvider> { gemini };
                    if (hasOpenAiKey) chain.Add(ActivatorUtilities.CreateInstance<OpenAIProvider>(sp));
                    if (hasClaudeKey) chain.Add(ActivatorUtilities.CreateInstance<ClaudeAIProvider>(sp));
                    return ActivatorUtilities.CreateInstance<FailoverAIProvider>(
                        sp, (IReadOnlyList<IAIProvider>)chain);
                });
                break;
            default: // "claude"
                builder.Services.AddScoped<IAIProvider, ClaudeAIProvider>();
                break;
        }
        Log.Information("AI module enabled. Provider: {Provider}", aiProvider);
    }

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
                ClockSkew                = TimeSpan.Zero
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
    builder.Services.AddRateLimiter(options =>
    {
        options.AddFixedWindowLimiter("LoginPolicy", opt =>
        {
            opt.PermitLimit          = 5;
            opt.Window               = TimeSpan.FromMinutes(15);
            opt.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
            opt.QueueLimit           = 0;
        });
        options.AddFixedWindowLimiter("GlobalPolicy", opt =>
        {
            opt.PermitLimit          = 200;
            opt.Window               = TimeSpan.FromMinutes(1);
            opt.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;
            opt.QueueLimit           = 0;
        });
        options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
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

                // Safety fallback for fresh/misaligned DBs: if core table is still absent,
                // create schema from current model so app can boot and seed users.
                try
                {
                    await db.Users.AsNoTracking().Select(x => x.Id).Take(1).ToListAsync();
                }
                catch (Npgsql.PostgresException pex) when (pex.SqlState == "42P01")
                {
                    logger.LogWarning("Users table not found after migration; running EnsureCreated fallback.");

                                        var nonHistoryTables = await db.Database
                                                                                                .SqlQueryRaw<int>(@"SELECT COUNT(*) AS ""Value""
                                                                                     FROM information_schema.tables
                                                                                     WHERE table_schema = 'public'
                                                                                         AND table_type = 'BASE TABLE'
                                                                                         AND table_name <> '__EFMigrationsHistory'")
                        .SingleAsync();

                    if (nonHistoryTables == 0)
                    {
                        await db.Database.ExecuteSqlRawAsync("DROP TABLE IF EXISTS \"__EFMigrationsHistory\";");
                    }

                    await db.Database.EnsureCreatedAsync();
                    logger.LogInformation("EnsureCreated fallback completed.");
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Could not verify Users table after migration; continuing startup.");
                }
            }
            else
            {
                db.Database.EnsureDeleted();
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
            logger.LogWarning(ex, "DB initialization warning: {Message}", ex.Message);
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
    var reactRoot = Path.Combine(app.Environment.WebRootPath, "react");
    var hasReact = Directory.Exists(reactRoot);

    // Serve React build at root in production (prevents legacy wwwroot/index.html from loading)
    if (hasReact)
    {
        app.UseDefaultFiles(new DefaultFilesOptions
        {
            FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(reactRoot)
        });
        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(reactRoot),
            OnPrepareResponse = ctx =>
            {
                var fileName = ctx.File.Name;
                if (fileName.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
                {
                    ctx.Context.Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
                    ctx.Context.Response.Headers["Pragma"] = "no-cache";
                    ctx.Context.Response.Headers["Expires"] = "0";
                }
                else
                {
                    ctx.Context.Response.Headers["Cache-Control"] = "public, max-age=31536000, immutable";
                }
            }
        });
    }

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

    // Backward-compat: also serve React under /app
    if (hasReact)
    {
        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(
                reactRoot),
            RequestPath = "/app",
            OnPrepareResponse = ctx =>
            {
                var fileName = ctx.File.Name;
                if (fileName.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
                {
                    ctx.Context.Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
                    ctx.Context.Response.Headers["Pragma"] = "no-cache";
                    ctx.Context.Response.Headers["Expires"] = "0";
                }
                else
                {
                    ctx.Context.Response.Headers["Cache-Control"] = "public, max-age=31536000, immutable";
                }
            }
        });
        app.MapFallback("/app/{**path}", context =>
        {
            context.Response.ContentType = "text/html";
            context.Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
            context.Response.Headers["Pragma"] = "no-cache";
            context.Response.Headers["Expires"] = "0";
            return context.Response.SendFileAsync(
                Path.Combine(reactRoot, "index.html"));
        });
    }

    app.UseResponseCaching();
    app.UseAuthentication();
    app.UseAuthorization();
    app.MapControllers();
    if (hasReact)
    {
        app.MapFallback(context =>
        {
            context.Response.ContentType = "text/html";
            context.Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
            context.Response.Headers["Pragma"] = "no-cache";
            context.Response.Headers["Expires"] = "0";
            return context.Response.SendFileAsync(Path.Combine(reactRoot, "index.html"));
        });
    }
    else
    {
        app.MapFallbackToFile("index.html");
    }

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
