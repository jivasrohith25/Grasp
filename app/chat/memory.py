import json

from redis import Redis

from app.config import settings


_redis = Redis.from_url(settings.REDIS_URL, decode_responses=True)


def get_history(session_id: str, max_turns: int = 6) -> list[dict]:
	key = f"session:{session_id}"
	raw = _redis.get(key)
	if not raw:
		return []
	history = json.loads(raw)
	if not isinstance(history, list):
		return []
	return history[-max_turns:]


def save_history(session_id: str, history: list[dict]) -> None:
	key = f"session:{session_id}"
	_redis.set(key, json.dumps(history), ex=3600)


def clear_history(session_id: str) -> None:
	key = f"session:{session_id}"
	_redis.delete(key)


def save_chat_log(collection_id: str, session_id: str, messages: list[dict]) -> None:
	key = f"chatlog:{collection_id}:{session_id}"
	meta_key = f"chatlogmeta:{collection_id}:{session_id}"
	timestamp = _redis.time()[0]
	payload = {
		"session_id": session_id,
		"messages": messages,
		"timestamp": timestamp,
		"collection_id": collection_id,
	}
	_redis.set(key, json.dumps(payload))
	_redis.set(meta_key, timestamp)


def get_all_chat_logs(collection_id: str) -> list[dict]:
	pattern = f"chatlog:{collection_id}:*"
	results: list[dict] = []
	for key in _redis.scan_iter(match=pattern):
		session_id = key.split(":")[-1]
		raw = _redis.get(key)
		if not raw:
			continue
		try:
			payload = json.loads(raw)
		except json.JSONDecodeError:
			continue
		meta_key = f"chatlogmeta:{collection_id}:{session_id}"
		raw_ts = _redis.get(meta_key)
		timestamp = int(raw_ts) if raw_ts and raw_ts.isdigit() else 0
		if isinstance(payload, dict):
			messages = payload.get("messages", [])
			item_collection_id = payload.get("collection_id", collection_id)
		else:
			messages = payload
			item_collection_id = collection_id
		results.append(
			{
				"session_id": session_id,
				"messages": messages,
				"timestamp": timestamp,
				"collection_id": item_collection_id,
			}
		)

	results.sort(key=lambda item: item.get("timestamp", 0), reverse=True)
	return results
