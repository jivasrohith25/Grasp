import json
from typing import AsyncGenerator

import httpx

from app.config import settings


async def stream_response(prompt: str) -> AsyncGenerator[str, None]:
	url = f"{settings.OLLAMA_BASE_URL}/api/generate"
	payload = {
		"model": settings.OLLAMA_MODEL,
		"prompt": prompt,
		"stream": True,
		"options": {
			"num_ctx": 2048,
			"num_predict": 350,
			"temperature": 0.3,
			"top_k": 20,
			"top_p": 0.8,
			"repeat_penalty": 1.1,
			"num_thread": 4,
		},
	}
	async with httpx.AsyncClient(timeout=None) as client:
		async with client.stream("POST", url, json=payload) as response:
			response.raise_for_status()
			async for line in response.aiter_lines():
				if not line:
					continue
				data = json.loads(line)
				token = data.get("response")
				if token:
					yield token


async def build_prompt(context_chunks, history, query) -> str:
	casual_inputs = {
		"hi",
		"hey",
		"hello",
		"thanks",
		"thank you",
		"how are you",
		"how's it going",
		"good morning",
		"good afternoon",
		"good evening",
	}
	normalized = query.strip().lower()
	if normalized in casual_inputs:
		system = "You are Grasp. Respond naturally and briefly."
		sections = [
			f"SYSTEM: {system}",
			f"\nUSER: {query}\nASSISTANT:",
		]
		return "\n".join(sections)

	system = (
		"You are Grasp, a professional AI assistant. "
		"You answer questions from provided document context. "
		"FORMATTING RULES — follow strictly: "
		"- For answers with multiple points: use bullet points (- item) "
		"- For step-by-step answers: use numbered lists (1. step) "
		"- For comparisons: use a simple text table format "
		"- For single-fact answers: plain paragraph, no bullets "
		"- Always use clear paragraph breaks between sections "
		"- Bold key terms using **term** markdown syntax "
		"- Keep answers concise but complete "
		"- Never write walls of text without breaks "
		"- Use headers (## Header) only when answer has 3+ distinct sections "
		"ANSWER RULES: "
		"- Answer ONLY from the context provided when context is available "
		"- For greetings and casual chat: respond naturally, no context needed "
		"- If answer not in context: answer from your knowledge "
		"- If answer partially in context: use both "
		"- Never mention author names, photographers, or website credits "
		"- Never say \"based on the context\" or \"according to the document\" "
		"just answer directly and professionally"
	)

	context_lines = []
	for chunk in context_chunks:
		source = chunk.get("source", "unknown")
		text = chunk.get("text", "")
		context_lines.append(f"--- Source: {source} ---\n{text}")

	context_block = "\n\n".join(context_lines)
	context_section = (
		"CONTEXT:\n"
		+ context_block
		+ "\n\nUse ALL relevant context chunks above to form complete answer."
		if context_block
		else "CONTEXT:\n"
	)

	history_lines = []
	for item in history:
		if "user" in item and "assistant" in item:
			history_lines.append(f"User: {item['user']}")
			history_lines.append(f"Assistant: {item['assistant']}")
		elif "role" in item and "content" in item:
			role = item["role"].capitalize()
			history_lines.append(f"{role}: {item['content']}")

	history_section = "CONVERSATION HISTORY:\n" + "\n".join(history_lines)

	sections = [
		f"SYSTEM: {system}",
		context_section,
		history_section,
		f"CURRENT QUESTION:\nUser: {query}\nAssistant:",
	]
	return "\n\n".join(sections)


async def generate_suggestions(context_chunks) -> list[str]:
	prompt = (
		"Read the content carefully. "
		"Generate exactly 3 specific questions a user would genuinely ask "
		"about THIS content. Questions must: "
		"- Be answerable from the content "
		"- Be varied (not all about the same subtopic) "
		"- Be natural and conversational "
		"- Be under 15 words each "
		"Return ONLY valid JSON array: [\"question1\", \"question2\", \"question3\"] "
		"No explanation. No markdown. No preamble."
	)
	context_text = "\n\n".join(chunk.get("text", "") for chunk in context_chunks)
	full_prompt = f"{prompt}\n\nContext:\n{context_text}"
	url = f"{settings.OLLAMA_BASE_URL}/api/generate"
	payload = {"model": settings.OLLAMA_MODEL, "prompt": full_prompt, "stream": False}
	try:
		async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
			response = await client.post(url, json=payload)
			response.raise_for_status()
			data = response.json()
			raw = data.get("response", "")
	except httpx.TimeoutException:
		return []

	try:
		parsed = json.loads(raw)
		if isinstance(parsed, list) and len(parsed) == 3:
			return [str(item) for item in parsed]
	except json.JSONDecodeError:
		pass

	return [
		"What are the main themes in this content?",
		"Which details are most important?",
		"What should I ask next?",
	]


async def generate_summary(context_chunks) -> str:
	context_text = "\n\n".join(chunk.get("text", "") for chunk in context_chunks)
	prompt = (
		"Summarize the following content professionally. "
		"Use bullet points for key facts. "
		"Use numbered list for any processes or steps. "
		"Start with a 1-sentence overview. "
		"Keep total length under 200 words.\n\n"
		f"Context:\n{context_text}"
	)
	url = f"{settings.OLLAMA_BASE_URL}/api/generate"
	payload = {"model": settings.OLLAMA_MODEL, "prompt": prompt, "stream": False}
	async with httpx.AsyncClient(timeout=None) as client:
		response = await client.post(url, json=payload)
		response.raise_for_status()
		data = response.json()
		return data.get("response", "").strip()
