from rank_bm25 import BM25Okapi

from app.pipeline.embedder import embed
from app.pipeline.vector_store import get_collection


_embed_cache: dict[str, list[list[float]]] = {}


def cached_embed(query: str) -> list[list[float]]:
	if query in _embed_cache:
		return _embed_cache[query]
	result = embed([query])
	_embed_cache[query] = result
	if len(_embed_cache) > 100:
		_embed_cache.pop(next(iter(_embed_cache)))
	return result


def retrieve(collection_id: str, query: str, top_k: int = 5) -> list[dict]:
	collection = get_collection(collection_id)
	store_data = collection.get(include=["documents", "metadatas"])
	documents = store_data.get("documents") or []
	metadatas = store_data.get("metadatas") or []

	if not documents:
		return []

	vector_results = collection.query(
		query_embeddings=cached_embed(query),
		n_results=min(top_k, len(documents)),
		include=["documents", "metadatas"],
	)

	vector_docs = vector_results.get("documents", [[]])[0]
	vector_meta = vector_results.get("metadatas", [[]])[0]
	vector_items = [
		{"text": text, "source": meta.get("source", "")}
		for text, meta in zip(vector_docs, vector_meta)
	]

	tokenized = [doc.lower().split() for doc in documents]
	bm25 = BM25Okapi(tokenized)
	scores = bm25.get_scores(query.lower().split())
	top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[
		: top_k
	]
	bm25_items = [
		{"text": documents[i], "source": metadatas[i].get("source", "")}
		for i in top_indices
	]

	merged: list[dict] = []
	seen_texts: set[str] = set()
	for item in vector_items + bm25_items:
		text = item.get("text", "")
		if text and text not in seen_texts:
			seen_texts.add(text)
			merged.append(item)
		if len(merged) >= top_k:
			break

	sources = [item.get("source", "") for item in merged if item.get("source")]
	print(f"retrieve: {len(merged)} chunks, sources={sources}")

	return merged
