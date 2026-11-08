# gogcli-mcp-maps

> [!WARNING]
> **AI-developed project.** This codebase was built and is actively maintained by [Claude Code](https://www.anthropic.com/claude). Review all code and tool permissions before use.

Trip mapping [MCP](https://modelcontextprotocol.io) server via [gogcli](https://github.com/openclaw/gogcli). It finds places on Google (place id, name, address, Google Maps link and coordinates) and puts a trip's stops on a map as **pins, not a route**: each stop gets a Google Maps pin link, each day gets a Google Maps **shortlist** link that lets you save its places to your Google Maps Lists, and the whole trip becomes a KML file (plus a CSV) in Google Drive that you import into Google My Maps in three steps.

**It calls nothing outside gog.** Every Google request (Places, Geocoding, Drive) is a `gog` command; this package never calls Google itself, makes no network request of its own and never sees an API key.

## Why pins, a shortlist link and a KML file, and not a map it makes for you

- **Google My Maps has no API.** There is no supported way to create or edit a My Maps map from code: no Drive file type to create, no REST endpoint. The only clients that do it drive the web app with your browser session, which this server will not do. So it writes a KML file (one folder per day, one pin colour per category) that My Maps imports as-is.
- **Google Maps Lists ("Saved" → New list) have no API either.** Lists are created, filled and shared only in the Maps app or on the Maps web site; Google Takeout can export them but nothing can write one. The supported route is Google's documented [shortlist link](#shortlist-links-save-to-google-maps-lists): it opens Maps on a set of places and *you* save them. The server cannot make a List for you.
- **Points on a map, not a route.** The stops are where you will be, not a drive between them. There is no directions link, no waypoint splitting and no travel mode. Each stop's link opens that one place: the place's own Google Maps link when gog returns one, otherwise `https://www.google.com/maps/search/?api=1&query=<name, address>&query_place_id=<id>` (or the coordinates, if the id cannot fit).
- **Maps URLs are capped at 2,048 characters.** A pin link that would be longer has its query text shortened; a shortlist that would be longer is split into several links.

## Requirements

- [gogcli](https://github.com/openclaw/gogcli) 0.48 or later, installed and authenticated for Drive
- Node.js 22+
- A Google Maps Platform API key configured **in gog** (see [Setup](#setup))

```bash
brew install gogcli
gog auth add your@gmail.com --services drive
```

## Setup

The places tools run `gog maps places search`, `gog maps places details` and `gog maps geocode`. gog reads the key from its own config; this server handles no key at all.

1. In the [Google Cloud console](https://console.cloud.google.com/), pick (or create) a project **with billing enabled**.
2. Enable **Places API (New)** and **Geocoding API** for it.
3. Create an API key (APIs & Services → Credentials) and restrict it to those two APIs.
4. Store it in gog's config:

   ```bash
   gog config set places_api_key <key>
   ```

Use gog's config, not an environment variable: the server strips every `*_KEY` variable from the environment of the `gog` it spawns. Without a key, gog's own error (how to set one) comes back from the places tools.

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
| `gog_places_search` | The single top Google match for free text (`near` is appended to the text as an area hint): place id, name, address, Maps link and lat/lng |
| `gog_places_resolve` | Resolve 1-50 named stops (or known place ids or coordinates) to places: id, address, lat/lng, Maps link and a status each. Flags a top match whose name does not match as ambiguous |
| `gog_places_details` | One place by id: name, address, Maps link and lat/lng |
| `gog_trip_map` | Resolve every stop of a trip, warn about problems, return pin links and shortlist links by day, build KML + CSV, upload them to Drive `Trips/<title>`, and give the My Maps import steps |

### What a lookup does

gog 0.48 returns only the top match for a search, with its place id, name, address and Google Maps link, and no coordinates. So each stop is:

1. **Found.** A known `place_id` → `gog maps places details <id>`. Otherwise `gog maps places search "<name>, <address>, <near>"`. gog has no location bias or result count, so `near` (for example `Tampa, FL`) is just more search text.
2. **Placed.** `gog maps geocode "<formatted address>"`, taking the first result's coordinates. A stop given with `lat`/`lng` uses those and skips this step.
3. **Given a status:**

| Status | Meaning |
|---|---|
| `ok` | Found, and the pin is the place itself (the geocoder returned the same place id) or the coordinates you gave |
| `approximate` | Found, but the pin is the geocoded address rather than the place, or there are no coordinates at all |
| `not_found` | The search found nothing (a stop with given coordinates still gets its pin) |
| `error` | gog failed for this stop; the reason is in the answer |

There are no opening times, business status, ratings or alternative matches: gog 0.48 does not return them. Every answer reports `gogCalls`, the number of `search`, `details` and `geocode` commands it ran.

`gog_places_resolve` runs at most 4 lookups at once, and once the request is cancelled it starts no more.

### `gog_trip_map`

Each stop is `{day, time?, name, address? | place_id?, lat?, lng?, note?, category?}`. `day` is a date (`2026-11-21`) or a day number from 1, which `start_date` turns into dates. `category` picks the pin colour: `lodging`, `food`, `drinks`, `sight`, `activity`, `event`, `transport` or `shopping`.

What it does, in order:

1. Resolves each stop as above (the cache first).
2. Warns, first in the answer: approximate pins, ambiguous matches, and stops it could not place (these are left off the map and listed under `unresolved`).
3. Writes `<slug>.kml` and `<slug>.csv` (the title, lowercased and hyphenated) into a new folder under `GOG_FILE_ROOTS` (`trips/`).
4. Uploads both to Drive `Trips/<title>` (under `drive_parent`, default My Drive; a `/` in the title becomes `-`). A re-run reuses the folder and replaces the two files rather than adding copies.
5. Shares the folder only as described in [Sharing](#sharing).

It returns the stops grouped by day (time, name, status, pin link, warnings) with each day's `shortlist_urls`, the trip-wide `shortlist`, the local and Drive links of both files, the folder link, and the three My Maps steps:

1. Open https://www.google.com/maps/d/ and click "Create a new map".
2. In "Untitled layer" click "Import", choose "Google Drive", pick `<slug>.kml` in `Trips/<title>`.
3. Name the map `<title>`; Share → add the same people (My Maps sharing is separate from the folder's).

`view: full` adds `places`: every stop's lookup (status, place id, address, lat/lng, match confidence, cached).

## Shortlist links: save to Google Maps Lists

`gog_trip_map` builds Google's documented [shortlist URL](https://developers.google.com/maps/documentation/urls/get-started):

```
https://www.google.com/maps/@?api=1&map_action=shortlist&place_ids=ID1%2CID2%2C...
```

Opening it shows those places in Google Maps, where you can save them to a list in your Google Maps profile (Lists). This is the supported way into Lists, since Lists have no API.

- **At most 20 places per link** (Google's limit), and no link longer than 2,048 characters. Each day gets `shortlist_urls`: its places in stop order, split into several links when there are more than 20 or a link would be too long. A place visited twice is listed once.
- **The whole trip** gets one `shortlist.trip_url` when all its places fit in one link; otherwise `shortlist.trip_note` says to use the per-day links.
- **Only stops with a place id** can be in a shortlist. A day's `shortlist_left_out` lists the rest (no place id, or an id too long for any link). They are still on the KML map.
- The ids are joined with `%2C`, the encoded comma: the Maps URLs guide says the comma must be encoded, and it decodes to the plain comma of Google's own example.
- **What "save" creates has not been verified.** Whether it makes a new list or adds to an existing one, and what you are offered, differs by device (the Maps app or a browser). Check the list in Google Maps afterwards.

The shortlist links are in the tool's answer only; the KML and CSV do not carry them. For a long trip, or to keep days as layers with coloured pins, use the My Maps import.

## Costs and quotas

Each `gog` maps command is one billed Google request on the key in gog's config, at Google's published first-tier list prices ([pricing](https://developers.google.com/maps/billing-and-pricing/pricing), checked 2026-11-08):

| gog command | Google SKU | Price | Free each month |
|---|---|---|---|
| `gog maps places search` | Text Search Pro (Places API (New)) | $32 per 1,000 | 5,000 |
| `gog maps places details` | Place Details Pro (Places API (New)) | $17 per 1,000 | 5,000 |
| `gog maps geocode` | Geocoding | $5 per 1,000 | 10,000 |

gog asks for the place id, display name, address and Maps link, which bills the Places calls at the Pro tier. There is no budget parameter: a lookup that is not cached costs one search (or one details) plus one geocode. Cache hits cost nothing.

- **Rule of thumb:** a new 20-stop trip is 20 searches and 20 geocodes, about $0.74 at list price before the free allowance. Re-planning the same trip the same day is free from the cache; within 30 days the coordinates still are.
- **Every answer reports `gogCalls`**, so you can see what a call spent.

## Caching

Lookups are cached at `~/.gogcli-mcp/places-cache.json` (under `$HOME`, written atomically, mode 0600), within Google's [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies):

| What | Kept for |
|---|---|
| Place id | indefinitely |
| Coordinates (lat/lng) | 30 days at most |
| Name, address and Google Maps link | 24 h |

Entries are found by the normalised search text and by place id. A stop whose place id is known but whose 24 h fields have expired costs one `gog maps places details`, not a new search; fresh coordinates are reused, so it costs no geocode. A fully fresh entry costs nothing. A corrupt cache file is ignored and rebuilt, never an error.

Pass `refresh: true` to look again anyway. Only `gog_places_resolve` and `gog_places_details` take it.

The other two tools always use the cache: `gog_places_search` and `gog_trip_map` have no `refresh` parameter.

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

Ask Claude something like *"Put my Tampa weekend on a map and share it with friend@example.com"*. It calls `gog_trip_map` with stops like the above, warns about any approximate pin or ambiguous match, uploads `tampa-weekend.kml` and `tampa-weekend.csv` to `Trips/Tampa weekend`, asks you to confirm the share, and returns three days of pin links, a shortlist link per day (and one for the whole trip) to save the places to Google Maps Lists, and the three My Maps steps.

## Environment

```
GOG_ACCOUNT=<email>        # Google account for the Drive upload (the Maps API key lives in gog's config)
GOG_READONLY=1             # no Drive writes, no sharing; KML/CSV still returned
GOG_FILE_ROOTS=<dirs>      # where the local KML/CSV go (default ~/gogcli-mcp-files)
```

## License

MIT
