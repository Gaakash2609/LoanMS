// Executable simulation of the LoanMS cross-device / cross-replica scenario.
//
// This is NOT the real ASP.NET Core app (that needs NuGet-restored EF Core,
// Npgsql, etc. — blocked by this sandbox's network policy, see report).
// It faithfully reproduces the *shape* of the real, fixed code:
//   - a shared "database" (simulates PostgreSQL — one instance, visible to
//     every replica, exactly like RDS/managed Postgres in the real deployment)
//   - N independent per-replica in-memory caches (simulates N ECS Fargate
//     tasks each with their own IMemoryCache — the exact topology described
//     in appsettings.Production.json / ecs-task-def.json today, Redis:Enabled=false)
//   - a RemoveByPrefixAsync that is a correct per-instance implementation
//     (matching MemoryCacheService.cs) to show that even a *correct*
//     invalidation still fails to help across replicas
//   - the OLD GetAllAsync/GetDashboardStatsAsync (cache-first) vs the FIXED
//     ones (read straight through) run side by side against the same data,
//     across two simulated devices hitting two different replicas.

using System;
using System.Collections.Generic;
using System.Linq;

var db = new SharedDatabase();
var replicaA = new Replica("replica-1 (serves Device A)");
var replicaB = new Replica("replica-2 (serves Device B)");

Console.WriteLine("=== LoanMS cross-device / cross-replica simulation ===\n");

// ---------------------------------------------------------------------
// Scenario 1: OLD behavior (pre-fix) — list is cached per replica,
// invalidation is per-replica only.
// ---------------------------------------------------------------------
Console.WriteLine("--- Scenario 1: OLD (cached) GetAllAsync, 2 ECS replicas ---");
replicaB.OldGetAllAsync(db); // Device B warms replica B's cache with the pre-create snapshot
Console.WriteLine("Device A creates a new loan application (hits replica-1)...");
replicaA.OldCreateAsync(db, "EFIN20269876543");
Console.WriteLine("Device B refreshes the Application List (still hits replica-2)...");
var oldResult = replicaB.OldGetAllAsync(db);
Console.WriteLine($"Device B sees {oldResult.Count} loan(s): [{string.Join(", ", oldResult)}]");
Console.WriteLine(oldResult.Count == db.Loans.Count
    ? "  -> unexpectedly correct (cache happened to be cold)"
    : $"  -> BUG REPRODUCED: DB has {db.Loans.Count} loan(s), Device B only sees {oldResult.Count}. New application is invisible.");

Console.WriteLine();
db.Loans.Clear();
replicaA.Cache.Clear();
replicaB.Cache.Clear();

// ---------------------------------------------------------------------
// Scenario 2: FIXED behavior — GetAllAsync always reads straight through.
// ---------------------------------------------------------------------
Console.WriteLine("--- Scenario 2: FIXED (no-cache) GetAllAsync, 2 ECS replicas ---");
replicaB.FixedGetAllAsync(db); // Device B's earlier read, pre-create
Console.WriteLine("Device A creates a new loan application (hits replica-1)...");
replicaA.FixedCreateAsync(db, "EFIN20269876544");
Console.WriteLine("Device B refreshes the Application List (still hits replica-2)...");
var fixedResult = replicaB.FixedGetAllAsync(db);
Console.WriteLine($"Device B sees {fixedResult.Count} loan(s): [{string.Join(", ", fixedResult)}]");
Console.WriteLine(fixedResult.Count == db.Loans.Count
    ? "  -> PASS: Device B sees the application immediately, no stale cache."
    : "  -> FAIL: fix did not resolve the issue.");

Console.WriteLine();
db.Loans.Clear();
replicaA.Cache.Clear();
replicaB.Cache.Clear();

// ---------------------------------------------------------------------
// Scenario 3: Dashboard stats — OLD (cached) vs FIXED (Phase 3 change).
// ---------------------------------------------------------------------
Console.WriteLine("--- Scenario 3: Dashboard stats, OLD vs FIXED, 2 ECS replicas ---");
replicaB.OldGetDashboardAsync(db);
Console.WriteLine("Device A creates a new loan application (hits replica-1)...");
replicaA.OldCreateAsync(db, "EFIN20269876545");
var oldDash = replicaB.OldGetDashboardAsync(db);
Console.WriteLine($"[OLD] Device B dashboard total: {oldDash} (actual DB total: {db.Loans.Count})" +
    (oldDash != db.Loans.Count ? "  -> BUG REPRODUCED (stale dashboard)" : "  -> coincidentally correct"));

db.Loans.Clear();
replicaA.Cache.Clear();
replicaB.Cache.Clear();

replicaB.FixedGetDashboardAsync(db);
Console.WriteLine("Device A creates a new loan application (hits replica-1)...");
replicaA.FixedCreateAsync(db, "EFIN20269876546");
var fixedDash = replicaB.FixedGetDashboardAsync(db);
Console.WriteLine($"[FIXED] Device B dashboard total: {fixedDash} (actual DB total: {db.Loans.Count})" +
    (fixedDash == db.Loans.Count ? "  -> PASS" : "  -> FAIL"));

Console.WriteLine("\n=== Simulation complete ===");

// ─────────────────────────────────────────────────────────────────────────

class SharedDatabase
{
    public List<string> Loans { get; } = new();
}

class Replica
{
    public string Name { get; }
    public Dictionary<string, object> Cache { get; } = new();
    public Replica(string name) => Name = name;

    // OLD: cache-first list read, 30s-style TTL modeled as "cached forever until RemoveByPrefixAsync runs"
    public List<string> OldGetAllAsync(SharedDatabase db)
    {
        const string key = "loans:list:all";
        if (Cache.TryGetValue(key, out var cached)) return (List<string>)cached;
        var snapshot = new List<string>(db.Loans);
        Cache[key] = snapshot;
        return snapshot;
    }

    public void OldCreateAsync(SharedDatabase db, string loanNumber)
    {
        db.Loans.Add(loanNumber);
        // RemoveByPrefixAsync — correctly implemented per-instance (like
        // MemoryCacheService), but this replica's own cache is the only one
        // it can reach. The *other* replica's cache is untouched.
        var toRemove = Cache.Keys.Where(k => k.StartsWith("loans:list:")).ToList();
        foreach (var k in toRemove) Cache.Remove(k);
    }

    // FIXED: always read straight from the "database"
    public List<string> FixedGetAllAsync(SharedDatabase db) => new(db.Loans);

    public void FixedCreateAsync(SharedDatabase db, string loanNumber) => db.Loans.Add(loanNumber);

    // Dashboard — OLD (60s-style cache) vs FIXED (no cache)
    public int OldGetDashboardAsync(SharedDatabase db)
    {
        const string key = "dashboard:total";
        if (Cache.TryGetValue(key, out var cached)) return (int)cached;
        var total = db.Loans.Count;
        Cache[key] = total;
        return total;
    }

    public int FixedGetDashboardAsync(SharedDatabase db) => db.Loans.Count;
}
