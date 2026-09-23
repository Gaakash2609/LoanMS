using System.Net;
using System.Text.Json;

namespace LoanMS.API.Middleware;

public class ExceptionMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionMiddleware> _logger;
    private readonly IWebHostEnvironment _env;

    public ExceptionMiddleware(RequestDelegate next, ILogger<ExceptionMiddleware> logger, IWebHostEnvironment env)
    {
        _next   = next;
        _logger = logger;
        _env    = env;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled exception: {Message}", ex.Message);

            // If the response has already started (e.g. an exception thrown
            // mid-stream, such as a failing SendFileAsync), the headers are
            // read-only. Trying to write a JSON error body would throw a
            // second, misleading "Headers are read-only" exception that masks
            // the real error (observed in the logs as the SPA-fallback 500).
            // In that case re-throw the ORIGINAL exception (bare `throw`
            // preserves its stack) so the host aborts the connection cleanly
            // and the true error surfaces instead of the header exception.
            if (context.Response.HasStarted)
                throw;

            await HandleExceptionAsync(context, ex, _env.IsDevelopment());
        }
    }

    private static async Task HandleExceptionAsync(HttpContext context, Exception ex, bool isDev)
    {
        context.Response.ContentType = "application/json";
        context.Response.StatusCode  = ex switch
        {
            UnauthorizedAccessException => (int)HttpStatusCode.Unauthorized,
            KeyNotFoundException        => (int)HttpStatusCode.NotFound,
            ArgumentException           => (int)HttpStatusCode.BadRequest,
            _                           => (int)HttpStatusCode.InternalServerError
        };

        var message = isDev ? ex.Message : "An internal server error occurred.";
        var resp = new { success = false, message, errors = new[] { message } };
        await context.Response.WriteAsync(
            JsonSerializer.Serialize(resp, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase })
        );
    }
}
