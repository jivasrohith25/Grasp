import asyncio

from celery import Celery

from app.config import settings
from app.ingestion.pdf import extract_pdf
from app.ingestion.text import extract_json, extract_text
from app.ingestion.url_scraper import scrape_url
from app.pipeline.chunker import chunk_text
from app.pipeline.vector_store import clear_collection, store_chunks


celery_app = Celery(
	"grasp",
	broker=settings.REDIS_URL,
	backend=settings.REDIS_URL,
)


@celery_app.task
def ingest_file_task(file_path, file_type, collection_id):
	if file_type == "pdf":
		text = extract_pdf(file_path)
	elif file_type == "json":
		text = extract_json(file_path)
	elif file_type == "text":
		text = extract_text(file_path)
	else:
		raise ValueError(f"Unsupported file type: {file_type}")

	chunks = chunk_text(text, source=file_path)
	clear_collection(collection_id)
	store_chunks(collection_id, chunks)
	return {"status": "done", "chunks": len(chunks)}


@celery_app.task
def ingest_url_task(url, collection_id):
	text = asyncio.run(scrape_url(url))
	chunks = chunk_text(text, source=url)
	clear_collection(collection_id)
	store_chunks(collection_id, chunks)
	return {"status": "done", "chunks": len(chunks)}
