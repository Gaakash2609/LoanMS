@echo off
echo.
echo  Starting LoanMS + InCred Proxy...
echo.
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Node.js is not installed!
    echo  Please install from https://nodejs.org/
    pause
    exit /b 1
)
cd /d "%~dp0"
echo  Server starting on http://localhost:7070
echo  Opening browser...
timeout /t 2 /nobreak >nul
start http://localhost:7070
node incred-proxy.js
pause
