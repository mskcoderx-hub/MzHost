@echo off
setlocal
cd /d "%~dp0"
node src\server\preview.cjs %*
if errorlevel 1 pause
