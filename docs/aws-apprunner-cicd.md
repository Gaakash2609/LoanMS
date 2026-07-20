# AWS App Runner CI/CD — Step-by-step (replaces Elastic Beanstalk)

## Why we switched from Elastic Beanstalk

The EB environment repeatedly got stuck in `Updating`/`Severe` health because:
- Rolling updates on a single `t3.micro` instance require a resource signal within a timeout window; if the container fails to start in time, the ASG update fails and CloudFormation gets stuck in `UPDATE_ROLLBACK_IN_PROGRESS`.
- EB's health check + ASG + ALB stack has many moving parts that can desync (e.g. config drift between console updates and `.ebextensions`).
- Diagnosing failures required SSH/SSM access to a terminated instance, which is slow.

**App Runner** removes the ASG/ALB/CloudFormation layer entirely. You give it an ECR image and a port; AWS manages scaling, health checks, and rollout — no stuck rolling updates.

## Architecture

- ECR — stores the Docker image (same [Dockerfile](../Dockerfile) as before)
- App Runner service — pulls the image, runs it, auto-scales, terminates unhealthy instances automatically
- RDS PostgreSQL — reached via an App Runner **VPC Connector** (private subnets)
- Secrets Manager — holds `Jwt__Key` and DB connection string (referenced directly by App Runner, not baked into the image or committed to git)
- GitHub Actions — builds/pushes the image and calls `aws apprunner update-service`

## Step 1 — Create the ECR repository

```bash
aws ecr create-repository --repository-name loanms --region ap-south-1 \
  --image-scanning-configuration scanOnPush=true
```

## Step 2 — Store secrets in AWS Secrets Manager

```bash
aws secretsmanager create-secret --name loanms/prod/jwt-key \
  --secret-string '{"JwtKey":"REPLACE_WITH_32PLUS_CHAR_SECRET"}'

aws secretsmanager create-secret --name loanms/prod/db \
  --secret-string '{"ConnectionString":"Host=loanms-db.xxxx.ap-south-1.rds.amazonaws.com;Database=loanms;Username=loanms_admin;Password=REPLACE_ME"}'
```

## Step 3 — Create a VPC Connector (so App Runner can reach RDS)

```bash
aws apprunner create-vpc-connector \
  --vpc-connector-name loanms-vpc-connector \
  --subnets subnet-aaaa subnet-bbbb \
  --security-groups sg-xxxxxxxx
```

Use the private subnets your RDS instance lives in, and a security group that RDS allows inbound access from.

## Step 4 — Create an App Runner instance role (reads secrets)

Trust policy (`apprunner-trust.json`):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "tasks.apprunner.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

```bash
aws iam create-role --role-name AppRunnerInstanceRole \
  --assume-role-policy-document file://apprunner-trust.json

aws iam put-role-policy --role-name AppRunnerInstanceRole \
  --policy-name AppRunnerSecretsAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      { "Effect": "Allow", "Action": "secretsmanager:GetSecretValue",
        "Resource": [
          "arn:aws:secretsmanager:ap-south-1:ACCOUNT_ID:secret:loanms/prod/jwt-key-*",
          "arn:aws:secretsmanager:ap-south-1:ACCOUNT_ID:secret:loanms/prod/db-*"
        ] }
    ]
  }'
```

## Step 5 — Build and push the first image manually (bootstrap)

```bash
aws ecr get-login-password --region ap-south-1 \
  | docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com

docker build -t loanms:bootstrap .
docker tag loanms:bootstrap ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/loanms:bootstrap
docker push ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/loanms:bootstrap
```

## Step 6 — Create the App Runner service

