# AWS ECS Fargate CI/CD — Step-by-step

## Why ECS Fargate

- Docker-native: runs your `Dockerfile` exactly as-is
- No EC2 instances to manage, no ASG rolling-update timeouts
- `aws-actions/amazon-ecs-deploy-task-def` is the battle-tested GitHub Action used by thousands of teams
- Blue/green ready via CodeDeploy when you need zero-downtime later
- Logs → CloudWatch automatically

## Architecture

```
GitHub → Actions → ECR (image) → ECS Fargate (service) → ALB → internet
                                         ↕
                               RDS PostgreSQL (private subnet)
```

- **ECR** — stores Docker images
- **ECS Cluster** — Fargate, no EC2 to manage
- **ECS Service** — runs 1–N tasks, ALB-integrated, auto-replaces unhealthy tasks
- **ALB** — public HTTPS endpoint, health check on `/health`
- **RDS PostgreSQL** — private subnet, security group allows only ECS tasks
- **Secrets Manager** — holds `Jwt__Key` and DB connection string
- **IAM** — one GitHub OIDC role (push to ECR + deploy ECS), one ECS task execution role (pull image + read secrets), one ECS task role (app permissions)

---

## Step 1 — Create ECR repository

```bash
aws ecr create-repository --repository-name loanms --region ap-south-1 \
  --image-scanning-configuration scanOnPush=true
```

Note the repository URI: `ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/loanms`

---

## Step 2 — Store secrets in Secrets Manager

```bash
# JWT signing key (must be 32+ chars)
aws secretsmanager create-secret \
  --name loanms/prod/jwt-key \
  --region ap-south-1 \
  --secret-string '{"JwtKey":"REPLACE_WITH_SECURE_32PLUS_CHAR_VALUE"}'

# RDS connection string
aws secretsmanager create-secret \
  --name loanms/prod/db \
  --region ap-south-1 \
  --secret-string '{"ConnectionString":"Host=loanms-db.cp8c8okmwou1.ap-south-1.rds.amazonaws.com;Database=loanms;Username=loanms_admin;Password=REPLACE_ME;Pooling=true;Minimum Pool Size=2;Maximum Pool Size=20"}'
```

---

## Step 3 — Create IAM roles

### 3a. ECS Task Execution Role (pull image + read secrets)

```bash
aws iam create-role --role-name ecsTaskExecutionRole \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"Service":"ecs-tasks.amazonaws.com"},
      "Action":"sts:AssumeRole"
    }]
  }'

# AWS managed policy — allows ECR pull + CloudWatch logs
aws iam attach-role-policy --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

# Allow reading secrets
aws iam put-role-policy --role-name ecsTaskExecutionRole \
  --policy-name SecretsManagerRead \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Action":"secretsmanager:GetSecretValue",
      "Resource":[
        "arn:aws:secretsmanager:ap-south-1:ACCOUNT_ID:secret:loanms/prod/jwt-key*",
        "arn:aws:secretsmanager:ap-south-1:ACCOUNT_ID:secret:loanms/prod/db*"
      ]
    }]
  }'
```

### 3b. ECS Task Role (app permissions — add S3/SES/etc here later)

```bash
aws iam create-role --role-name ecsTaskRole \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"Service":"ecs-tasks.amazonaws.com"},
      "Action":"sts:AssumeRole"
    }]
  }'
```

### 3c. GitHub OIDC Role (CI/CD)

Save as `github-trust.json` (replace `ORG`, `REPO`):
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringLike": {
        "token.actions.githubusercontent.com:sub": "repo:ORG/REPO:ref:refs/heads/main"
      }
    }
  }]
}
```

```bash
aws iam create-role --role-name GitHubActionsECSRole \
  --assume-role-policy-document file://github-trust.json

aws iam put-role-policy --role-name GitHubActionsECSRole \
  --policy-name ECRAndECSDeploy \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[
      {
        "Effect":"Allow",
        "Action":"ecr:GetAuthorizationToken",
        "Resource":"*"
      },
      {
        "Effect":"Allow",
        "Action":[
          "ecr:BatchCheckLayerAvailability","ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart","ecr:CompleteLayerUpload","ecr:PutImage",
          "ecr:CreateRepository","ecr:DescribeRepositories",
          "ecr:BatchGetImage","ecr:GetDownloadUrlForLayer"
        ],
        "Resource":"arn:aws:ecr:ap-south-1:ACCOUNT_ID:repository/loanms"
      },
      {
        "Effect":"Allow",
        "Action":[
          "ecs:RegisterTaskDefinition",
          "ecs:DescribeTaskDefinition",
          "ecs:DescribeServices",
          "ecs:UpdateService",
          "iam:PassRole"
        ],
        "Resource":"*"
      }
    ]
  }'
```

Note the role ARN — goes into GitHub secret `AWS_ROLE_TO_ASSUME`.

---

## Step 4 — Create CloudWatch Log Group

```bash
aws logs create-log-group --log-group-name /ecs/loanms-prod --region ap-south-1
aws logs put-retention-policy --log-group-name /ecs/loanms-prod \
  --retention-in-days 30 --region ap-south-1
