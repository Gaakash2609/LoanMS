# AWS Elastic Beanstalk CI/CD (client-ready)

This repo now has one clean path:
- CI: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
- CD: [`.github/workflows/cd-eb.yml`](../.github/workflows/cd-eb.yml)
- Docker image: [`Dockerfile`](../Dockerfile)
- EB runtime config: [`.ebextensions/01-environment.config`](../.ebextensions/01-environment.config)

## Recommended AWS architecture

- Elastic Beanstalk application: Docker platform, single container
- 2 EC2 instances behind ALB for production
- RDS PostgreSQL in private subnets
- Optional ElastiCache Redis in private subnets
- ECR for image storage
- S3 bucket for EB deployment bundles
- Route53 + ACM for HTTPS

## Step 1 — Prepare the repo and Docker image

1. Keep only one deploy workflow path: `cd-eb.yml` is the active CD file.
2. Ensure the repo root contains `Dockerfile` and `.dockerignore`.
3. Confirm the Dockerfile does a multi-stage build:
	- build the React app from `frontend/`
	- publish `LoanMS.API`
	- copy the frontend output into `LoanMS.API/wwwroot/react`
	- run the app on port `8080`
4. Build and run locally before touching AWS:

```bash
docker build -t loanms:local .
docker run -e Jwt__Key="YOUR_SECRET_32_CHARS_MINIMUM________" -p 8080:8080 loanms:local
```

5. Open `http://localhost:8080` and confirm the app responds.
6. Make sure any secrets currently in `LoanMS.API/appsettings.json` are removed before the client deploy.

## Step 2 — Prepare the AWS foundation

1. Create an ECR repository for the API image.
2. Create an S3 bucket for Elastic Beanstalk application versions.
3. Create an Elastic Beanstalk application and environment.
4. Create RDS PostgreSQL and note the connection string.
5. Optional: create Redis and note the connection string.
6. Request an ACM certificate and point Route53 to the EB CNAME or ALB.

## Step 3 — Configure Elastic Beanstalk

Set these EB environment properties:

- `Database__Provider=postgresql`
- `ConnectionStrings__PostgreSQL=<your RDS string>`
- `Jwt__Key=<secure 32+ char secret>`
- `AI__Enabled`, `AI__Provider`, `AI__ApiKey` if used
- `Redis__Enabled`, `Redis__ConnectionString` if used

The `.ebextensions/01-environment.config` file already sets:
- Production environment
- `/health` health check path
- Rolling deployment policy
- CloudWatch log streaming

## Step 4 — Set up GitHub OIDC

Create an IAM role for GitHub Actions with:

- Trust to `token.actions.githubusercontent.com`
- Condition restricted to your repo and `main` branch
- Permissions for ECR push, S3 upload, and Elastic Beanstalk version updates

Store the role ARN in GitHub secret:
- `AWS_ROLE_TO_ASSUME`

## Step 5 — Add GitHub repository variables

In GitHub → Settings → Secrets and variables → Actions:

Secrets:
- `AWS_ROLE_TO_ASSUME`

Variables:
- `AWS_REGION`
- `ECR_REPOSITORY`
- `EB_APPLICATION_NAME`
- `EB_ENVIRONMENT_NAME`
- `EB_S3_BUCKET`

## Step 6 — CI pipeline behavior

On pull requests, [CI workflow](../.github/workflows/ci.yml) does:

1. Checkout code
2. Install frontend dependencies
3. Run frontend lint
4. Run frontend type-check
5. Build frontend
6. Restore .NET dependencies
7. Build the API
8. Run backend tests

## Step 7 — CD pipeline behavior

On push to `main`, [CD workflow](../.github/workflows/cd-eb.yml) does:

1. Assumes the AWS role via OIDC
2. Ensures the ECR repo exists
3. Builds the Docker image from [Dockerfile](../Dockerfile)
4. Pushes the image to ECR
5. Creates a `Dockerrun.aws.json` bundle
6. Uploads it to S3
7. Creates a new Elastic Beanstalk application version
8. Updates the EB environment
9. Waits for the rollout to finish

## Step 8 — First production deploy checklist

- Rotate any secrets previously stored in `appsettings.json`
- Set real CORS origins for the client domain
- Confirm EB instance profile can pull from ECR
- Confirm the RDS security group allows EB instances
- Confirm `/health` returns 200 before enabling traffic

## Step 9 — Local verification

Open `http://localhost:8080` and verify the app responds.

## Best-practice deployment choice for a client

- Use Elastic Beanstalk if you want the simplest reliable rollout.
- Use ECS Fargate if you want more control and future horizontal scaling.
- For this repo, EB is the fastest path to a professional client deployment.

## If you want me to continue

I can generate either of these next:
- a Terraform/CloudFormation stack for ECR + EB + RDS + IAM, or
- a client-ready AWS checklist and launch plan you can hand over directly.
