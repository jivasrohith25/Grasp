import hashlib
from pathlib import Path
from typing import AsyncGenerator
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from slowapi.middleware import SlowAPIMiddleware
from slowapi.extension import _rate_limit_exceeded_handler
from redis import Redis

from app.config import settings
from app.chat.generator import (
	build_prompt,
	generate_suggestions,
	generate_summary,
	stream_response,
)
from app.chat.memory import (
	clear_history,
	get_all_chat_logs,
	get_history,
	save_chat_log,
	save_history,
)
from app.pipeline.retriever import retrieve
from app.pipeline.vector_store import delete_collection, list_collections
from app.tasks.worker import ingest_file_task, ingest_url_task


_response_cache = Redis.from_url(settings.REDIS_URL, decode_responses=True)


UPLOADS_DIR = Path("uploads")
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="RAG Chatbot API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
	CORSMiddleware,
	allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
	allow_credentials=False,
	allow_methods=["*"],
	allow_headers=["*"],
)


def _detect_file_type(filename: str) -> str:
	extension = Path(filename).suffix.lower()
	if extension == ".pdf":
		return "pdf"
	if extension == ".json":
		return "json"
	if extension in {".txt", ".md", ".csv", ".docx"}:
		return "text"
	return ""


@app.post("/ingest/file")
@limiter.limit("60/minute")
async def ingest_file(
	request: Request,
	file: UploadFile = File(...),
	collection_id: str = Form(...),
):
	file_type = _detect_file_type(file.filename or "")
	if not file_type:
		return {"status": "error", "detail": "Unsupported file type"}

	filename = f"{uuid4()}{Path(file.filename).suffix}"
	file_path = UPLOADS_DIR / filename
	with open(file_path, "wb") as buffer:
		buffer.write(await file.read())

	task = ingest_file_task.delay(str(file_path), file_type, collection_id)
	try:
		result = task.get(timeout=300)
		return result
	except Exception as exc:
		raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/ingest/url")
@limiter.limit("60/minute")
async def ingest_url(
	request: Request,
	url: str = Form(...),
	collection_id: str = Form(...),
):
	task = ingest_url_task.delay(url, collection_id)
	try:
		result = task.get(timeout=300)
		return result
	except Exception as exc:
		raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/query")
@limiter.limit("60/minute")
async def query(
	request: Request,
	message: str = Form(...),
	collection_id: str = Form(...),
	session_id: str = Form(...),
):
	cache_key = f"cache:{collection_id}:{hashlib.sha256(message.encode('utf-8')).hexdigest()}"
	cached = _response_cache.get(cache_key)
	if cached is not None:
		async def cached_stream() -> AsyncGenerator[str, None]:
			yield cached
		return StreamingResponse(cached_stream(), media_type="text/plain")

	history = get_history(session_id)
	context_chunks = retrieve(collection_id, message, top_k=5)
	source_type = "document" if context_chunks else "model"
	prompt = await build_prompt(context_chunks, history, message)

	async def event_stream() -> AsyncGenerator[str, None]:
		response_parts: list[str] = []
		async for token in stream_response(prompt):
			response_parts.append(token)
			yield token

		full_response = "".join(response_parts)
		history.append({"user": message, "assistant": full_response})
		save_history(session_id, history)
		save_chat_log(collection_id, session_id, history)
		_response_cache.setex(cache_key, 300, full_response)

	sources = []
	for chunk in context_chunks:
		source = chunk.get("source")
		if source and source not in sources:
			sources.append(source)

	headers = {"X-Sources": ",".join(sources)} if sources else {}
	if source_type:
		headers["X-Source-Type"] = source_type
	return StreamingResponse(event_stream(), media_type="text/plain", headers=headers)


@app.post("/suggest")
@limiter.limit("60/minute")
async def suggest(request: Request, collection_id: str = Form(...)):
	print(f"Suggest called for: {collection_id}")
	context_chunks = retrieve(collection_id, "key topics questions summary", top_k=8)
	print(f"Chunks found: {len(context_chunks)}")
	suggestions = await generate_suggestions(context_chunks)
	print(f"Suggestions generated: {suggestions}")
	if not suggestions:
		return {
			"suggestions": [
				"What is this document about?",
				"What are the key points?",
				"Can you summarize this?",
			]
		}
	return {"suggestions": suggestions}


@app.post("/suggest/single")
@limiter.limit("60/minute")
async def suggest_single(
	request: Request,
	collection_id: str = Form(...),
	exclude: str = Form("")
):
	exclude_set = {item.strip() for item in exclude.split(",") if item.strip()}
	context_chunks = retrieve(collection_id, "additional questions topics", top_k=8)
	candidates = await generate_suggestions(context_chunks)
	for suggestion in candidates:
		if suggestion not in exclude_set:
			return {"suggestion": suggestion}
	return {"suggestion": ""}


@app.post("/summarize")
@limiter.limit("60/minute")
async def summarize(
	request: Request,
	collection_id: str = Form(...),
	query: str = Form("summarize everything"),
):
	context_chunks = retrieve(collection_id, query, top_k=10)
	summary = await generate_summary(context_chunks)
	return {"summary": summary}


@app.get("/history/{collection_id}")
@limiter.limit("60/minute")
async def history(request: Request, collection_id: str):
	return {"sessions": get_all_chat_logs(collection_id)}


@app.delete("/session/{session_id}")
@limiter.limit("60/minute")
async def delete_session(request: Request, session_id: str):
	clear_history(session_id)
	return {"status": "cleared"}


@app.delete("/collection/{collection_id}")
@limiter.limit("60/minute")
async def delete_collection_endpoint(request: Request, collection_id: str):
	delete_collection(collection_id)
	return {"status": "deleted"}


@app.get("/collections")
@limiter.limit("60/minute")
async def collections(request: Request):
	return {"collections": list_collections()}


@app.get("/health")
async def health():
	return {"status": "ok"}
