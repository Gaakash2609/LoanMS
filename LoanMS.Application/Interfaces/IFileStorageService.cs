namespace LoanMS.Application.Interfaces;

/// <summary>
/// Abstraction over "where uploaded document bytes actually live" — added
/// because LoansController/DsaController were writing straight to the ECS
/// Fargate container's local disk (AppContext.BaseDirectory/secure_uploads).
/// Fargate containers are ephemeral and stateless: any file written to local
/// disk is permanently lost on the next deploy, task restart, or auto-scale
/// event, even though the LoanDocument/DsaDocument database row referencing
/// it survives — leaving an orphaned reference to a file that no longer
/// exists. With more than one running task, a file uploaded to one task's
/// disk is also simply invisible to any request that lands on a different
/// task. IFileStorageService lets the actual backend (S3 in production,
/// local disk as a zero-config fallback for local dev) be swapped without
/// touching the controllers.
///
/// The `key` parameter is the SAME opaque "{entityId}/{fileName}" value
/// already stored in LoanDocument.FilePath / DsaDocument.FilePath — no
/// database schema change was needed to introduce this abstraction.
/// </summary>
public interface IFileStorageService
{
    Task SaveAsync(string key, Stream content, string contentType, CancellationToken ct = default);

    /// <summary>Returns null if the key doesn't exist.</summary>
    Task<(Stream Content, string? ContentType)?> GetAsync(string key, CancellationToken ct = default);

    Task<bool> ExistsAsync(string key, CancellationToken ct = default);

    /// <summary>
    /// Removes the object at <paramref name="key"/>. Idempotent — deleting a
    /// key that doesn't exist is a no-op, not an error (S3's DeleteObject is
    /// already idempotent; the local backend guards on File.Exists). Callers
    /// treat this as best-effort cleanup: a storage failure must not fail a
    /// database deletion that has already committed.
    /// </summary>
    Task DeleteAsync(string key, CancellationToken ct = default);
}
