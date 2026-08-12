# -- THIS SCRIPT ACTUALLY RUNS THE MIGRATION AGAINST STAGING RDS --
# Everything in scripts/1 and scripts/2 was preparation only (build/push image,
# register task definition). Running THIS script is the one action that
# connects to the staging database and applies pending migrations.
#
# Target: staging RDS only (loanms-staging). This never touches loanms/prod/db
# and never modifies the existing loanms-prod ECS service.

$ErrorActionPreference = "Stop"

$Region         = "ap-south-1"
$Cluster        = "loanms-prod"
$TaskDefinition = "loanms-migration"
$Subnet         = "subnet-08ff88751801fc7d7"
$SecurityGroup  = "sg-0ac160b45dff88a33"

Write-Host "=================================================================" -ForegroundColor Red
Write-Host " THIS WILL RUN EF CORE MIGRATIONS AGAINST STAGING RDS:" -ForegroundColor Red
Write-Host "   loanms-staging.cp8c8okmwou1.ap-south-1.rds.amazonaws.com" -ForegroundColor Red
Write-Host " Cluster: $Cluster | Task definition: $TaskDefinition" -ForegroundColor Red
Write-Host " Subnet: $Subnet | Security group: $SecurityGroup | assignPublicIp: DISABLED" -ForegroundColor Red
Write-Host "=================================================================" -ForegroundColor Red
$confirm = Read-Host "Type EXACTLY 'RUN MIGRATION' to proceed, anything else cancels"
if ($confirm -ne "RUN MIGRATION") {
    Write-Host "Cancelled. Nothing was run." -ForegroundColor Yellow
    exit 1
}

Write-Host "== 7. Running one-off ECS migration task ==" -ForegroundColor Cyan
$networkConfig = "awsvpcConfiguration={subnets=[$Subnet],securityGroups=[$SecurityGroup],assignPublicIp=DISABLED}"
$runArgs = @(
    "ecs", "run-task",
    "--cluster", $Cluster,
    "--launch-type", "FARGATE",
    "--task-definition", $TaskDefinition,
    "--count", "1",
    "--network-configuration", $networkConfig,
    "--region", $Region
)
aws @runArgs

Write-Host ""
Write-Host "Task started. Watch it in CloudWatch Logs group /ecs/loanms-migration" -ForegroundColor Green
Write-Host "or with: aws logs tail /ecs/loanms-migration --follow --region $Region" -ForegroundColor Green
