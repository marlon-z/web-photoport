@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer from https://nodejs.org/en/download
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)"
if errorlevel 1 (
  echo Node.js 22 or newer is required. Update Node.js, then reopen this launcher.
  pause
  exit /b 1
)
if not exist node_modules\sharp\package.json (
  echo Installing locked dependencies from npm. No cloud services are purchased.
  call npm ci
  if errorlevel 1 (
    echo Installation failed. Check your network and try again.
    pause
    exit /b 1
  )
)
echo Open http://127.0.0.1:4180/app in your browser. Keep this window open.
call npm start
pause

