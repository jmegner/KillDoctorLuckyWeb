@echo off
setlocal
cd /d "%~dp0"

set "IMAGE_PATH=%~dp0..\..\public\BoardMainWestWingClosed.jpg"

if not exist "room_helper.py" (
  echo room_helper.py was not found in:
  echo %~dp0
  pause
  exit /b 1
)

if not exist "%IMAGE_PATH%" (
  echo Board image was not found:
  echo %IMAGE_PATH%
  pause
  exit /b 1
)

where pyw >nul 2>&1
if not errorlevel 1 (
  start "" pyw -3 "room_helper.py" "%IMAGE_PATH%"
  exit /b 0
)

where pythonw >nul 2>&1
if not errorlevel 1 (
  start "" pythonw "room_helper.py" "%IMAGE_PATH%"
  exit /b 0
)

echo A GUI Python launcher was not found on PATH.
echo This launcher needs pyw.exe or pythonw.exe so it can start without a console window.
echo.
echo If Python is installed, try reinstalling with the Python Launcher enabled,
echo or run room_helper.py manually from a terminal:
echo python room_helper.py "%IMAGE_PATH%"
pause
exit /b 1
