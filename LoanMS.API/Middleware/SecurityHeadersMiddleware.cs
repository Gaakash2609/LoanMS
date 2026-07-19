namespace LoanMS.API.Middleware;

/// <summary>
/// Adds HTTP security headers to every response.
/// Covers: Clickjacking (X-Frame-Options), MIME sniffing (X-Content-Type-Options),
/// XSS filter (X-XSS-Protection), Referrer leakage (Referrer-Policy),
/// Feature access (Permissions-Policy), and a baseline CSP.
/// </summary>
public class SecurityHeadersMiddleware
{
    private readonly RequestDelegate _next;

    public SecurityHeadersMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context)
    {
        var headers = context.Response.Headers;

        // Prevent clickjacking — allow same-origin iframes (needed for Perfios Bank Statement)
        headers["X-Frame-Options"] = "SAMEORIGIN";

        // Prevent MIME-type sniffing
        headers["X-Content-Type-Options"] = "nosniff";

        // Legacy XSS filter (still respected by some older browsers)
        headers["X-XSS-Protection"] = "1; mode=block";

        // Do not send referrer to third-party origins
        headers["Referrer-Policy"] = "strict-origin-when-cross-origin";

        // Restrict powerful browser features not needed by this app
        headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()";

        // Content Security Policy — baseline; tighten further after confirming no inline script issues
        // 'unsafe-inline' is kept temporarily because the app uses inline onclick/style extensively.
        // Replace with nonces or move scripts to external files and remove 'unsafe-inline' for full CSP benefit.
        headers["Content-Security-Policy"] =
            "default-src 'self'; " +
            "script-src 'self' 'unsafe-inline' https://unpkg.com https://cdnjs.cloudflare.com https://cdn.emailjs.com https://cdn.jsdelivr.net; " +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
            "font-src 'self' https://fonts.gstatic.com; " +
            "img-src 'self' data: blob:; " +
            "connect-src 'self' https://api.brevo.com https://api.emailjs.com https://api.cibil.com https://api.incred.com https://unpkg.com https://cdnjs.cloudflare.com https://generativelanguage.googleapis.com; " +
            "frame-src 'self'; " +
            "frame-ancestors 'self'; " +
            "form-action 'self';";

        // HSTS — only set if running over HTTPS (prevents downgrade attacks)
        if (context.Request.IsHttps)
            headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";

        await _next(context);
    }
}
