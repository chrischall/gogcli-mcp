# Changelog

## [2.4.0](https://github.com/chrischall/gogcli-mcp/compare/v2.3.0...v2.4.0) (2026-06-01)


### Features

* **tools:** wrap notable gog v0.20.0 commands across sheets/docs/gmail ([#72](https://github.com/chrischall/gogcli-mcp/issues/72)) ([862b487](https://github.com/chrischall/gogcli-mcp/commit/862b487c73f0fde254c1ef1af826e1c1bd13b2f4))


### Documentation

* **sheets:** clarify gog_sheets_batch_update [@file](https://github.com/file) resolves on the gog server ([#68](https://github.com/chrischall/gogcli-mcp/issues/68)) ([9beae7d](https://github.com/chrischall/gogcli-mcp/commit/9beae7d55e4b92e6a40193dcc401ffc770806ec8))

## [2.3.0](https://github.com/chrischall/gogcli-mcp/compare/v2.2.0...v2.3.0) (2026-05-30)


### Features

* **tools:** catch up to gog v0.19.0 — 61 new tools across 6 services ([#64](https://github.com/chrischall/gogcli-mcp/issues/64)) ([ee523c5](https://github.com/chrischall/gogcli-mcp/commit/ee523c56d5c764aec9c8fb6eec188ff57a55ab5a))

## [2.2.0](https://github.com/chrischall/gogcli-mcp/compare/v2.1.0...v2.2.0) (2026-05-30)


### Features

* **sheets:** warn when DATE/DATE_TIME format applied to small integers ([#46](https://github.com/chrischall/gogcli-mcp/issues/46)) ([623c432](https://github.com/chrischall/gogcli-mcp/commit/623c432998d94875706733d4140b346de74ef9d8))


### Bug Fixes

* **ci:** auto-merge arm guards ([#49](https://github.com/chrischall/gogcli-mcp/issues/49)) ([8b4598c](https://github.com/chrischall/gogcli-mcp/commit/8b4598cf7b800aad1cd5c69df5763f249bb1b1f8))
* **release-please:** collapse to a single root component for reliable tagging ([#58](https://github.com/chrischall/gogcli-mcp/issues/58)) ([8d6d880](https://github.com/chrischall/gogcli-mcp/commit/8d6d880f14dd6923af82e3c4ca1aa9b35fd7695d))
* **release-please:** match the versionless grouped release-PR title for tagging ([#56](https://github.com/chrischall/gogcli-mcp/issues/56)) ([fc288f0](https://github.com/chrischall/gogcli-mcp/commit/fc288f03f630ec1ba4052924c44c7bbf1f24a16f))
* **release-please:** parse version from the release-PR title ([#57](https://github.com/chrischall/gogcli-mcp/issues/57)) ([c892fad](https://github.com/chrischall/gogcli-mcp/commit/c892fad0c035ab78cc77a656acfd3e220d6e91eb))
* **release-please:** version the grouped release-PR title so it can be tagged ([#55](https://github.com/chrischall/gogcli-mcp/issues/55)) ([e3cb664](https://github.com/chrischall/gogcli-mcp/commit/e3cb66480e78e6317fc03aada0b56ec25b84a0c3))
* **sheets:** gog_sheets_insert with after:true now actually shifts the insertion point ([#44](https://github.com/chrischall/gogcli-mcp/issues/44)) ([a766d80](https://github.com/chrischall/gogcli-mcp/commit/a766d8065993e764a8ed35965e506af472eafa89))


### Documentation

* **claude:** warn against opening PRs before the feature is done ([#41](https://github.com/chrischall/gogcli-mcp/issues/41)) ([86a13a4](https://github.com/chrischall/gogcli-mcp/commit/86a13a4426677505d5a143cad22f49f73b2e739e))
* require Conventional Commit PR titles so release-please picks up changes ([#53](https://github.com/chrischall/gogcli-mcp/issues/53)) ([89b1170](https://github.com/chrischall/gogcli-mcp/commit/89b1170b798d222a5b650cb7b68f4c7c954a1630))
