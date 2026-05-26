@echo off
title Grasp Stop
echo Stopping Grasp...

echo Stopping Celery...
taskkill /FI "WINDOWTITLE eq Celery*" /F /T > nul 2>&1

echo Stopping FastAPI...
taskkill /FI "WINDOWTITLE eq FastAPI*" /F /T > nul 2>&1

echo Stopping Ollama...
taskkill /FI "WINDOWTITLE eq Ollama*" /F /T > nul 2>&1

echo Stopping UI...
taskkill /FI "WINDOWTITLE eq UI*" /F /T > nul 2>&1

echo Stopping Redis...
docker stop redis

echo.
echo All services stopped.
pause