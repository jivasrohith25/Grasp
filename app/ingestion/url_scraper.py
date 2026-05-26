import random

from bs4 import BeautifulSoup
from playwright.async_api import async_playwright


USER_AGENTS = [
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
]


async def scrape_url(url: str) -> str:
	async with async_playwright() as playwright:
		browser = await playwright.chromium.launch(headless=True)
		context = await browser.new_context(user_agent=random.choice(USER_AGENTS))
		page = await context.new_page()
		try:
			await page.goto(url, wait_until="domcontentloaded")
			content = await page.content()
		finally:
			await browser.close()

	soup = BeautifulSoup(content, "html.parser")
	for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
		tag.decompose()

	text = soup.get_text(separator=" ", strip=True)
	print(f"scrape_url length: {len(text)}")
	if len(text) < 200:
		raise ValueError("Scraping failed or blocked")
	return text
