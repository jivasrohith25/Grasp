from datetime import datetime, timedelta

from jose import jwt

from app.config import settings


def create_token(user_id: str) -> str:
	expire_at = datetime.utcnow() + timedelta(
		minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
	)
	payload = {"sub": user_id, "exp": expire_at}
	return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


def decode_token(token: str) -> str:
	payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
	return payload.get("sub", "")
