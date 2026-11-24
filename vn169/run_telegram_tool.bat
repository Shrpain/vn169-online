@echo off
setlocal
cd /d D:\tooll

echo Restarting Telegram Tool in background with latest logic: WIN +1, LOSE reset to level 1...
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
timeout /t 3 /nobreak >nul

if exist "D:\tooll\bot_poll.lock" (
  echo Removing stale bot poll lock...
  del /f /q "D:\tooll\bot_poll.lock" >nul 2>&1
)

if exist "D:\tooll\watcher.lock" (
  echo Removing stale watcher lock...
  del /f /q "D:\tooll\watcher.lock" >nul 2>&1
)

echo Starting new hidden watcher from watch_group_messages.js...
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\tooll\start_watcher_hidden.ps1"

timeout /t 2 /nobreak >nul

echo Sending Telegram restart notification...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$token = (Get-Content -LiteralPath 'D:\tooll\bot.txt' -Raw -ErrorAction SilentlyContinue).Trim(); $chatFile = 'D:\tooll\bot_chat.json'; if ($token -and (Test-Path -LiteralPath $chatFile)) { $chatId = (Get-Content -LiteralPath $chatFile -Raw | ConvertFrom-Json).chat_id; if ($chatId) { $body = @{ chat_id = $chatId; text = 'START BAT pressed: tool is restarting with latest logic: WIN +1, LOSE reset to level 1.' } | ConvertTo-Json -Compress; Invoke-RestMethod -Uri ('https://api.telegram.org/bot' + $token + '/sendMessage') -Method Post -ContentType 'application/json' -Body $body | Out-Null } }"

echo.
echo Khoi dong lai thanh cong. Tool dang chay ngam.
echo Log file: D:\tooll\logs\watcher-supervisor.log
echo.
pause
