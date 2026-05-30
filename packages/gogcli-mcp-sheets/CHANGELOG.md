# Changelog

## [2.3.0](https://github.com/chrischall/gogcli-mcp/compare/v2.2.0...v2.3.0) (2026-05-30)


### Features

* add manifest.json and SKILL.md to sub-packages for .mcpb and .skill builds ([d1339c6](https://github.com/chrischall/gogcli-mcp/commit/d1339c690b1eeee8221b7cc15fd9e4fa48c1e20a))
* address open issues for docs + sheets ([7109253](https://github.com/chrischall/gogcli-mcp/commit/7109253b3eb4b3dcc17cda7a8dfb1b6969023bcf))
* **deploy:** per-sub-package registry listings (MCP Registry, ClawHub, Claude plugins) ([6cc1798](https://github.com/chrischall/gogcli-mcp/commit/6cc1798320af6dd3af709790e6bec30f46c5f3d2))
* **drive:** add gogcli-mcp-drive sub-package ([d8eef61](https://github.com/chrischall/gogcli-mcp/commit/d8eef61f16266209da70cd05ca0d2378bf3c4613))
* **sheets:** warn when DATE/DATE_TIME format applied to small integers ([#46](https://github.com/chrischall/gogcli-mcp/issues/46)) ([623c432](https://github.com/chrischall/gogcli-mcp/commit/623c432998d94875706733d4140b346de74ef9d8))
* wrap new gog cli v0.18.0 tools ([173242a](https://github.com/chrischall/gogcli-mcp/commit/173242aafaa8c2f2d7282a2fbd8faedfc65a63bd))


### Bug Fixes

* add repository field to sub-packages for npm provenance ([3b56e4b](https://github.com/chrischall/gogcli-mcp/commit/3b56e4bb56617ad8381997176e6f60c932865454))
* **mcpb:** add per-sub-package .mcpbignore to trim bundles ([e739d9e](https://github.com/chrischall/gogcli-mcp/commit/e739d9ec9ae8e4cc19b1189bb5bf7ac90481c943))
* **sheets:** gog_sheets_insert with after:true now actually shifts the insertion point ([#44](https://github.com/chrischall/gogcli-mcp/issues/44)) ([a766d80](https://github.com/chrischall/gogcli-mcp/commit/a766d8065993e764a8ed35965e506af472eafa89))


### Refactor

* aggressive cleanup pass (audit findings) ([e635b39](https://github.com/chrischall/gogcli-mcp/commit/e635b391cf611e9c102a422ffbce5ebe28687b80))
* make sub-packages focused (auth + service only) ([4301306](https://github.com/chrischall/gogcli-mcp/commit/4301306cecf12e66d67dbc4ce9debae8f3dcfabc))
* restructure into npm workspaces monorepo ([9645100](https://github.com/chrischall/gogcli-mcp/commit/9645100e8120c03956ee972023b12d2e99876cc5))
* review-pass cleanup (enums, shared schemas, test harness) ([ea851de](https://github.com/chrischall/gogcli-mcp/commit/ea851deb30b9cfef3f07ed506a011fc363b34018))
* use relative imports instead of workspace symlinks ([a278d6f](https://github.com/chrischall/gogcli-mcp/commit/a278d6fb31be480571481e9d87e199d261a3f031))


### Documentation

* add per-package READMEs, update root README and CLAUDE.md for monorepo ([19d547e](https://github.com/chrischall/gogcli-mcp/commit/19d547e5ceb14298a75ab297d0a9a11c6ea59e24))
* fix tool counts and stale descriptions across all docs ([3558c72](https://github.com/chrischall/gogcli-mcp/commit/3558c72fa5c3ee3dbc8a06e9d7fb51bf73ef77c7))
* update gogcli repo URLs to openclaw/gogcli (was steipete/gogcli) ([951a181](https://github.com/chrischall/gogcli-mcp/commit/951a1818ebc269f203aee723ccbea32c13817d8b))

## [2.2.0](https://github.com/chrischall/gogcli-mcp/compare/v2.1.0...v2.2.0) (2026-05-26)


### Features

* **sheets:** warn when DATE/DATE_TIME format applied to small integers ([#46](https://github.com/chrischall/gogcli-mcp/issues/46)) ([623c432](https://github.com/chrischall/gogcli-mcp/commit/623c432998d94875706733d4140b346de74ef9d8))


### Bug Fixes

* **sheets:** gog_sheets_insert with after:true now actually shifts the insertion point ([#44](https://github.com/chrischall/gogcli-mcp/issues/44)) ([a766d80](https://github.com/chrischall/gogcli-mcp/commit/a766d8065993e764a8ed35965e506af472eafa89))

## [2.1.0](https://github.com/chrischall/gogcli-mcp/compare/v2.0.13...v2.1.0) (2026-05-25)


### Features

* add manifest.json and SKILL.md to sub-packages for .mcpb and .skill builds ([d1339c6](https://github.com/chrischall/gogcli-mcp/commit/d1339c690b1eeee8221b7cc15fd9e4fa48c1e20a))
* address open issues for docs + sheets ([7109253](https://github.com/chrischall/gogcli-mcp/commit/7109253b3eb4b3dcc17cda7a8dfb1b6969023bcf))
* **deploy:** per-sub-package registry listings (MCP Registry, ClawHub, Claude plugins) ([6cc1798](https://github.com/chrischall/gogcli-mcp/commit/6cc1798320af6dd3af709790e6bec30f46c5f3d2))
* **drive:** add gogcli-mcp-drive sub-package ([d8eef61](https://github.com/chrischall/gogcli-mcp/commit/d8eef61f16266209da70cd05ca0d2378bf3c4613))
* wrap new gog cli v0.18.0 tools ([173242a](https://github.com/chrischall/gogcli-mcp/commit/173242aafaa8c2f2d7282a2fbd8faedfc65a63bd))


### Bug Fixes

* add repository field to sub-packages for npm provenance ([3b56e4b](https://github.com/chrischall/gogcli-mcp/commit/3b56e4bb56617ad8381997176e6f60c932865454))
* **mcpb:** add per-sub-package .mcpbignore to trim bundles ([e739d9e](https://github.com/chrischall/gogcli-mcp/commit/e739d9ec9ae8e4cc19b1189bb5bf7ac90481c943))


### Refactor

* aggressive cleanup pass (audit findings) ([e635b39](https://github.com/chrischall/gogcli-mcp/commit/e635b391cf611e9c102a422ffbce5ebe28687b80))
* make sub-packages focused (auth + service only) ([4301306](https://github.com/chrischall/gogcli-mcp/commit/4301306cecf12e66d67dbc4ce9debae8f3dcfabc))
* restructure into npm workspaces monorepo ([9645100](https://github.com/chrischall/gogcli-mcp/commit/9645100e8120c03956ee972023b12d2e99876cc5))
* review-pass cleanup (enums, shared schemas, test harness) ([ea851de](https://github.com/chrischall/gogcli-mcp/commit/ea851deb30b9cfef3f07ed506a011fc363b34018))
* use relative imports instead of workspace symlinks ([a278d6f](https://github.com/chrischall/gogcli-mcp/commit/a278d6fb31be480571481e9d87e199d261a3f031))


### Documentation

* add per-package READMEs, update root README and CLAUDE.md for monorepo ([19d547e](https://github.com/chrischall/gogcli-mcp/commit/19d547e5ceb14298a75ab297d0a9a11c6ea59e24))
* fix tool counts and stale descriptions across all docs ([3558c72](https://github.com/chrischall/gogcli-mcp/commit/3558c72fa5c3ee3dbc8a06e9d7fb51bf73ef77c7))
* update gogcli repo URLs to openclaw/gogcli (was steipete/gogcli) ([951a181](https://github.com/chrischall/gogcli-mcp/commit/951a1818ebc269f203aee723ccbea32c13817d8b))
