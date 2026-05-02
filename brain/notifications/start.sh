#!/bin/bash
# FareMind Notification Service — startup script
# Run from: brain/notifications/
# Requires Python 3.11+

set -e

# Install dependencies if venv doesn't exist
if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  python -m venv .venv
fi

source .venv/bin/activate

echo "Installing dependencies..."
pip install -q -r requirements.txt

echo "Starting FareMind Notification Service on port 8001..."
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
