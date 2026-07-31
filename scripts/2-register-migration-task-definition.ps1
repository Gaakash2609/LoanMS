# -- PREPARATION ONLY -- does NOT touch the staging database --
# Registers the dedicated loanms-migration ECS task definition.
# Does not create, modify, or affect the existing loanms-prod service in any way.

$ErrorActionPreference = "Stop"
$Region = "ap-south-1"

Write-Host "== 6. Register migration task definition ==" -ForegroundColor Cyan
$registerArgs = @(
    "ecs", "register-task-definition",
    "--cli-input-json", "file://ecs-task-def-migration.json",
    "--region", $Region
)
aws @registerArgs

Write-Host ""
Write-Host "Task definition 'loanms-migration' registered." -ForegroundColor Green
Write-Host "This step only registered a task definition - the staging database was not touched." -ForegroundColor Green
Write-Host ""
Write-Host "Next step actually runs the migration - do this only when you're ready:" -ForegroundColor Red
Write-Host "  .\scripts\3-RUN-MIGRATION-run-task.ps1" -ForegroundColor Red
