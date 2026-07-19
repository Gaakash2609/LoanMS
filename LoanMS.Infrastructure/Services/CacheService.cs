using LoanMS.Application.Interfaces;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using System.Text.Json;

namespace LoanMS.Infrastructure.Services;

/// <summary>
/// Unified caching abstraction — uses Redis (distributed) when configured,
/// falls back to in-memory cache when Redis is unavailable or disabled.
/// Business logic never directly touches IMemoryCache or IDistributedCache.
/// </summary>

public class DistributedCacheService : ICacheService
{
    private readonly IDistributedCache            _cache;
    private readonly ILogger<DistributedCacheService> _log;
    private static readonly TimeSpan DefaultExpiry = TimeSpan.FromMinutes(10);

    public DistributedCacheService(IDistributedCache cache, ILogger<DistributedCacheService> log)
    {
        _cache = cache;
        _log   = log;
    }

    public async Task<T?> GetAsync<T>(string key) where T : class
    {
        try
        {
            var data = await _cache.GetStringAsync(key);
            return data is null ? null : JsonSerializer.Deserialize<T>(data);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Cache GET failed for key {Key}", key);
            return null;
        }
    }

    public async Task SetAsync<T>(string key, T value, TimeSpan? expiry = null) where T : class
    {
        try
        {
            var opts = new DistributedCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = expiry ?? DefaultExpiry
            };
            await _cache.SetStringAsync(key, JsonSerializer.Serialize(value), opts);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Cache SET failed for key {Key}", key);
        }
    }

    public async Task RemoveAsync(string key)
    {
        try { await _cache.RemoveAsync(key); }
        catch (Exception ex) { _log.LogWarning(ex, "Cache REMOVE failed for key {Key}", key); }
    }

    public async Task RemoveByPrefixAsync(string prefix)
    {
        // For distributed cache, prefix removal requires key tracking
        // Simple implementation: individual remove per known key pattern
        _log.LogDebug("RemoveByPrefix called for {Prefix} (use Redis SCAN in production)", prefix);
        await Task.CompletedTask;
    }
}

public class MemoryCacheService : ICacheService
{
    private readonly IMemoryCache                _cache;
    private readonly ILogger<MemoryCacheService> _log;
    private readonly HashSet<string>             _keys = new();
    private static readonly TimeSpan DefaultExpiry = TimeSpan.FromMinutes(10);

    public MemoryCacheService(IMemoryCache cache, ILogger<MemoryCacheService> log)
    {
        _cache = cache;
        _log   = log;
    }

    public Task<T?> GetAsync<T>(string key) where T : class
    {
        _cache.TryGetValue(key, out T? value);
        return Task.FromResult(value);
    }

    public Task SetAsync<T>(string key, T value, TimeSpan? expiry = null) where T : class
    {
        var opts = new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = expiry ?? DefaultExpiry
        };
        lock (_keys) { _keys.Add(key); }
        _cache.Set(key, value, opts);
        return Task.CompletedTask;
    }

    public Task RemoveAsync(string key)
    {
        lock (_keys) { _keys.Remove(key); }
        _cache.Remove(key);
        return Task.CompletedTask;
    }

    public Task RemoveByPrefixAsync(string prefix)
    {
        List<string> toRemove;
        lock (_keys) { toRemove = _keys.Where(k => k.StartsWith(prefix)).ToList(); }
        foreach (var key in toRemove)
        {
            lock (_keys) { _keys.Remove(key); }
            _cache.Remove(key);
        }
        return Task.CompletedTask;
    }
}
