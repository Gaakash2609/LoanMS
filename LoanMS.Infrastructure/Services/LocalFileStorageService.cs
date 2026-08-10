using LoanMS.Application.Interfaces;

namespace LoanMS.Infrastructure.Services;

/// <summary>
/// Writes to local disk, under a fixed root — exactly the behavior every
/// document upload had before IFileStorageService existed. Kept as the
/// zero-config default so nothing breaks for anyone who hasn't configured
/// Storage:S3BucketName yet. NOT safe for a multi-task or ephemeral-disk
/// deployment (ECS Fargate) — see IFileStorageService's own doc comment for
/// why. Program.cs only registers this when S3 isn't configured, and logs a
/// warning in Production when that happens.
/// </summary>
public class LocalFileStorageService : IFileStorageService
{
    private readonly string _root;

    public LocalFileStorageService(string root)
    {
        _root = root;
    }

    public async Task SaveAsync(string key, Stream content, string contentType, CancellationToken ct = default)
    {
        var fullPath = Path.Combine(_root, key.Replace('/', Path.DirectorySeparatorChar));
        var dir = Path.GetDirectoryName(fullPath);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

        await using var fs = new FileStream(fullPath, FileMode.Create);
        await content.CopyToAsync(fs, ct);
    }

    public Task<(Stream Content, string? ContentType)?> GetAsync(string key, CancellationToken ct = default)
    {
        var fullPath = Path.Combine(_root, key.Replace('/', Path.DirectorySeparatorChar));
        if (!File.Exists(fullPath))
            return Task.FromResult<(Stream, string?)?>(null);

        Stream stream = File.OpenRead(fullPath);
        return Task.FromResult<(Stream, string?)?>((stream, null));
    }

    public Task<bool> ExistsAsync(string key, CancellationToken ct = default)
    {
        var fullPath = Path.Combine(_root, key.Replace('/', Path.DirectorySeparatorChar));
        return Task.FromResult(File.Exists(fullPath));
    }
}
