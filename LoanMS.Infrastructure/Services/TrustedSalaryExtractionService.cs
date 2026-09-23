using System.Security.Cryptography;
using LoanMS.Application.AI;
using LoanMS.Application.IncomeVerification;
using LoanMS.Application.Interfaces;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace LoanMS.Infrastructure.Services;

// ── Trusted salary extraction (Phase 3 — §26a) ────────────────────────────────
// Server-side re-extraction of the ORIGINAL net salary from the uploaded slip,
// reusing the EXISTING infra: IFileStorageService (S3/local) for the bytes and
// the EXISTING IAIProvider vision relay for images (the same one KycController's
// /kyc/vision uses). Parsing uses the shared canonical SalarySlipTextParser, so
// the server derives the same net the client would. Graceful, never-throwing
// fallback to an UNTRUSTED result whenever server-side extraction is not possible
// — the caller then records ClientReported and forces ManualReviewRequired.
public sealed class TrustedSalaryExtractionService : ITrustedSalaryExtractionService
{
    private readonly IFileStorageService _storage;
    private readonly IServiceProvider _sp;   // IAIProvider resolved optionally (may be unregistered when AI is off)
    private readonly ILogger<TrustedSalaryExtractionService> _log;

    private static readonly string[] ImageExts = { ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp" };

    public TrustedSalaryExtractionService(
        IFileStorageService storage, IServiceProvider sp, ILogger<TrustedSalaryExtractionService> log)
    {
        _storage = storage;
        _sp = sp;
        _log = log;
    }

    public async Task<TrustedSalaryExtractionResult> ExtractAsync(
        string storageKey, string? contentTypeHint = null, CancellationToken ct = default)
    {
        var res = new TrustedSalaryExtractionResult();

        // 1) Fetch bytes from storage.
        byte[] bytes;
        string? contentType = contentTypeHint;
        try
        {
            var obj = await _storage.GetAsync(storageKey, ct);
            if (obj is null)
                return Untrusted(res, "Salary-slip document not found in storage.");
            contentType ??= obj.Value.ContentType;
            using var ms = new MemoryStream();
            await obj.Value.Content.CopyToAsync(ms, ct);
            bytes = ms.ToArray();
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Trusted salary extraction: storage read failed for {Key}", storageKey);
            return Untrusted(res, "Could not read the salary-slip document from storage.");
        }

        res.ContentHash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

        // 2) Only images can be re-extracted server-side (vision). PDFs/others need
        //    a server PDF text pipeline that does not exist here → untrusted fallback.
        if (!IsImage(storageKey, contentType))
            return Untrusted(res, "Server-side extraction supports image slips only (no server PDF text pipeline); original treated as client-reported.", res.ContentHash);

        // 3) Vision provider must be configured + available.
        var provider = _sp.GetService<IAIProvider>();
        if (provider is null || !provider.SupportsVision || !await provider.IsAvailableAsync())
            return Untrusted(res, "AI vision is not configured/available for server-side salary extraction.", res.ContentHash);

        // 4) Run vision → parse with the shared canonical parser.
        try
        {
            var images = new List<VisionImage>
            {
                new() { MediaType = contentType ?? InferImageMime(storageKey), Data = Convert.ToBase64String(bytes) }
            };
            var text = await provider.ExtractFromImagesAsync(images, SalarySlipTextParser.VisionPrompt, ct);
            var parsed = SalarySlipTextParser.Parse(text ?? string.Empty);

            if (parsed.NetPay is null or <= 0m)
                return Untrusted(res, "Vision ran but no Net Pay could be confidently read.", res.ContentHash);

            res.IsTrusted = true;
            res.ExtractionMethod = "ServerVision";
            res.OriginalNetSalary = parsed.NetPay;
            res.Gross = parsed.Gross;
            res.MonthLabel = parsed.Month;
            return res;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Trusted salary extraction: vision failed for {Key}", storageKey);
            return Untrusted(res, "Vision extraction failed; original treated as client-reported.", res.ContentHash);
        }
    }

    private static TrustedSalaryExtractionResult Untrusted(TrustedSalaryExtractionResult res, string reason, string? hash = null)
    {
        res.IsTrusted = false;
        res.ExtractionMethod = "ClientReported";
        res.FallbackReason = reason;
        if (hash is not null) res.ContentHash = hash;
        return res;
    }

    private static bool IsImage(string key, string? contentType)
    {
        if (!string.IsNullOrEmpty(contentType) && contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            return true;
        var ext = Path.GetExtension(key).ToLowerInvariant();
        return ImageExts.Contains(ext);
    }

    private static string InferImageMime(string key) => Path.GetExtension(key).ToLowerInvariant() switch
    {
        ".png" => "image/png",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        ".bmp" => "image/bmp",
        _ => "image/jpeg",
    };
}
