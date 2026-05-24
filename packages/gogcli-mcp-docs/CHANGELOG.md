# Changelog

## [2.1.0](https://github.com/chrischall/gogcli-mcp/compare/v2.0.13...v2.1.0) (2026-05-24)


### Features

* add manifest.json and SKILL.md to sub-packages for .mcpb and .skill builds ([d1339c6](https://github.com/chrischall/gogcli-mcp/commit/d1339c690b1eeee8221b7cc15fd9e4fa48c1e20a))
* address open issues for docs + sheets ([7109253](https://github.com/chrischall/gogcli-mcp/commit/7109253b3eb4b3dcc17cda7a8dfb1b6969023bcf))
* **deploy:** per-sub-package registry listings (MCP Registry, ClawHub, Claude plugins) ([6cc1798](https://github.com/chrischall/gogcli-mcp/commit/6cc1798320af6dd3af709790e6bec30f46c5f3d2))
* **docs:** add gog_docs_trash for whole-doc deletion ([#12](https://github.com/chrischall/gogcli-mcp/issues/12) part 2) ([4061649](https://github.com/chrischall/gogcli-mcp/commit/40616497744750ced02c60c4e0104662516e2503))
* **drive:** add gogcli-mcp-drive sub-package ([d8eef61](https://github.com/chrischall/gogcli-mcp/commit/d8eef61f16266209da70cd05ca0d2378bf3c4613))
* wrap new gog cli v0.18.0 tools ([173242a](https://github.com/chrischall/gogcli-mcp/commit/173242aafaa8c2f2d7282a2fbd8faedfc65a63bd))


### Bug Fixes

* add repository field to sub-packages for npm provenance ([3b56e4b](https://github.com/chrischall/gogcli-mcp/commit/3b56e4bb56617ad8381997176e6f60c932865454))
* **mcpb:** add per-sub-package .mcpbignore to trim bundles ([e739d9e](https://github.com/chrischall/gogcli-mcp/commit/e739d9ec9ae8e4cc19b1189bb5bf7ac90481c943))


### Refactor

* aggressive cleanup pass (audit findings) ([e635b39](https://github.com/chrischall/gogcli-mcp/commit/e635b391cf611e9c102a422ffbce5ebe28687b80))
* align docs test mock pattern with sheets ([a055aa6](https://github.com/chrischall/gogcli-mcp/commit/a055aa605baa6a363fea2154907fd0fc815b40ff))
* make sub-packages focused (auth + service only) ([4301306](https://github.com/chrischall/gogcli-mcp/commit/4301306cecf12e66d67dbc4ce9debae8f3dcfabc))
* restructure into npm workspaces monorepo ([9645100](https://github.com/chrischall/gogcli-mcp/commit/9645100e8120c03956ee972023b12d2e99876cc5))
* review-pass cleanup (enums, shared schemas, test harness) ([ea851de](https://github.com/chrischall/gogcli-mcp/commit/ea851deb30b9cfef3f07ed506a011fc363b34018))
* use relative imports instead of workspace symlinks ([a278d6f](https://github.com/chrischall/gogcli-mcp/commit/a278d6fb31be480571481e9d87e199d261a3f031))


### Documentation

* add per-package READMEs, update root README and CLAUDE.md for monorepo ([19d547e](https://github.com/chrischall/gogcli-mcp/commit/19d547e5ceb14298a75ab297d0a9a11c6ea59e24))
* **docs:** warn about gog_docs_append markdown table limitations ([b3dff16](https://github.com/chrischall/gogcli-mcp/commit/b3dff16c3025e33511a5f98c48bfa6fec1b2e918))
* fix tool counts and stale descriptions across all docs ([3558c72](https://github.com/chrischall/gogcli-mcp/commit/3558c72fa5c3ee3dbc8a06e9d7fb51bf73ef77c7))
* update gogcli repo URLs to openclaw/gogcli (was steipete/gogcli) ([951a181](https://github.com/chrischall/gogcli-mcp/commit/951a1818ebc269f203aee723ccbea32c13817d8b))
* warn about gog_docs_append markdown table limitations (closes [#18](https://github.com/chrischall/gogcli-mcp/issues/18), [#19](https://github.com/chrischall/gogcli-mcp/issues/19), [#20](https://github.com/chrischall/gogcli-mcp/issues/20)) ([2c94a19](https://github.com/chrischall/gogcli-mcp/commit/2c94a19acc8f1d5e9d18de5f8efb63f3dd8d03af))
