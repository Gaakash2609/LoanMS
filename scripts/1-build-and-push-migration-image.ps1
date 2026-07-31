# -- PREPARATION ONLY -- does NOT touch the staging database --
# Builds and pushes the migration runner image to its own ECR repository.
# Run this from the repository root (same folder as Dockerfile.migration and
# migration-bundle/efbundle).

$ErrorActionPreference = "Stop"

$Region        = "ap-south-1"
$AccountId     = "664418956749"
$RepoName      = "loanms-migration"
$ImageTag      = "latest"
$EcrRegistry   = "${AccountId}.dkr.ecr.${Region}.amazonaws.com"
$ImageUriLocal = "${RepoName}:${ImageTag}"
$ImageUriEcr   = "${EcrRegistry}/${RepoName}:${ImageTag}"

# ---------------------------------------------------------------------------
# Helper: run a native command and stop the script immediately if it fails.
# $ErrorActionPreference = "Stop" only affects PowerShell cmdlets/terminating
# errors - it does NOT make the script stop when a native .exe (docker, aws)
# returns a non-zero exit code. Every native call below is checked explicitly.
# ---------------------------------------------------------------------------
function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Command,
        [Parameter(Mandatory = $true)][string]$FailureMessage
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code $LASTEXITCODE)"
    }
}

# ---------------------------------------------------------------------------
# Helper: confirm the Docker daemon is actually reachable before we rely on it.
# ---------------------------------------------------------------------------
function Test-DockerRunning {
    docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Docker Engine is not running. Start Docker Desktop and retry." -ForegroundColor Red
        exit 1
    }
}

if (-not (Test-Path ".\migration-bundle\efbundle")) {
    throw "migration-bundle\efbundle not found. Run 'dotnet ef migrations bundle ...' first (see docs\MIGRATION-RUNNER.md)."
}

Write-Host "== 0. Verify Docker Engine is running ==" -ForegroundColor Cyan
Test-DockerRunning

Write-Host "== 1. Ensure ECR repository '$RepoName' exists ==" -ForegroundColor Cyan
aws ecr describe-repositories --repository-names $RepoName --region $Region 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Repository not found - creating it (image scanning + AES256 encryption enabled)." -ForegroundColor Yellow
    $createArgs = @(
        "ecr", "create-repository",
        "--repository-name", $RepoName,
        "--region", $Region,
        "--image-scanning-configuration", "scanOnPush=true",
        "--encryption-configuration", "encryptionType=AES256"
    )
    Invoke-Checked -Command { aws @createArgs } -FailureMessage "Failed to create ECR repository '$RepoName'."
} else {
    Write-Host "Repository already exists - skipping creation." -ForegroundColor Green
}

Write-Host "== 2. Login to ECR ==" -ForegroundColor Cyan
$loginPassword = aws ecr get-login-password --region $Region
if ($LASTEXITCODE -ne 0) {
    throw "Failed to retrieve ECR login password from AWS CLI (exit code $LASTEXITCODE)."
}
$loginPassword | docker login --username AWS --password-stdin $EcrRegistry
if ($LASTEXITCODE -ne 0) {
    throw "Docker login to ECR registry '$EcrRegistry' failed (exit code $LASTEXITCODE)."
}

Write-Host "== 3. Build migration image ==" -ForegroundColor Cyan
Invoke-Checked -Command { docker build -f Dockerfile.migration -t $ImageUriLocal . } `
    -FailureMessage "Docker build failed for '$ImageUriLocal'."

Write-Host "== 4. Tag image for ECR ==" -ForegroundColor Cyan
Invoke-Checked -Command { docker tag $ImageUriLocal $ImageUriEcr } `
    -FailureMessage "Docker tag failed for '$ImageUriLocal' -> '$ImageUriEcr'."

Write-Host "== 5. Push image to ECR ==" -ForegroundColor Cyan
Invoke-Checked -Command { docker push $ImageUriEcr } `
    -FailureMessage "Docker push failed for '$ImageUriEcr'."

Write-Host ""
Write-Host "Done. Image pushed: $ImageUriEcr" -ForegroundColor Green
Write-Host "This step only built and pushed an image - the staging database was not touched." -ForegroundColor Green
Write-Host "Next: run .\scripts\2-register-migration-task-definition.ps1" -ForegroundColor Yellow
