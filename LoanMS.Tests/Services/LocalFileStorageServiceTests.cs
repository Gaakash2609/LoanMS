using System.Text;
using FluentAssertions;
using LoanMS.Infrastructure.Services;
using Xunit;

namespace LoanMS.Tests.Services;

/// <summary>
/// Exercises LocalFileStorageService end-to-end against a real temp
/// directory, focusing on the DeleteAsync method added for document-delete
/// cleanup (Phase 12). The S3 implementation's DeleteObjectAsync can't be
/// unit-tested without AWS, but both share the same idempotent contract:
/// deleting a missing key is a no-op, not an error.
/// </summary>
public class LocalFileStorageServiceTests : IDisposable
{
    private readonly string _root;
    private readonly LocalFileStorageService _storage;

    public LocalFileStorageServiceTests()
    {
        _root = Path.Combine(Path.GetTempPath(), "loanms-storage-tests", Guid.NewGuid().ToString());
        _storage = new LocalFileStorageService(_root);
    }

    private static Stream StreamOf(string s) => new MemoryStream(Encoding.UTF8.GetBytes(s));

    [Fact]
    public async Task Save_Then_Exists_Then_Delete_RemovesTheObject()
    {
        const string key = "loans/42/doc.pdf";

        await _storage.SaveAsync(key, StreamOf("hello"), "application/pdf");
        (await _storage.ExistsAsync(key)).Should().BeTrue();

        await _storage.DeleteAsync(key);

        (await _storage.ExistsAsync(key)).Should().BeFalse();
        (await _storage.GetAsync(key)).Should().BeNull();
    }

    [Fact]
    public async Task Delete_MissingKey_IsNoOp_NotAnError()
    {
        // Idempotent by contract — must not throw for a key that was never
        // written (or was already deleted), so the controller's best-effort
        // cleanup after a DB soft-delete never turns into a 500.
        var act = async () => await _storage.DeleteAsync("loans/999/never-existed.pdf");
        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task Delete_OnlyRemovesTheTargetKey_NotSiblings()
    {
        await _storage.SaveAsync("loans/1/a.pdf", StreamOf("A"), "application/pdf");
        await _storage.SaveAsync("loans/1/b.pdf", StreamOf("B"), "application/pdf");

        await _storage.DeleteAsync("loans/1/a.pdf");

        (await _storage.ExistsAsync("loans/1/a.pdf")).Should().BeFalse();
        (await _storage.ExistsAsync("loans/1/b.pdf")).Should().BeTrue();
    }

    public void Dispose()
    {
        try { if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true); }
        catch { /* best-effort temp cleanup */ }
    }
}
