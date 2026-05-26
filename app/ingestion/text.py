import json
from pathlib import Path

from docx import Document


TEXT_EXTENSIONS = {".txt", ".md", ".csv"}


def extract_text(file_path: str) -> str:
	path = Path(file_path)
	suffix = path.suffix.lower()
	if suffix == ".docx":
		doc = Document(file_path)
		return "\n".join(paragraph.text for paragraph in doc.paragraphs)

	if suffix in TEXT_EXTENSIONS:
		return path.read_text(encoding="utf-8", errors="ignore")

	return path.read_text(encoding="utf-8", errors="ignore")


def extract_json(file_path: str) -> str:
	with open(file_path, "r", encoding="utf-8") as file:
		data = json.load(file)
	return json.dumps(data, indent=2)
