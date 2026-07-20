@echo off
title EYECO Startup Script

echo ==================================================
echo         EYECO System Auto-Startup Script
echo ==================================================
echo.

:: Check for Node.js modules
if not exist node_modules (
    echo [INFO] node_modules not found. Installing Node.js dependencies...
    call npm install
)

:: Check for Python virtual environment
cd ai_service
if not exist .venv (
    echo [INFO] Python virtual environment not found. Creating it...
    python -m venv .venv
    echo [INFO] Installing Python requirements...
    call .venv\Scripts\pip.exe install -r requirements.txt
)
cd ..

:: Ensure weights folder and model files exist
if not exist weights (
    mkdir weights
)
if not exist weights\yolov8-river-v1.0.pt (
    if exist ai_service\yolov8n.pt (
        echo [INFO] Copying yolov8n.pt to weights/yolov8-river-v1.0.pt...
        copy ai_service\yolov8n.pt weights\yolov8-river-v1.0.pt
    ) else (
        echo [WARNING] yolov8n.pt not found. The AI Service will download it automatically on startup.
    )
)

:: Start Python AI Service
echo [INFO] Launching Python AI Service on Port 8005...
start "EYECO AI Service (Port 8005)" cmd /k "cd ai_service && set PORT=8005 && .venv\Scripts\python.exe app.py"

:: Start Node.js backend
echo [INFO] Launching Node.js Backend Server...
npm run dev

pause
