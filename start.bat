@echo off
title Grasp Launcher
echo Starting Grasp...

echo [1/5] Starting Redis...
docker start redis
timeout /t 2 /nobreak > nul

echo [2/5] Starting Ollama...
wt -w 0 new-tab --title "Ollama" cmd /k "ollama serve"
timeout /t 3 /nobreak > nul

echo [3/5] Starting Celery...
wt -w 0 new-tab --title "Celery" cmd /k "cd /d D:\rohith\Projects Shyts\grasp && Scripts\activate && celery -A app.tasks.worker.celery_app worker --loglevel=info --pool=solo"
timeout /t 2 /nobreak > nul

echo [4/5] Starting FastAPI...
wt -w 0 new-tab --title "FastAPI" cmd /k "cd /d D:\rohith\Projects Shyts\grasp && Scripts\activate && uvicorn app.main:app --reload --port 8000"
timeout /t 3 /nobreak > nul

echo [5/5] Starting UI...
wt -w 0 new-tab --title "UI" cmd /k "cd /d D:\rohith\Projects Shyts\grasp\ui && npm start"

echo Done.
timeout /t 2 /nobreak > nul
exit