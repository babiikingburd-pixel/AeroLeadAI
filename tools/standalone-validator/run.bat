@echo off
setlocal
cd /d "%~dp0"

if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)
call venv\Scripts\activate.bat

echo Installing dependencies...
pip install -r requirements.txt --quiet

if "%SUPABASE_URL%"=="" if not exist config.env (
    echo.
    echo ============================================
    echo  Missing config. Copy config.env.example to
    echo  config.env and fill it in, or set
    echo  SUPABASE_URL / SUPABASE_KEY as environment
    echo  variables.
    echo ============================================
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Starting standalone validator
echo  Press Ctrl+C to stop
echo ============================================
echo.

rem validator.py reads config.env itself -- nothing to load here.
python validator.py

pause
