@echo off
setlocal
cd /d "D:\tooll"

echo Restarting Telegram Tool in foreground with latest logic: WIN +1, LOSE reset to level 1...
echo Current folder: %CD%
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js was not found in PATH.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies first...
  call npm install
)

echo Stopping old watcher processes...
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\tooll\kill_tool_processes.ps1"
timeout /t 2 /nobreak >nul

if exist "D:\tooll\bot_poll.lock" del /f /q "D:\tooll\bot_poll.lock" >nul 2>&1
if exist "D:\tooll\watcher.lock" del /f /q "D:\tooll\watcher.lock" >nul 2>&1

echo Running watch_group_messages.js...
node watch_group_messages.js
pause
