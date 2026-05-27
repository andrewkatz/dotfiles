---
name: firecrawl
description: Use Firecrawl MCP tools to scrape webpages, discover site URLs, and search the web when live web content is needed.
---

# Firecrawl Web Access

Use Firecrawl when the task needs current web content, rendered page scraping, sitemap/URL discovery, or web search results with page content.

## Available tools

The Claude MCP server should be registered with Claude Code as the user-scoped `firecrawl` server (stored by Claude in `~/.claude.json`) using `~/.local/bin/claude-firecrawl-mcp`. Prefer these MCP tools when available:

- `mcp__firecrawl__firecrawl_scrape` — scrape a known URL.
- `mcp__firecrawl__firecrawl_map` — discover URLs on a site before selecting pages to scrape.
- `mcp__firecrawl__firecrawl_search` — search the web; optionally scrape returned results.

## Guidelines

- Use `firecrawl_scrape` when you already know the URL.
- Use `firecrawl_map` before scraping when you need to find relevant pages on a site.
- Use `firecrawl_search` when you do not know the URL or need current search results.
- Request markdown output unless another format is needed.
- Keep result limits narrow to avoid flooding context.
- For large pages, prefer focused scraping options (`onlyMainContent`, include/exclude tags, or lower limits) and summarize the relevant parts.
- Do not store API keys or secrets in the repo or Claude MCP config; use `FIRECRAWL_API_KEY` from `~/.zsh_secrets`/the user's environment, matching the Pi Firecrawl setup.

## Common patterns

### Scrape a known page

```json
{
  "url": "https://example.com/docs/page",
  "formats": ["markdown"],
  "onlyMainContent": true
}
```

### Discover pages on a site

```json
{
  "url": "https://example.com",
  "search": "installation",
  "limit": 20,
  "ignoreQueryParameters": true
}
```

### Search and scrape results

```json
{
  "query": "official docs example tool configuration",
  "limit": 5,
  "scrapeOptions": {
    "formats": ["markdown"],
    "onlyMainContent": true
  }
}
```
