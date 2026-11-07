---
name: gogcli-mcp-maps
description: Use when the user wants to look up places (opening hours, website, phone, whether somewhere is open at a given time) or put trip stops on a Google map they can share. Produces pins on a map (KML/CSV in Drive for My Maps import), not driving routes. Includes auth tools; Places is called with the user's own API key.
---

# gogcli-mcp-maps

Trip mapping MCP server via [gogcli](https://github.com/openclaw/gogcli) — 12 tools: auth + Google Places lookups + trip stops as pins on a map (not a route).

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

## Tools (12)

| Tool | What it does |
|------|-------------|
| `gog_places_search` | Free-text Places search, optionally biased to a circle; up to 20 results |
| `gog_places_resolve` | Resolve 1-50 named stops to places (address, lat/lng, Maps link, website, phone, hours, status); flags ambiguous matches |
| `gog_places_details` | One place by id; with `at`, whether it is open at that local time and when it opens or closes |
| `gog_trip_map` | Trip stops → pin links by day, warnings first (closed, not open then, ambiguous, unresolved), KML + CSV in Drive `Trips/<title>`, and the 3 steps to import into My Maps |

Plus 8 auth tools (`gog_auth_*`).

## Notes

- **Pins, not routes.** No directions links; each stop links to its own place.
- **My Maps and Maps Lists have no API.** The tool cannot create either; it hands over a KML for a 3-step My Maps import.
- **Costs.** `fields: basic` bills at the Places Pro SKU, `full` (hours, website, phone) at Enterprise. `api_budget` (default 50, max 200) caps billable requests per call; every answer reports `apiCalls` with an estimated cost. Cached lookups are free (ids kept, coordinates 30 days, everything else 24 h).
- **Sharing.** Only the emails in `share_with`, as reader, only with `confirm_share: true`, and only after the user confirms. Never public. `GOG_READONLY=1` writes nothing to Drive.
