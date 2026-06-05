@echo off
cd /d %~dp0
py -3 -c "import pypdf" 2>nul
if errorlevel 1 (
  echo Installing PDF dependency...
  py -3 -m pip install -r requirements.txt
)
py -3 server.py
if errorlevel 1 python server.py
pause