```

---

## Step 5 — Update ecs-task-def.json with your account ID

In `ecs-task-def.json` (already in repo root), replace all `ACCOUNT_ID` with your real AWS account ID:

```bash
# Find your account ID
aws sts get-caller-identity --query Account --output text

# Replace in the file
sed -i '' 's/ACCOUNT_ID/YOUR_ACCOUNT_ID/g' ecs-task-def.json
```

---

## Step 6 — Bootstrap: push first image and create ECS cluster + service

### Push the first image manually

```bash
# Authenticate Docker to ECR
aws ecr get-login-password --region ap-south-1 \
  | docker login --username AWS \
    --password-stdin ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com

# Build and push
docker build -t loanms:bootstrap .
docker tag loanms:bootstrap \
  ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/loanms:bootstrap
docker push ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/loanms:bootstrap

# Also tag as latest
docker tag loanms:bootstrap \
  ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/loanms:latest
docker push ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/loanms:latest
```

### Create ECS Cluster

```bash
aws ecs create-cluster --cluster-name loanms-prod \
  --capacity-providers FARGATE --region ap-south-1
```

### Register the task definition

```bash
aws ecs register-task-definition \
  --cli-input-json file://ecs-task-def.json \
  --region ap-south-1
```

### Create the ALB, target group, and security groups

Do this via AWS Console (EC2 → Load Balancers → Create → Application Load Balancer):
- Scheme: Internet-facing
- Listener: HTTPS 443 (attach ACM certificate) + HTTP 80 → redirect to HTTPS
- Target group: IP type, port 8080, health check path `/health`
- Note the Target Group ARN

### Create ECS Service

```bash
aws ecs create-service \
  --cluster loanms-prod \
  --service-name loanms-api \
  --task-definition loanms-prod \
  --desired-count 2 \
  --launch-type FARGATE \
  --platform-version LATEST \
  --network-configuration "awsvpcConfiguration={
    subnets=[subnet-PRIVATE1,subnet-PRIVATE2],
    securityGroups=[sg-ECS_SG],
    assignPublicIp=DISABLED
  }" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:ap-south-1:ACCOUNT_ID:targetgroup/loanms/xxxx,containerName=loanms-api,containerPort=8080" \
  --health-check-grace-period-seconds 120 \
  --region ap-south-1
```

Note the service name — goes into GitHub variable `ECS_SERVICE`.

---

## Step 7 — GitHub repository secrets and variables

Go to: GitHub repo → Settings → Secrets and variables → Actions

**Secrets (sensitive values):**
| Secret | Value |
|---|---|
| `AWS_ROLE_TO_ASSUME` | ARN of the `GitHubActionsECSRole` from Step 3c |

**Variables (non-sensitive config):**
| Variable | Value |
|---|---|
| `AWS_REGION` | `ap-south-1` |
| `ECR_REPOSITORY` | `loanms` |
| `ECS_CLUSTER` | `loanms-prod` |
| `ECS_SERVICE` | `loanms-api` |

---

## Step 8 — How CI/CD works after this

**PR opened →** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs:
1. Frontend: `npm ci` → lint → type-check → build
2. Backend: `dotnet restore` → `dotnet build` → `dotnet test`

**Push to `main` →** [`.github/workflows/cd-ecs.yml`](.github/workflows/cd-ecs.yml) runs:
1. Assumes GitHub OIDC role (no long-lived keys)
2. Validates required variables exist
3. Logs into ECR
4. Builds Docker image and pushes with `GITHUB_SHA` tag
5. Renders a new ECS task definition with the new image URI
6. Calls `amazon-ecs-deploy-task-def` → creates new task definition revision → calls `UpdateService`
7. Waits up to 15 min for the service to reach steady state (new tasks healthy → old tasks drained and stopped)

**Rollback:** Simply re-trigger the workflow on a previous commit, or:
```bash
# Roll back to a previous task definition revision
aws ecs update-service \
  --cluster loanms-prod \
  --service loanms-api \
  --task-definition loanms-prod:PREVIOUS_REVISION \
  --region ap-south-1
```

---

## Step 9 — Verify after first deploy

```bash
# Test health endpoint
curl https://your-alb-domain/health

# Test login
curl -X POST https://your-alb-domain/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@efin.com","password":"Admin@123"}'

# Watch ECS service events
aws ecs describe-services \
  --cluster loanms-prod \
  --services loanms-api \
  --query 'services[0].events[:5]' \
  --output table \
  --region ap-south-1
```

---

## Local test before every deploy

```bash
docker build -t loanms:local .
docker run \
  -e ASPNETCORE_ENVIRONMENT=Production \
  -e Database__Provider=postgresql \
  -e ASPNETCORE_Jwt__Key="mnh5LU1K9NwCO5Df71tyTdvzDgKqDeBV" \
  -e ConnectionStrings__PostgreSQL="Host=loanms-db.cp8c8okmwou1.ap-south-1.rds.amazonaws.com;Database=loanms;Username=loanms_admin;Password=Loan8140" \
  -p 8080:8080 loanms:local

curl http://localhost:8080/health
```
