@echo off
echo ================================================
echo   EFIN LoanMS - Starting Server
echo ================================================
echo.

echo Starting server on http://localhost:7070
echo.
echo Login credentials:
echo   Admin:   admin@efin.com   / Admin@123
echo   Manager: manager@efin.com / Manager@123
echo   Sales:   sales@efin.com   / Sales@123
echo.
cd LoanMS.API
dotnet run
