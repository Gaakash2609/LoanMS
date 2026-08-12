# Staging migration runner (Phase 6)

One-off ECS Fargate task that applies the EF Core migration bundle to the
**staging** PostgreSQL RDS instance only. Completely separate from the
production app image, ECR repo, and ECS service.

## Files in this setup

| File | Purpose |
|---|---|
| `Dockerfile.migration` | Packages `migration-bundle/efbundle` into a minimal image |
| `ecs-task-def-migration.json` | Dedicated ECS task def, family `loanms-migration` |
| `scripts/migration/1-build-and-push-migration-image.ps1` | Build + push image to ECR — **prep only** |
| `scripts/migration/2-register-migration-task-definition.ps1` | Registers the task def — **prep only** |
| `scripts/migration/3-RUN-MIGRATION-run-task.ps1` | **Actually runs the migration** — asks for typed confirmation |

## Order of operations

```powershell
# 0. Generate the bundle (if you haven't already)
dotnet ef migrations bundle --project .\LoanMS.Infrastructure\LoanMS.Infrastructure.csproj `
  --startup-project .\LoanMS.API\LoanMS.API.csproj -r linux-x64 --self-contained `
  -o .\migration-bundle\efbundle

# 1. Build + push the migration image — PREPARATION ONLY
.\scripts\1-build-and-push-migration-image.ps1

# 2. Register the ECS task definition — PREPARATION ONLY
.\scripts\2-register-migration-task-definition.ps1

# 3. Run the migration — THE ONLY COMMAND THAT ACTUALLY TOUCHES STAGING RDS
.\scripts\3-RUN-MIGRATION-run-task.ps1
```

Steps 1 and 2 only build/push a Docker image and register a task definition —
neither one connects to any database. **Step 3 is the only action that
opens a connection to staging RDS and applies migrations**, and it requires
you to type `RUN MIGRATION` to proceed.

## Things I could not verify from here — check before running step 3

1. **Secret JSON key name.** `ecs-task-def-migration.json` references
   `loanms/staging/db:ConnectionString` — assuming the secret is stored as
   JSON with a key named `ConnectionString`, matching the pattern already
   used for `loanms/prod/db` in `docs/deployment/aws-ecs-cicd.md`. If `loanms/staging/db`
   was created with a different key name (or as a plain string secret), update
   the `valueFrom` suffix in `ecs-task-def-migration.json` accordingly:
   ```
   aws secretsmanager get-secret-value --secret-id loanms/staging/db --region ap-south-1 --query SecretString --output text
   ```
   (this prints the value locally in your own terminal — I'm not running it here)

2. **IAM permissions on `ecsTaskExecutionRole`.** This role is reused from the
   production task definition. It must be able to:
   - `secretsmanager:GetSecretValue` on the `loanms/staging/db` secret ARN
     specifically (a policy scoped only to `loanms/prod/*` would block this)
   - `logs:CreateLogGroup` (the task def sets `awslogs-create-group: true` so
     ECS creates `/ecs/loanms-migration` on first run)
   - `ecr:GetDownloadUrlForLayer` / `ecr:BatchGetImage` on the new
     `loanms-migration` repository
   I can't inspect the live IAM policy from here — if step 3 fails with an
   `AccessDenied`, this is the first place to check.

3. **`taskRoleArn` is reused but likely unnecessary.** The migration bundle
   doesn't make any AWS API calls itself (it only opens a TCP connection to
   Postgres using the connection string ECS already injected) — reusing
   `ecsTaskRole` is harmless, just not required for this to work.

## Safety properties already built in

- Only references `loanms/staging/db` — `loanms/prod/db` does not appear
  anywhere in these files.
- `assignPublicIp` is `DISABLED` in the run-task network configuration.
- Uses the given private subnet (`subnet-08ff88751801fc7d7`) and security
  group (`sg-0ac160b45dff88a33`) — the same ones already granted staging RDS
  access, per your earlier confirmation.
- Separate ECR repository (`loanms-migration`) and separate image — the
  production `loanms` image/repo is never touched.
- Separate task definition family (`loanms-migration`) — the existing
  `loanms-prod` service/task definition is never modified or redeployed.
- `scripts/migration/3-RUN-MIGRATION-run-task.ps1` requires typing `RUN MIGRATION`
  exactly before it will call `aws ecs run-task`.
