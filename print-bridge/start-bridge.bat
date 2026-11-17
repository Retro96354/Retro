@echo off
cd /d "%~dp0"
title Print Bridge
:loop
node server.js
echo Bridge band ho gaya, 3 second me dobara start...
timeout /t 3 /nobreak >nul
goto loop
