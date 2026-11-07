# Registry submissions — gogcli-mcp (monorepo, 10 packages)

This repo is a monorepo. Each `packages/*` has its own npm identifier and gets its own MCP Registry entry. Shared parts (ClawHub per sub-package, GitHub Release single) are handled by `release.yml`.

## Packages covered

| Package | Description | `server.json` | `.claude-plugin/` |
| --- | --- | --- | --- |
| `gogcli-mcp` | Base — every service, plus the `gog_<service>_run` escape hatches | ✅ | ✅ |
| `gogcli-mcp-docs` | Google Docs | ✅ | ✅ |
| `gogcli-mcp-sheets` | Google Sheets | ✅ | ✅ |
| `gogcli-mcp-slides` | Google Slides | ✅ | ✅ |
| `gogcli-mcp-drive` | Google Drive | ✅ | ✅ |
| `gogcli-mcp-classroom` | Google Classroom | ✅ | ✅ |
| `gogcli-mcp-maps` | Google Places + trip maps | ✅ | ✅ |
| `gogcli-mcp-gmail` | Gmail | — | — |
| `gogcli-mcp-contacts` | Google Contacts (People API) | — | — |
| `gogcli-mcp-calendar` | Google Calendar (+ Meet spaces) | — | — |

All ten publish to npm, ship a `manifest.json` and a `SKILL.md`, and so
produce a `.mcpb` and a `.skill` per release. The last two columns are what
makes the matrix below read 7 rather than 10 — they are the per-package assets
only seven packages carry, not a gap in the other three's packaging.

## Coverage matrix

| Registry                          | Automated?                               | Notes |
| --- | --- | --- |
| npm (all 10)                      | ✅ `release.yml` (OIDC trusted publishing) | |
| GitHub Releases                   | ✅ `release.yml`                          | 10 `*.mcpb` + 10 `*.skill` attached |
| modelcontextprotocol/registry     | ✅ `release.yml` — loop over packages/*/ with server.json | 7 entries — only 7 packages ship a `server.json` |
| PulseMCP                          | ✅ transitive                             | auto-ingests from MCP Registry weekly |
| ClawHub (OpenClaw)                | ✅ conditional on `CLAWHUB_TOKEN`, loop over packages/*/ with SKILL.md | 10 skills |
| mcpservers.org                    | ❌ manual — 10 entries                    | see below |
| Anthropic community plugins       | ❌ manual — 7 submissions                 | 7 packages carry `.claude-plugin/`; see below |

## mcpservers.org — submit each sub-package separately

For each package, use [mcpservers.org/submit](https://mcpservers.org/submit):

- **Server Name:** `<pkg-name>` (e.g. `gogcli-mcp-docs`)
- **Short Description:** Copy from `packages/<pkg>/manifest.json` `description` field
- **Link:** `https://github.com/chrischall/gogcli-mcp/tree/main/packages/<pkg>`
- **Category:** `Productivity`
- **Contact Email:** `chris.c.hall@gmail.com`

## Anthropic community plugins — submit each sub-package separately

For each package, use [clau.de/plugin-directory-submission](https://clau.de/plugin-directory-submission):

- **Repo URL:** `https://github.com/chrischall/gogcli-mcp` (same repo)
- **Plugin name:** `<pkg-name>` (each is a distinct plugin)
- **Short description:** Copy from `packages/<pkg>/manifest.json` `description`
- **Category:** Productivity
- **Tags:** google, gogcli, workspace, <area-tag>, mcp

The root `.claude-plugin/` directory isn't yet present at the top level — each sub-package carries its own `.claude-plugin/plugin.json` + `marketplace.json`, so the review pipeline reads per-package manifests. If Anthropic's reviewer asks for a single top-level entry, add a root-level `.claude-plugin/marketplace.json` that lists all 7 plugins (the 7 packages that carry `.claude-plugin/`).
