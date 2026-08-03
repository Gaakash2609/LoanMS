# Cross-Device / Cross-Replica Simulation

Standalone, zero-NuGet-dependency console harness that reproduces the exact
topology of the production bug (multiple ECS Fargate replicas, each with an
independent in-memory cache, sharing one PostgreSQL database) and proves,
by actually running the code, that:

1. The OLD cache-first `GetAllAsync` / `GetDashboardStatsAsync` go stale
   across replicas even with a *correctly implemented* per-instance
   `RemoveByPrefixAsync` (Device A's create is invisible to Device B).
2. The FIXED read-straight-through versions do not.

This does **not** replace running the real backend against a real database —
it's a fast, dependency-free way to demonstrate the fix's correctness in
environments where a full `dotnet restore` isn't possible (e.g. network-
restricted CI/sandboxes with no NuGet access).

Run it:

```bash
cd verification/cross-device-sim
dotnet run
```

Expected output: Scenario 1 and the first half of Scenario 3 print
"BUG REPRODUCED"; Scenario 2 and the second half of Scenario 3 print "PASS".
