---
name: gogcli-mcp-maps
description: Use when the user wants to find places on Google (place id, address, Maps link, coordinates) or put trip stops on a Google map they can share or save. Produces pins on a map (Google Maps shortlist links to save to Lists, and KML/CSV in Drive for My Maps import), not driving routes. Includes auth tools; every Google call goes through gog, with the Maps API key in gog's own config.
---

# gogcli-mcp-maps

Trip mapping MCP server via [gogcli](https://github.com/openclaw/gogcli) — 12 tools: auth + Google Places/Geocoding lookups through `gog maps` + trip stops as pins on a map (not a route). It calls nothing outside gog.

- **Source:** [github.com/chrischall/gogcli-mcp](https://github.com/chrischall/gogcli-mcp)

## Requirements

- [gogcli](https://github.com/openclaw/gogcli) 0.48 or later, installed and authenticated (Drive scope)
- Node.js 22 or later
- A Google Maps Platform key with Places API (New) and Geocoding API enabled, set in gog: `gog config set places_api_key <key>` (the server itself handles no key)

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
| `gog_places_search` | The single top Google match for free text (`near` is extra search text): id, address, Maps link, lat/lng |
| `gog_places_resolve` | Resolve 1-50 named stops to places (id, address, lat/lng, Maps link, status `ok`/`approximate`/`not_found`/`error`); flags ambiguous matches |
| `gog_places_details` | One place by id: name, address, Maps link, lat/lng |
| `gog_trip_map` | Trip stops → pin links by day, warnings first (approximate, ambiguous, unresolved), Google Maps shortlist links per day and for the trip, KML + CSV in Drive `Trips/<title>`, and the 3 steps to import into My Maps |

Plus 8 auth tools (`gog_auth_*`).

## Notes

- **Pins, not routes.** No directions links; each stop links to its own place.
- **gog only.** Places search/details and geocoding are `gog maps` commands; the package makes no network call of its own. gog 0.48 returns the top match only, with no opening times, business status or ratings, so the tools promise none.
- **My Maps and Maps Lists have no API.** The tool cannot create either. Shortlist links (`map_action=shortlist`, at most 20 places each) open Google Maps on a day's places so the user can save them to Lists; what saving creates (new list or existing one) is not verified and differs by device. For My Maps it hands over a KML for a 3-step import.
- **Costs.** Each uncached lookup is one `gog maps places search` (Text Search Pro) or `details` (Place Details Pro) plus one `gog maps geocode` (Geocoding), billed to the key in gog's config; every answer reports `gogCalls`. Cached lookups are free (ids kept, coordinates 30 days, everything else 24 h); `refresh: true` on `gog_places_resolve`/`gog_places_details` bypasses the cache.
- **Sharing.** Only the emails in `share_with`, as reader, only with `confirm_share: true`, and only after the user confirms. Never public. `GOG_READONLY=1` writes nothing to Drive.