```bash
aws apprunner create-service \
  --service-name loanms-prod \
  --source-configuration '{
    "ImageRepository": {
      "ImageIdentifier": "ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/loanms:bootstrap",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": {
        "Port": "8080",
        "RuntimeEnvironmentVariables": {
          "ASPNETCORE_ENVIRONMENT": "Production",
          "Database__Provider": "postgresql"
        },
        "RuntimeEnvironmentSecrets": {
          "ASPNETCORE_Jwt__Key": "arn:aws:secretsmanager:ap-south-1:ACCOUNT_ID:secret:loanms/prod/jwt-key:JwtKey::",
          "ConnectionStrings__PostgreSQL": "arn:aws:secretsmanager:ap-south-1:ACCOUNT_ID:secret:loanms/prod/db:ConnectionString::"
        }
      }
    },
    "AutoDeploymentsEnabled": false
  }' \
  --instance-configuration '{
    "Cpu": "1 vCPU",
    "Memory": "2 GB",
    "InstanceRoleArn": "arn:aws:iam::ACCOUNT_ID:role/AppRunnerInstanceRole"
  }' \
  --network-configuration '{
    "EgressConfiguration": {
      "EgressType": "VPC",
      "VpcConnectorArn": "arn:aws:apprunner:ap-south-1:ACCOUNT_ID:vpcconnector/loanms-vpc-connector/..."
    }
  }' \
  --health-check-configuration '{
    "Protocol": "HTTP",
    "Path": "/health",
    "Interval": 10,
    "Timeout": 5,
    "HealthyThreshold": 1,
    "UnhealthyThreshold": 5
  }'
```

Note the returned `ServiceArn` — you'll need it for GitHub variables.

## Step 7 — GitHub OIDC role for CI/CD

Same OIDC trust as before, but the policy needs App Runner + ECR permissions instead of Elastic Beanstalk:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["ecr:GetAuthorizationToken"], "Resource": "*" },
    { "Effect": "Allow", "Action": [
        "ecr:BatchCheckLayerAvailability","ecr:InitiateLayerUpload","ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload","ecr:PutImage","ecr:CreateRepository","ecr:DescribeRepositories",
        "ecr:BatchGetImage","ecr:GetDownloadUrlForLayer"
      ], "Resource": "*" },
    { "Effect": "Allow", "Action": [
        "apprunner:UpdateService","apprunner:DescribeService"
      ], "Resource": "arn:aws:apprunner:ap-south-1:ACCOUNT_ID:service/loanms-prod/*" }
  ]
}
```

## Step 8 — GitHub repository variables & secrets

Secrets:
- `AWS_ROLE_TO_ASSUME`

Variables:
- `AWS_REGION` = `ap-south-1`
- `ECR_REPOSITORY` = `loanms`
- `APPRUNNER_SERVICE_ARN` = the ARN from Step 6

## Step 9 — CI/CD pipeline behavior

- CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)): runs on PRs — builds frontend, lints, type-checks, builds/tests the API.
- CD ([`.github/workflows/cd-apprunner.yml`](../.github/workflows/cd-apprunner.yml)): runs on push to `main` — builds the Docker image, pushes to ECR, calls `apprunner update-service` with the new image, waits for `RUNNING` status.

## Step 10 — Local verification before every deploy

```bash
docker build -t loanms:local .
docker run \
  -e ASPNETCORE_ENVIRONMENT=Production \
  -e Database__Provider=postgresql \
  -e ASPNETCORE_Jwt__Key="REPLACE_WITH_32PLUS_CHAR_SECRET" \
  -e ConnectionStrings__PostgreSQL="Host=...;Database=loanms;Username=...;Password=..." \
  -p 8080:8080 loanms:local

curl http://localhost:8080/health
```

## Rollback

App Runner keeps the previous deployment automatically; if the new deployment fails health checks it does **not** cut over traffic (unlike EB's forced rolling update). To roll back manually to a known-good image tag:

```bash
aws apprunner update-service \
  --service-arn "$APPRUNNER_SERVICE_ARN" \
  --source-configuration "ImageRepository={ImageIdentifier=ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/loanms:<previous-good-tag>,ImageRepositoryType=ECR,ImageConfiguration={Port=8080}}"
```

## Monitoring

- App Runner ships logs to CloudWatch Logs automatically (`/aws/apprunner/loanms-prod/.../application` and `.../service`).
- Add CloudWatch Alarms on `4xxStatusResponses`, `5xxStatusResponses`, and RDS CPU/storage.
