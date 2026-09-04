# Registry submissions — gogcli-mcp (monorepo, 9 packages)

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
| `gogcli-mcp-gmail` | Gmail | — | — |
| `gogcli-mcp-contacts` | Google Contacts (People API) | — | — |
| `gogcli-mcp-calendar` | Google Calendar (+ Meet spaces) | — | — |

All nine publish to npm, ship a `manifest.json` and a `SKILL.md`, and so
produce a `.mcpb` and a `.skill` per release. The last two columns are what
makes the matrix below read 6 rather than 9 — they are the per-package assets
only six packages carry, not a gap in the other three's packaging.

## Coverage matrix

| Registry                          | Automated?                               | Notes |
| --- | --- | --- |
| npm (all 9)                       | ✅ `release.yml` (OIDC trusted publishing) | |
| GitHub Releases                   | ✅ `release.yml`                          | 9 `*.mcpb` + 9 `*.skill` attached |
| modelcontextprotocol/registry     | ✅ `release.yml` — loop over packages/*/ with server.json | 6 entries — only 6 packages ship a `server.json` |
| PulseMCP                          | ✅ transitive                             | auto-ingests from MCP Registry weekly |
| ClawHub (OpenClaw)                | ✅ conditional on `CLAWHUB_TOKEN`, loop over packages/*/ with SKILL.md | 9 skills |
| mcpservers.org                    | ❌ manual — 9 entries                     | see below |
| Anthropic community plugins       | ❌ manual — 6 submissions                 | 6 packages carry `.claude-plugin/`; see below |

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

The root `.claude-plugin/` directory isn't yet present at the top level — each sub-package carries its own `.claude-plugin/plugin.json` + `marketplace.json`, so the review pipeline reads per-package manifests. If Anthropic's reviewer asks for a single top-level entry, add a root-level `.claude-plugin/marketplace.json` that lists all 6 plugins (the 6 packages that carry `.claude-plugin/`).
