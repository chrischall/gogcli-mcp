# Timestamps

Every timestamp this connector emits is an ISO-8601 string **with an explicit
offset**, paired with a `<field>Display` sibling rendered in the operator's
zone with the weekday included.

## Why

Timestamps used to arrive in different, unlabeled zones depending on which tool
produced them. Nothing in the payload said which zone any value was in, so a
reader assumed local time and was wrong by the UTC offset. Three sends reported
as `02:38`, `03:03`, `03:36` were actually **Mon Jul 27 at 10:38, 11:03 and
11:36 PM Eastern** — a different calendar day. When the question is "did this go
out before the deadline" or "which custody day was this", a silent four-hour
shift moves an event across a date line.

## Root causes (both fixed)

1. **The hosted runner had no timezone.** gog is timezone-aware — it resolves
   `--timezone` → `GOG_TIMEZONE` → config `DefaultTimezone` → the process's
   `time.Local` — and renders message/thread dates in that zone. The Fly
   container set none, so `time.Local` was UTC. That is why the same account
   produced `+0000` through the connector and `-0400` from a local machine:
   identical code, different environment. `fly-gog-runner/fly.toml` now pins
   `GOG_TIMEZONE = "America/New_York"`.
2. **gog's list format is naive by construction.** `listDateLayout` is
   `"2006-01-02 15:04"` — no offset even when the zone is right. Still true as of
   gog 0.35.0: upstream did **not** change `date`, it added a second,
   offset-bearing field beside it (`internalDateIso`, gog #946). So the
   normalization layer below still re-attaches the offset to `date`, and now also
   carries `internalDateIso` through — see
   [`date` vs `internalDateIso`](#date-vs-internaldateiso-in-a-gmail-listing).

## How it works

`normalizeTimestamps` (`packages/gogcli-mcp/src/timestamps.ts`) sits on
`runOrDiagnose` — the single seam every tool's output passes through. Because
normalization happens there rather than at each call site, no tool can
reintroduce a naive value.

It walks the parsed JSON and rewrites a field only when **both** the key is
allowlisted **and** the value matches a timestamp shape. Both must agree: a
name-pattern match alone would rewrite spreadsheet cell data, since gog's
payloads are full of near-miss keys (`updatedCells`, `updatedRange`,
`updatedRows`, `formattedValue`, `verificationStatus`).

Non-JSON output passes through untouched, so plain-text errors are unaffected. A
response in which nothing was rewritten is returned byte-for-byte rather than
re-serialized, so no payload is reflowed gratuitously.

### Lossless tools opt out

`gog_gmail_raw`, `gog_people_raw`, `gog_slides_raw` and `gog_docs_read --format=json`
dump the upstream API response verbatim and pass `lossless: true` to
`runOrDiagnose`, which skips normalization entirely. Rewriting them would turn
the API's own epoch-millis `internalDate` into an ISO string and flatten the
caller's `--pretty` formatting — so the one tool you reach for when you need
ground truth would stop telling it. Losslessness wins over presentation there;
the friendlier views of the same data are normalized as usual.

### `date` vs `internalDateIso` in a Gmail listing

gog 0.35.0 added `internalDateIso` alongside `date` on message **and** thread
listings. They are **separately sourced**, and only one of them is
self-describing:

- **`internalDateIso` is authoritative.** It is Gmail's own `internalDate`
  (epoch millis, the instant Google accepted the message) rendered RFC3339 with
  a real offset. It arrives already offset-bearing, so normalization trusts it
  verbatim and merely re-renders the same instant in `DISPLAY_TZ` — lossless in
  both directions, and correct regardless of how `GOG_TIMEZONE` is set.
- **`date` is a reconstruction.** It is the sender-written `Date:` header
  reformatted by gog into `GOG_TIMEZONE` with `listDateLayout`
  (`"2006-01-02 15:04"` — no offset). The wrapper has to re-attach an offset by
  re-reading that wall time in `GOG_TIMEZONE`, so its correctness still rests on
  the wrapper being told the same zone gog formatted in. That is the coupling
  the `GOG_TIMEZONE` row below exists for.

The two may **legitimately disagree** — a skewed, malformed, or foreign-zone
`Date:` header is common, and for API-imported mail the two can share a source
and agree by construction. A disagreement is not a bug in either layer. Prefer
`internalDateIso` when the answer has to be right; `date` stays the compact
human column.

`date` normalization is deliberately kept for listings that carry no
`internalDateIso` (older gog, and every non-Gmail listing that uses the key), and
neither field is ever used to correct the other — silently substituting one for
the other would hide exactly the header skew that makes them differ.

### Deliberate non-conversions

- **Date-only values** (`2026-07-28`) are left alone. Calendar uses them for
  all-day events; adding a time would invent precision the source never
  asserted.
- **Zone names** (`timeZone`, `timezone`) hold IANA identifiers, not instants.
- **Cell data** (`values`, `rowData`, `formattedValue`) is user content.

## Inventory

| Field | Source | Was | Now |
|---|---|---|---|
| `date` | gog gmail message/thread listings | `2026-07-28 03:36` (naive, zone = gog's) | ISO + offset, `dateDisplay` |
| `internalDate` | Gmail API (authoritative) | epoch milliseconds, UTC | ISO + offset, `internalDateDisplay` |
| `internalDateIso` | gog gmail message + thread listings (gog ≥ 0.35.0) | RFC3339 with offset, in `GOG_TIMEZONE` | re-rendered in `DISPLAY_TZ`, `internalDateIsoDisplay` added |
| `dateTime` | Calendar event start/end | RFC3339 with offset | unchanged offset, `dateTimeDisplay` added |
| `originalStartTime` | Calendar | RFC3339 | + display |
| `modifiedTime` | Drive | RFC3339 `Z` | offset in display zone, + display |
| `createdTime` | Drive | RFC3339 `Z` | offset in display zone, + display |
| `createTime` / `updateTime` | Docs, Sheets, Classroom | RFC3339 `Z` | + display |
| `updated` | Calendar | RFC3339 `Z` | + display |
| `expirationTime` | Drive permissions | RFC3339 | + display |
| `date` (all-day) | Calendar | `2026-07-28` | untouched — a date, not an instant |
| `timeZone` | Calendar | IANA name | untouched |
| `Date:` header | raw MIME, `gog_gmail_raw` | RFC 2822 with its own offset | untouched (raw bytes) |

`sentAt`, `viewedAt`, `modifiedAt`, `fetchedBodyAt` and `asOf` are also
allowlisted so the same helper covers the OFW connector's shapes.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `DISPLAY_TZ` | `America/New_York` | IANA zone for all `*Display` fields. An unrecognised value falls back to the default rather than throwing. |
| `GOG_TIMEZONE` | `America/New_York` on the Fly runner | The zone **gog itself** formats in — and therefore the zone a naive value is read as. The wrapper reads this var directly rather than assuming it equals `DISPLAY_TZ`, so the two can diverge without silently mis-labelling every naive timestamp. Falls back to `DISPLAY_TZ`. |

Both are IANA names, never fixed offsets — a hardcoded `-04:00` would be an hour
wrong from November through March. DST comes from the IANA database via `Intl`.
