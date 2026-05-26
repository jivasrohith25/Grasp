# Grasp

Grasp is a RAG chatbot that ingests documents or URLs and answers questions with a React UI.

## Stack
- Backend: FastAPI + Celery + Redis
- Vector store: ChromaDB
- Model runtime: Ollama
- Frontend: React

## Prerequisites
- Python 3.11+
- Node.js 18+
- Docker (for Redis)
- Ollama installed and running

## Setup
```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

cd ui
npm install
```

Create an env file:
```bash
copy .env.example .env
```

## Run (manual)
In separate terminals:
```bash
docker start redis
ollama serve
celery -A app.tasks.worker.celery_app worker --loglevel=info --pool=solo
uvicorn app.main:app --reload --port 8000
cd ui
npm start
```

The UI runs at http://localhost:3000

## Ollama model
This repo is configured for:
- qwen2.5:3b

Pull it once:
```bash
ollama run qwen2.5:3b
```

## Quick start (Windows)
If you are on Windows, you can use:
- start.bat
- stop.bat

## Notes
- Do not commit .env
- Chroma data is stored in ./chromadb
- Uploads are stored in ./uploads
