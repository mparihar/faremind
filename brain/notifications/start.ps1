# FareMind Notification Service — Windows startup script
# Run from: brain/notifications/
# Requires Python 3.11+

if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment..."
    python -m venv .venv
}

.\.venv\Scripts\Activate.ps1

Write-Host "Installing dependencies..."
pip install -q -r requirements.txt

Write-Host "Starting FareMind Notification Service on port 8001..."
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
