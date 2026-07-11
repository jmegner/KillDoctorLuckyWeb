@echo off
setlocal
cd /d "%~dp0"

if not exist "simple_room_info_extractor.py" (
  echo simple_room_info_extractor.py was not found in:
  echo %~dp0
  pause
  exit /b 1
)

where pyw >nul 2>&1
if not errorlevel 1 (
  start "" pyw -3 "simple_room_info_extractor.py" %*
  exit /b 0
)

where pythonw >nul 2>&1
if not errorlevel 1 (
  start "" pythonw "simple_room_info_extractor.py" %*
  exit /b 0
)

where py >nul 2>&1
if not errorlevel 1 (
  py -3 "simple_room_info_extractor.py" %*
  pause
  exit /b %errorlevel%
)

where python >nul 2>&1
if not errorlevel 1 (
  python "simple_room_info_extractor.py" %*
  pause
  exit /b %errorlevel%
)

echo A Python launcher was not found on PATH.
echo If Python is installed, try reinstalling with the Python Launcher enabled,
echo or run simple_room_info_extractor.py manually from a terminal:
echo python simple_room_info_extractor.py
pause
exit /b 1
