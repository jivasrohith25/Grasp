import fitz


def extract_pdf(file_path: str) -> str:
	doc = fitz.open(file_path)
	pages = []
	try:
		for index, page in enumerate(doc, start=1):
			text = page.get_text("text")
			pages.append(f"[Page {index}]\n{text}")
	finally:
		doc.close()
	return "\n".join(pages)
