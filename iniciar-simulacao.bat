@echo off
title Polymarket Bot - SIMULACAO
color 0E

echo ============================================================
echo   POLYMARKET ARBITRAGE BOT - MODO SIMULACAO
echo   Nenhuma ordem real sera executada
echo ============================================================
echo.

cd /d "%~dp0"

echo [1/2] Compilando TypeScript...
call npm run build
if %errorlevel% neq 0 (
    echo ERRO na compilacao! Verifique o codigo.
    pause
    exit /b 1
)

echo [2/2] Iniciando simulacao...
echo.
node dist/main.js --simulation

echo.
echo Simulacao encerrada.
pause
