# gogcli-mcp-maps

> [!WARNING]
> **AI-developed project.** This codebase was built and is actively maintained by [Claude Code](https://www.anthropic.com/claude). Review all code and tool permissions before use.

Trip mapping [MCP](https://modelcontextprotocol.io) server via [gogcli](https://github.com/openclaw/gogcli). It looks places up in Google Places (address, opening hours, website, phone, "is it open then?") and puts a trip's stops on a map as **pins, not a route**: each stop gets a Google Maps pin link, and the whole trip becomes a KML file (plus a CSV) in Google Drive that you import into Google My Maps in three steps.

## Why pins in a KML file, and not a map it makes for you

- **Google My Maps has no API.** There is no supported way to create or edit a My Maps map from code: no Drive file type to create, no REST endpoint. The only clients that do it drive the web app with your browser session, which this server will not do. So it writes a KML file (one folder per day, one pin colour per category) that My Maps imports as-is.
- **Google Maps Lists ("Saved" → New list) have no API either.** Lists are created, filled and shared only in the Maps app or website; Google Takeout can export them but nothing can write one. This server cannot make a List for you.
- **Points on a map, not a route.** The stops are where you will be, not a drive between them. There is no directions link, no waypoint splitting and no travel mode. Each stop's link opens that one place: the place's own Google Maps link when Places returns one, otherwise `https://www.google.com/maps/search/?api=1&query=<name, address>&query_place_id=<id>`.
- **Maps URLs are capped at 2,048 characters.** A pin link that would be longer has its query text shortened; the place id is never cut.

## Requirements

- [gogcli](https://github.com/openclaw/gogcli) installed and authenticated for Drive
- Node.js 22+
- A Google Places API (New) key (see [Setup](#setup))

```bash
brew install gogcli
gog auth add your@gmail.com --services drive
```

## Setup

Places is called directly from Node over HTTPS (`places.googleapis.com`) with an API key. It does not go through `gog maps` and does not use OAuth.

1. In the [Google Cloud console](https://console.cloud.google.com/), pick (or create) a project **with billing enabled**.
2. Enable **Places API (New)** for it.
3. Create an API key (APIs & Services → Credentials) and restrict it to **Places API (New)** only.
4. Give the key to the server, either way:

   ```bash
   gog config set places_api_key <key>      # stored in gog's config
   # or, in the MCP server's environment:
   GOG_PLACES_API_KEY=<key>
   ```

Lookup order: `GOG_PLACES_API_KEY`, then `GOOGLE_PLACES_API_KEY`, then `gog config get places_api_key`. The key is never shown in a tool result, an error or a log, and it is stripped from the environment of every `gog` the server spawns. With no key, the Places tools say how to set one.

## Installation

```bash
npm install -g gogcli-mcp-maps
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gogcli-maps": {
      "command": "gogcli-mcp-maps",
      "env": {
        "GOG_ACCOUNT": "you@gmail.com"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add gogcli-maps -- gogcli-mcp-maps
```

## Tools (12)

Plus 8 auth tools (`gog_auth_*`, Drive scope by default).

| Tool | Description |
|------|-------------|
| `gog_places_search` | Free-text Places search, optionally biased to a circle (`near`, radius up to 50 km); up to 20 results. Defaults to `fields: basic` |
| `gog_places_resolve` | Resolve 1-50 named stops to places: id, address, lat/lng, Maps link, website, phone, hours, status. Flags ambiguous matches. Defaults to `fields: full` |
| `gog_places_details` | One place by id. With `at` (local time at the place, e.g. `2026-11-21T19:30`) it says whether the place is open then, and when it opens or closes |
| `gog_trip_map` | Resolve every stop of a trip, warn about problems, build KML + CSV, upload them to Drive `Trips/<title>`, and return the pin links and the My Maps import steps |

Every Places tool takes `view: compact | full` (the shape of the answer) and `fields: basic | full` (what is requested from Google, which sets the price). A closed business is the first thing in the answer: `⚠️ CLOSED PERMANENTLY: <name>` or `CLOSED TEMPORARILY`.

### `gog_trip_map`

Each stop is `{day, time?, name, address? | place_id?, note?, category?}`. `day` is a date (`2026-11-21`) or a day number from 1, which `start_date` turns into dates; without dates the open-at checks are skipped and the answer says so. `category` picks the pin colour: `lodging`, `food`, `drinks`, `sight`, `activity`, `event`, `transport` or `shopping`.

What it does, in order:

1. Resolves each stop (a given `place_id` → Place Details; otherwise the cache, then Text Search), within `api_budget`.
2. Warns, first in the answer: closed businesses, stops not open at their planned day and time, ambiguous matches, and stops it could not place (these are left off the map and listed).
3. Writes `<slug>.kml` and `<slug>.csv` (the title, lowercased and hyphenated) into a new folder under `GOG_FILE_ROOTS` (`trips/`).
4. Uploads both to Drive `Trips/<title>` (under `drive_parent`, default My Drive). A re-run reuses the folder and replaces the two files rather than adding copies.
5. Shares the folder only as described in [Sharing](#sharing).

It returns the stops grouped by day (time, name, pin link, warnings), the local and Drive links of both files, the folder link, and the three My Maps steps:

1. Open https://www.google.com/maps/d/ and click "Create a new map".
2. In "Untitled layer" click "Import", choose "Google Drive", pick `<slug>.kml` in `Trips/<title>`.
3. Name the map `<title>`; Share → add the same people (My Maps sharing is separate from the folder's).

`view: full` adds the resolved places and the `apiCalls` report.

## Costs and quotas

Every Places request names an explicit field mask, and Google bills at the highest tier any requested field reaches:

| `fields` | Billed as | Text Search | Place Details | Free each month |
|---|---|---|---|---|
| `basic`: id, name, address, location, Maps link, business status, UTC offset | Pro | $32 per 1,000 | $17 per 1,000 | 5,000 Text Search, 5,000 Details |
| `full`: basic + website, phones, opening hours, price level, accessibility | Enterprise | $35 per 1,000 | $20 per 1,000 | 1,000 Text Search, 1,000 Details |

Published first-tier list prices, checked 2026-11-07 ([pricing](https://developers.google.com/maps/billing-and-pricing/pricing), [usage and billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)). `gog_places_resolve`, `gog_places_details` and `gog_trip_map` default to `full` because they need hours, website and phone; `gog_places_search` defaults to `basic`.

- **`api_budget`** (default 50, max 200) is the most billable Places requests one tool call may make. Cache hits are free. When it runs out, no further request is sent and the remaining stops come back unresolved with `reason: "api_budget reached"`.
- **Every answer reports `apiCalls`**: Text Search and Details counts, the SKU, and `estimatedUsd`, an estimate at list price before the free monthly allowance.
- **Rule of thumb:** a 20-stop trip is about 20 Enterprise calls, about $0.70 before the free allowance. Re-planning the same trip within 24 hours is free from the cache.

## Caching

Lookups are cached at `~/.gogcli-mcp/places-cache.json` (under `$HOME`, written atomically, mode 0600), within Google's [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies):

| What | Kept for |
|---|---|
| Place id | indefinitely |
| Coordinates (lat/lng) | 30 days at most |
| Everything else: name, address, hours, status, website, phone, Maps link, price, accessibility | 24 hours |

Entries are found by the normalised name + address and by place id. A stop whose place id is known but whose 24-hour fields have expired costs one Place Details request, not a new search; a fully fresh entry costs nothing. Pass `refresh: true` to look again anyway. A corrupt cache file is ignored and rebuilt, never an error.

## Sharing

- The trip folder is **never public and never "anyone with the link"**.
- It is shared only with the emails in `share_with`, as **reader**, and only when the call also says `confirm_share: true`. `share_with` without `confirm_share` shares nothing and says so.
- Even then, the user confirms first: the same confirmation prompt as `gog_drive_share`, listing the emails and the folder. On a client that cannot show the prompt, the two-step confirmation token takes its place (`MCP_CONFIRM_MODE`).
- A My Maps map made from the KML has its own sharing; step 3 above is where you add the same people.
- With `GOG_READONLY=1` or `upload: false`, nothing is written to Drive and nothing is shared; the KML and CSV are still written locally and returned in the answer.

## Example: a weekend in Tampa

A sample itinerary using public venues (the notes are invented):

```json
{
  "title": "Tampa weekend",
  "start_date": "2026-11-20",
  "stops": [
    { "day": 1, "time": "15:00", "name": "Le Méridien Tampa", "address": "601 N Florida Ave, Tampa, FL", "category": "lodging", "note": "Check in from 3 pm" },
    { "day": 1, "time": "18:30", "name": "Armature Works", "address": "Tampa, FL", "category": "food", "note": "Food hall dinner" },
    { "day": 2, "time": "10:00", "name": "Tampa Riverwalk", "address": "Tampa, FL", "category": "sight", "note": "Morning walk along the river" },
    { "day": 2, "time": "12:30", "name": "Centennial Park station", "address": "Ybor City, Tampa, FL", "category": "transport", "note": "TECO Line streetcar to Ybor" },
    { "day": 2, "time": "15:00", "name": "Cigar City Brewing", "address": "Tampa, FL", "category": "drinks" },
    { "day": 3, "time": "13:00", "name": "Raymond James Stadium", "address": "Tampa, FL", "category": "event", "note": "Game day" }
  ],
  "share_with": ["friend@example.com"],
  "confirm_share": true
}
```

Ask Claude something like *"Put my Tampa weekend on a map and share it with friend@example.com"*. It calls `gog_trip_map` with stops like the above, warns about anything closed or not open at its planned time, uploads `tampa-weekend.kml` and `tampa-weekend.csv` to `Trips/Tampa weekend`, asks you to confirm the share, and returns three days of pin links and the three My Maps steps.

## Environment

```
GOG_PLACES_API_KEY=<key>   # Places API (New) key; falls back to GOOGLE_PLACES_API_KEY, then gog config
GOG_ACCOUNT=<email>        # Google account for the Drive upload
GOG_READONLY=1             # no Drive writes, no sharing; KML/CSV still returned
GOG_FILE_ROOTS=<dirs>      # where the local KML/CSV go (default ~/gogcli-mcp-files)
```

## License

MIT
