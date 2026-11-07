---
name: gogcli-mcp-maps
description: Use when the user wants to look up places (opening hours, website, phone, whether somewhere is open at a given time) or put trip stops on a Google map they can share. Produces pins on a map (KML/CSV in Drive for My Maps import), not driving routes. Includes auth tools; Places is called with the user's own API key.
---

# gogcli-mcp-maps

Trip mapping MCP server via [gogcli](https://github.com/openclaw/gogcli) — Google Places lookups and trip stops as pins on a map.

- **Source:** [github.com/chrischall/gogcli-mcp](https://github.com/chrischall/gogcli-mcp)

## Requirements

- [gogcli](https://github.com/openclaw/gogcli) installed and authenticated (Drive scope)
- Node.js 22 or later
- A Places API (New) key: `gog config set places_api_key <key>` or `GOG_PLACES_API_KEY`

## Setup

```json
{
  "mcpServers": {
    "gogcli-maps": {
      "command": "npx",
      "args": ["-y", "gogcli-mcp-maps"],
      "env": {
        "GOG_ACCOUNT": "you@gmail.com"
      }
    }
  }
}
```

## Tools

The auth tools (`gog_auth_*`). The Places and trip-map tools follow.
