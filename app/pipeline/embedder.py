from sentence_transformers import SentenceTransformer


_MODEL = SentenceTransformer("nomic-ai/nomic-embed-text-v1", device="cpu")


def embed(texts: list[str]) -> list[list[float]]:
	embeddings = _MODEL.encode(texts, convert_to_numpy=True)
	return embeddings.tolist()
