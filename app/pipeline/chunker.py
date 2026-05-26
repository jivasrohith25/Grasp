from langchain_text_splitters import RecursiveCharacterTextSplitter


def chunk_text(text: str, source: str) -> list[dict]:
	splitter = RecursiveCharacterTextSplitter(
		chunk_size=500,
		chunk_overlap=50,
		separators=["\n\n", "\n", ".", " "],
	)
	chunks = splitter.split_text(text)
	return [
		{"text": chunk, "source": source, "chunk_index": index}
		for index, chunk in enumerate(chunks)
	]
