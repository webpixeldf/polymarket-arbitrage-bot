@echo off
title Polymarket Bot - PRODUCAO
color 0A

echo ============================================================
echo   POLYMARKET ARBITRAGE BOT - MODO PRODUCAO
echo   Ordens REAIS serao executadas!
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

echo [2/2] Iniciando bot...
echo.
node dist/main.js --production

echo.
echo Bot encerrado.
pause
