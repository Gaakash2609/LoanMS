using System.Net;
using System.Text;
using LoanMS.Application.Interfaces;

namespace LoanMS.Tests.TestHelpers;

/// <summary>
/// A HttpMessageHandler that returns pre-queued responses in order and records
/// every request URL it saw — lets tests script exact InCred HTTP call
/// sequences (e.g. "token, then 401, then token again, then 200") and assert
/// exactly how many times a given endpoint was hit (for retry/no-retry checks).
/// </summary>
public class QueuedHttpMessageHandler : HttpMessageHandler
{
    private readonly Queue<Func<HttpRequestMessage, HttpResponseMessage>> _responses = new();
    public List<string> RequestUrls { get; } = new();

    public void Enqueue(HttpStatusCode status, string body) =>
        _responses.Enqueue(_ => new HttpResponseMessage(status)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        });

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        RequestUrls.Add(request.RequestUri!.ToString());
        if (_responses.Count == 0)
            throw new InvalidOperationException($"IncredControllerTests: no queued HTTP response left for: {request.RequestUri}");
        return Task.FromResult(_responses.Dequeue()(request));
    }
}

/// <summary>
/// Minimal in-memory ICacheService — same contract as the real
/// MemoryCacheService/DistributedCacheService (LoanMS.Infrastructure), just
/// without the real expiry timer, so tests can precisely control what's
/// "cached" without waiting on real time.
/// </summary>
public class FakeCacheService : ICacheService
{
    private readonly Dictionary<string, object> _store = new();

    public Task<T?> GetAsync<T>(string key) where T : class =>
        Task.FromResult(_store.TryGetValue(key, out var v) ? v as T : null);

    public Task SetAsync<T>(string key, T value, TimeSpan? expiry = null) where T : class
    {
        _store[key] = value;
        return Task.CompletedTask;
    }

    public Task RemoveAsync(string key)
    {
        _store.Remove(key);
        return Task.CompletedTask;
    }

    public Task RemoveByPrefixAsync(string prefix)
    {
        foreach (var k in _store.Keys.Where(k => k.StartsWith(prefix)).ToList())
            _store.Remove(k);
        return Task.CompletedTask;
    }
}
