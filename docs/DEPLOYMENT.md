# CI/CD & AWS Deployment — Change Log

## What was built

A fully automated CI/CD pipeline deploying a .NET 10 API + React 19 frontend as a single Docker image to AWS ECS Fargate, triggered on every push to `main`.

---

## Architecture

```
GitHub push → GitHub Actions CI → GitHub Actions CD
                                        ↓
                             Build Docker image (linux/amd64)
                                        ↓
                             Push to Amazon ECR
                                        ↓
                       Register new ECS task definition revision
                                        ↓
                       Update ECS Fargate service (rolling deploy)
                                        ↓
                    ALB health check on /health → traffic switches
                                        ↓
                              RDS PostgreSQL (private)
```

---

## Files added to the repo

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage build: Node 22 builds React frontend, .NET SDK 10 publishes API, .NET ASP.NET 10 is the runtime. All stages pinned to `linux/amd64` for ECS Fargate. |
| `.dockerignore` | Excludes `node_modules`, `bin`, `obj`, `.env`, etc. from build context. |
| `ecs-task-def.json` | ECS task definition: Fargate, 0.5 vCPU / 1 GB RAM, port 8080, env vars from `.ebextensions` replaced by Secrets Manager references. |
| `.github/workflows/ci.yml` | PR workflow: frontend lint + type-check + build, dotnet restore + build + test. |
| `.github/workflows/cd-ecs.yml` | Push-to-main workflow: AWS auth → ECR login → Docker build + push → render task def → ECS deploy → wait for stability. |
| `docs/aws-ecs-cicd.md` | Full step-by-step AWS setup instructions. |
| `set_github_secrets.py` | One-time script used to set GitHub Actions variables via API. Deleted after use. |

---

## AWS resources provisioned

| Resource | Name | Notes |
|---|---|---|
| ECR | `loanms` | Stores Docker images with `scanOnPush=true` |
| ECS Cluster | `loanms-prod` | Fargate, no EC2 to manage |
| ECS Service | `loanms-api` | Desired count 1, linked to ALB |
| ALB | `loanms-alb` | Public, health check on `/health` |
| RDS PostgreSQL | `loanms-db` | `loanms-db.cp8c8okmwou1.ap-south-1.rds.amazonaws.com` |
| Secrets Manager | `loanms/prod/jwt-key` | Holds `JwtKey` — injected as `ASPNETCORE_Jwt__Key` |
| Secrets Manager | `loanms/prod/db` | Holds `ConnectionString` — injected as `ConnectionStrings__PostgreSQL` |
| IAM Role | `ecsTaskExecutionRole` | Pulls ECR image, reads Secrets Manager, writes CloudWatch logs |
| IAM Role | `ecsTaskRole` | App runtime permissions (extend as needed) |
| IAM User | `github-actions-deploy` | Scoped to ECR push + ECS deploy only |
| CloudWatch Logs | `/ecs/loanms-prod` | 30-day retention |

---

## GitHub repository secrets and variables

| Type | Name | Value |
|---|---|---|
| Secret | `AWS_ACCESS_KEY_ID` | IAM user `github-actions-deploy` key |
| Secret | `AWS_SECRET_ACCESS_KEY` | IAM user `github-actions-deploy` secret |
| Variable | `AWS_REGION` | `ap-south-1` |
| Variable | `ECR_REPOSITORY` | `loanms` |
| Variable | `ECS_CLUSTER` | `loanms-prod` |
| Variable | `ECS_SERVICE` | `loanms-api` |

---

## Key fixes applied during setup

| Issue | Fix |
|---|---|
| EB rolling update stuck on `t3.micro` — ASG CloudFormation timeout | Abandoned EB; moved to ECS Fargate (no ASG/rolling-update complexity) |
| Docker image built on Apple Silicon (ARM64), ECS needs `linux/amd64` | Added `--platform=linux/amd64` to all Dockerfile `FROM` stages |
| GitHub Actions `Set up job` failure — wrong action name | Fixed `amazon-ecs-deploy-task-def` → `amazon-ecs-deploy-task-definition` (correct AWS action name) |
| OIDC `id-token: write` not working on private repo Free plan | Switched to IAM access keys stored as GitHub secrets |
| `appsettings.json` contained plaintext secrets | Removed from config; JWT key and DB connection string stored in AWS Secrets Manager and injected at container startup via ECS task definition `secrets` field |
| `.ebextensions/` config not being applied | Removed EB entirely; config now lives in `ecs-task-def.json` |

---

## How deployments work going forward

1. Open a PR → CI runs automatically (lint, type-check, build, tests).
2. Merge to `main` → CD runs automatically:
   - Builds `linux/amd64` Docker image tagged with the 12-char git SHA.
   - Pushes image to ECR (also updates `:latest`).
   - Creates a new ECS task definition revision pointing to the new image.
   - Updates the ECS service; waits up to 15 min for stability.
3. If the new task fails health checks on `/health`, ECS keeps the old tasks running — no downtime.

## Rollback

```bash
# Roll back to a specific task definition revision
aws ecs update-service \
  --cluster loanms-prod \
  --service loanms-api \
  --task-definition loanms-prod:<REVISION_NUMBER> \
  --region ap-south-1
```
