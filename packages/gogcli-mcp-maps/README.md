# gogcli-mcp-maps

Trip mapping MCP server via [gogcli](https://github.com/openclaw/gogcli): Google Places lookups (opening hours, website, phone, "is it open then?" checks) and trip stops as **pins on a map** — not a route — delivered as KML/CSV in Google Drive for a one-step My Maps import.

> Work in progress: this release ships the auth tools and the Places client/cache foundation; the Places and trip tools follow.

## Requirements

- [gogcli](https://github.com/openclaw/gogcli) installed and authenticated for Drive
- Node.js 22+
- A Google Places API (New) key in a billing-enabled Cloud project, restricted to the Places API (New)

```bash
brew install gogcli
gog auth add your@gmail.com --services drive
gog config set places_api_key <key>      # or set GOG_PLACES_API_KEY
```

Places is called directly from Node over HTTPS with the key — never through OAuth, never echoed in a tool result. Key lookup order: `GOG_PLACES_API_KEY`, `GOOGLE_PLACES_API_KEY`, then `gog config get places_api_key`.

## Installation

```bash
npm install -g gogcli-mcp-maps
```

### Claude Code

```bash
claude mcp add gogcli-maps -- gogcli-mcp-maps
```

## Caching

Lookups are cached at `~/.gogcli-mcp/places-cache.json` within Google's Places policies: place IDs indefinitely, coordinates for at most 30 days, everything else (name, hours, status, website, phone) for 24 hours. Re-planning within a day is free.

## License

MIT
