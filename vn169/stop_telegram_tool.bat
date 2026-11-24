@echo off
setlocal
cd /d D:\tooll

echo Stopping all Telegram Tool processes...
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\tooll\kill_tool_processes.ps1"

if exist "D:\tooll\bot_poll.lock" del /f /q "D:\tooll\bot_poll.lock" >nul 2>&1
if exist "D:\tooll\watcher.lock" del /f /q "D:\tooll\watcher.lock" >nul 2>&1

echo.
echo Da dung hoan toan tool.
echo.
pause
