@echo off
REM ============================================================
REM  Push to GitHub and VERIFY against the real remote
REM ============================================================
REM  Why this exists: after "git push", verifying with
REM  "git fetch + compare local refs" is NOT reliable --
REM  if fetch fails silently, the local origin/main keeps its
REM  stale value and you wrongly conclude "already synced".
REM  On 2026-10-07 that caused two commits to be missed.
REM  This script asks the remote directly via git ls-remote.
REM
REM  NOTE: this file must stay PURE ASCII with CRLF line endings.
REM  cmd.exe parses .bat with the system ANSI codepage; UTF-8
REM  Chinese text breaks parsing. Chinese output comes from Python.
REM ============================================================
setlocal
cd /d "%~dp0.."

echo.
echo === 1. Current branch ===
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
echo     branch: %BRANCH%
if not "%BRANCH%"=="main" (
  echo.
  echo     [WARN] Not on branch main.
  echo     Pushing now would push MAIN, not your new commits.
  echo     Run:  git checkout main
  echo.
  pause
  exit /b 1
)

echo.
echo === 2. Working tree ===
git status --short
echo     (empty above = everything committed)

echo.
echo === 3. Commit ===
git add -A
git commit -m "update"

echo.
echo === 4. Push ===
git push origin main

echo.
echo === 5. Verify against the REAL remote ===
for /f "delims=" %%h in ('git rev-parse HEAD') do set LOCAL=%%h
for /f "tokens=1" %%h in ('git ls-remote origin main') do set REMOTE=%%h

echo     local : %LOCAL%
echo     remote: %REMOTE%

if "%LOCAL%"=="%REMOTE%" (
  echo.
  echo     [OK] Really synced.
) else (
  echo.
  echo     [FAIL] NOT pushed. Local and remote differ.
  echo     Most common cause: proxy is off
  echo     (error: Failed to connect to github.com)
  echo     Start your proxy, then run this script again.
)

echo.
pause
endlocal
