# Changelog

## [2.1.0](https://github.com/chrischall/gogcli-mcp/compare/v2.0.13...v2.1.0) (2026-05-25)


### Features

* add gogcli-mcp-slides and gogcli-mcp-classroom sub-packages ([cee8724](https://github.com/chrischall/gogcli-mcp/commit/cee872442240e52ae1cac9b9085eabce0c5ff9c3))
* add manifest.json and SKILL.md to sub-packages for .mcpb and .skill builds ([d1339c6](https://github.com/chrischall/gogcli-mcp/commit/d1339c690b1eeee8221b7cc15fd9e4fa48c1e20a))
* address open issues for docs + sheets ([7109253](https://github.com/chrischall/gogcli-mcp/commit/7109253b3eb4b3dcc17cda7a8dfb1b6969023bcf))
* **deploy:** per-sub-package registry listings (MCP Registry, ClawHub, Claude plugins) ([6cc1798](https://github.com/chrischall/gogcli-mcp/commit/6cc1798320af6dd3af709790e6bec30f46c5f3d2))
* **drive:** add gogcli-mcp-drive sub-package ([d8eef61](https://github.com/chrischall/gogcli-mcp/commit/d8eef61f16266209da70cd05ca0d2378bf3c4613))
* fold People into contacts and Meet into calendar; add TODO.md ([f649119](https://github.com/chrischall/gogcli-mcp/commit/f64911902094f87ae31420913e9d1a5ba608441f))
* wrap new gog cli v0.18.0 tools ([173242a](https://github.com/chrischall/gogcli-mcp/commit/173242aafaa8c2f2d7282a2fbd8faedfc65a63bd))


### Bug Fixes

* emit type declarations from base so sub-packages can resolve gogcli-mcp/lib ([9cee5ed](https://github.com/chrischall/gogcli-mcp/commit/9cee5ed97b0cc72dde81c7f8a01d71c95a0291b7))
* **mcpb:** add per-sub-package .mcpbignore to trim bundles ([e739d9e](https://github.com/chrischall/gogcli-mcp/commit/e739d9ec9ae8e4cc19b1189bb5bf7ac90481c943))
* **runner:** augment PATH + helpful ENOENT message for missing gog ([34e696f](https://github.com/chrischall/gogcli-mcp/commit/34e696f8c74c7003e6b1bb31991a05184a3b6094))
* **runner:** fall back to PATH lookup when GOG_PATH is empty string ([a726592](https://github.com/chrischall/gogcli-mcp/commit/a726592c86e869fe27b176798a9b8909e7821f4c))
* **runner:** treat unresolved .mcpb placeholders as unset env vars ([17a0363](https://github.com/chrischall/gogcli-mcp/commit/17a0363f7dffd2757667e0d1d9377e2e2cb6fbc7))
* treat empty GOG_PATH as unset, fall back to 'gog' on PATH ([0204638](https://github.com/chrischall/gogcli-mcp/commit/020463813f941b1fa8ec2360346c55abc244675f))


### Refactor

* aggressive cleanup pass (audit findings) ([e635b39](https://github.com/chrischall/gogcli-mcp/commit/e635b391cf611e9c102a422ffbce5ebe28687b80))
* make sub-packages focused (auth + service only) ([4301306](https://github.com/chrischall/gogcli-mcp/commit/4301306cecf12e66d67dbc4ce9debae8f3dcfabc))
* rebalance base vs sub-package tool split (120 -&gt; 84 base) ([1074953](https://github.com/chrischall/gogcli-mcp/commit/1074953833fc4766e85cc0b28cbcc08834f8dc47))
* remove comments escape hatch from base docs tool ([a5364c6](https://github.com/chrischall/gogcli-mcp/commit/a5364c6df1948e57b185b9d753aa11b033edd0d0))
* restructure into npm workspaces monorepo ([9645100](https://github.com/chrischall/gogcli-mcp/commit/9645100e8120c03956ee972023b12d2e99876cc5))
* review-pass cleanup (enums, shared schemas, test harness) ([ea851de](https://github.com/chrischall/gogcli-mcp/commit/ea851deb30b9cfef3f07ed506a011fc363b34018))
* use relative imports instead of workspace symlinks ([a278d6f](https://github.com/chrischall/gogcli-mcp/commit/a278d6fb31be480571481e9d87e199d261a3f031))


### Documentation

* add per-package READMEs, update root README and CLAUDE.md for monorepo ([19d547e](https://github.com/chrischall/gogcli-mcp/commit/19d547e5ceb14298a75ab297d0a9a11c6ea59e24))
* fix tool counts and stale descriptions across all docs ([3558c72](https://github.com/chrischall/gogcli-mcp/commit/3558c72fa5c3ee3dbc8a06e9d7fb51bf73ef77c7))
* update gogcli repo URLs to openclaw/gogcli (was steipete/gogcli) ([951a181](https://github.com/chrischall/gogcli-mcp/commit/951a1818ebc269f203aee723ccbea32c13817d8b))
