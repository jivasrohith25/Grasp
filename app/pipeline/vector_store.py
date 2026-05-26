from uuid import uuid4

import chromadb

from app.config import settings
from app.pipeline.embedder import embed


_client = chromadb.PersistentClient(path=settings.CHROMA_PERSIST_DIR)


def get_collection(collection_id: str):
	return _client.get_or_create_collection(name=collection_id)


def clear_collection(collection_id: str) -> None:
	try:
		_client.delete_collection(name=collection_id)
	except Exception:
		pass
	_client.get_or_create_collection(name=collection_id)


def store_chunks(collection_id: str, chunks: list[dict]) -> None:
	if not chunks:
		return

	collection = get_collection(collection_id)
	texts = [chunk["text"] for chunk in chunks]
	embeddings = embed(texts)
	ids = [str(uuid4()) for _ in chunks]
	metadatas = [
		{"source": chunk["source"], "chunk_index": chunk["chunk_index"]}
		for chunk in chunks
	]

	collection.add(
		ids=ids,
		embeddings=embeddings,
		documents=texts,
		metadatas=metadatas,
	)


def delete_collection(collection_id: str) -> None:
	_client.delete_collection(name=collection_id)


def list_collections() -> list[str]:
	collections = _client.list_collections()
	return [collection.name for collection in collections]
