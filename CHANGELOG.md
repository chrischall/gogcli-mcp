# Changelog

## [2.16.3](https://github.com/chrischall/gogcli-mcp/compare/v2.16.2...v2.16.3) (2026-07-19)


### Bug Fixes

* **connector:** arm a client-side deadline on the Fly executor ([#171](https://github.com/chrischall/gogcli-mcp/issues/171)) ([1df64f9](https://github.com/chrischall/gogcli-mcp/commit/1df64f99d86f5d02c95e1eb24ef009d5051140f9))
* **connector:** drain in-flight requests so Gmail attachments stop 502ing ([#167](https://github.com/chrischall/gogcli-mcp/issues/167)) ([fa8933a](https://github.com/chrischall/gogcli-mcp/commit/fa8933a6d90f6e84f9033039c28ed4f9611be84e))

## [2.16.2](https://github.com/chrischall/gogcli-mcp/compare/v2.16.1...v2.16.2) (2026-07-19)


### Bug Fixes

* **deps:** move to workers-oauth-provider 0.8.x ([#165](https://github.com/chrischall/gogcli-mcp/issues/165)) ([82ee88a](https://github.com/chrischall/gogcli-mcp/commit/82ee88abce007c92e9f8689cb5cf595f8993b678))

## [2.16.1](https://github.com/chrischall/gogcli-mcp/compare/v2.16.0...v2.16.1) (2026-07-19)


### Documentation

* replace duplicated fleet policy with a pointer ([#161](https://github.com/chrischall/gogcli-mcp/issues/161)) ([58a7657](https://github.com/chrischall/gogcli-mcp/commit/58a765747ca6695a899e8f71f185383009364e42))

## [2.16.0](https://github.com/chrischall/gogcli-mcp/compare/v2.15.0...v2.16.0) (2026-07-18)


### Features

* **gmail:** deliver attachment contents inline or via Drive ([#159](https://github.com/chrischall/gogcli-mcp/issues/159)) ([149ee78](https://github.com/chrischall/gogcli-mcp/commit/149ee7883766ae6b7db63386902dd9ef3675ce54))

## [2.15.0](https://github.com/chrischall/gogcli-mcp/compare/v2.14.0...v2.15.0) (2026-07-17)


### Features

* **connector:** add claude.ai remote connector (CF Worker + Fly gog backend) ([#153](https://github.com/chrischall/gogcli-mcp/issues/153)) ([2caed49](https://github.com/chrischall/gogcli-mcp/commit/2caed494123746ed30d2b1503e93dc9d89115f46))
* **connector:** add per-service MCP paths exposing each service's extended tools ([#157](https://github.com/chrischall/gogcli-mcp/issues/157)) ([8a50703](https://github.com/chrischall/gogcli-mcp/commit/8a50703b73f8aab165a23d02d008a46879a3ac4d))


### Refactor

* **runner:** inject gog execution behind an AsyncLocalStorage executor seam ([#149](https://github.com/chrischall/gogcli-mcp/issues/149)) ([199614c](https://github.com/chrischall/gogcli-mcp/commit/199614ccdee5419f86fd1042efed55d465e535a9))

## [2.14.0](https://github.com/chrischall/gogcli-mcp/compare/v2.13.0...v2.14.0) (2026-07-17)


### Features

* catch up to gog 0.34.1 (drive recursive sync push, gmail inline attachments, calendar remove-meet) ([#147](https://github.com/chrischall/gogcli-mcp/issues/147)) ([39598d1](https://github.com/chrischall/gogcli-mcp/commit/39598d153f895e6c0f67aa3f4e6da0c825eccafa))

## [2.13.0](https://github.com/chrischall/gogcli-mcp/compare/v2.12.1...v2.13.0) (2026-07-11)


### Features

* catch up to gog 0.34.0 (calendar timezone, docs chips, sheets filters + gradients) ([#141](https://github.com/chrischall/gogcli-mcp/issues/141)) ([1a5b020](https://github.com/chrischall/gogcli-mcp/commit/1a5b02076923303a36716d667711341cec5ef028))

## [2.12.1](https://github.com/chrischall/gogcli-mcp/compare/v2.12.0...v2.12.1) (2026-07-07)


### Bug Fixes

* append --force after --dry-run in gog api tool ([#139](https://github.com/chrischall/gogcli-mcp/issues/139)) ([3bf6830](https://github.com/chrischall/gogcli-mcp/commit/3bf68309795eae5468cdea682813e70810fa12a7))
* **security:** redact gog run success output and stop advertising token dump ([#138](https://github.com/chrischall/gogcli-mcp/issues/138)) ([2eb2ca6](https://github.com/chrischall/gogcli-mcp/commit/2eb2ca6a8340c65e350f5e4a55bf4a4addd3fb22))


### Refactor

* adopt @chrischall/mcp-utils (bootstrap, results, redaction, env, test harness) ([#135](https://github.com/chrischall/gogcli-mcp/issues/135)) ([8cceefe](https://github.com/chrischall/gogcli-mcp/commit/8cceefea109c19698063a6b9df04d8f308ef774f))


### Documentation

* document first-party dependency-bump label exception ([#140](https://github.com/chrischall/gogcli-mcp/issues/140)) ([e4889ec](https://github.com/chrischall/gogcli-mcp/commit/e4889ecd86ba9b1b4e750adc185be74c8cc12845))

## [2.12.0](https://github.com/chrischall/gogcli-mcp/compare/v2.11.0...v2.12.0) (2026-07-05)


### Features

* **docs:** wrap gog 0.32.0 suggestions listing and paragraph spacing mode ([#130](https://github.com/chrischall/gogcli-mcp/issues/130)) ([4ece479](https://github.com/chrischall/gogcli-mcp/commit/4ece4790037622e1d3828b815dc63dcb4e49d783))


### Bug Fixes

* pass --force to gated destructive gog commands so they work non-interactively ([#132](https://github.com/chrischall/gogcli-mcp/issues/132)) ([6b24435](https://github.com/chrischall/gogcli-mcp/commit/6b244355789645678310ce5a9dd86bb5f4d52a89))

## [2.11.0](https://github.com/chrischall/gogcli-mcp/compare/v2.10.0...v2.11.0) (2026-07-03)


### Features

* **calendar:** wrap gog 0.31.1 changed-events listing and attendee modifiers ([#128](https://github.com/chrischall/gogcli-mcp/issues/128)) ([f834048](https://github.com/chrischall/gogcli-mcp/commit/f83404843718168faf1297b0ee3d933a763324c6))

## [2.10.0](https://github.com/chrischall/gogcli-mcp/compare/v2.9.0...v2.10.0) (2026-06-25)


### Features

* **docs:** wrap gog 0.30 docs authoring ([#119](https://github.com/chrischall/gogcli-mcp/issues/119)) ([5262a67](https://github.com/chrischall/gogcli-mcp/commit/5262a67e71505e6f91c257eb7da193eed933af36))
* generic Google API access + readonly safety ([#123](https://github.com/chrischall/gogcli-mcp/issues/123)) ([6eed43f](https://github.com/chrischall/gogcli-mcp/commit/6eed43f91709b27c11121d2913ae24b6124524c8))
* **slides:** wrap gog 0.29 native authoring — reads, text, slides, shapes ([#121](https://github.com/chrischall/gogcli-mcp/issues/121)) ([7a862dd](https://github.com/chrischall/gogcli-mcp/commit/7a862ddcbbe8bc7f2a3da86d2dd9ef5d81b95f0c))
* **slides:** wrap gog 0.29 slides tables ([#122](https://github.com/chrischall/gogcli-mcp/issues/122)) ([3aaacea](https://github.com/chrischall/gogcli-mcp/commit/3aaaceae99ca18cc03165514799c23e2b61ac0bb))
* **tools:** catch up to gog v0.31.0 ([#117](https://github.com/chrischall/gogcli-mcp/issues/117)) ([97029f2](https://github.com/chrischall/gogcli-mcp/commit/97029f2a54f3f6ad5cec34e12fcc6fee7bf5b797))


### Bug Fixes

* **tools:** pass --force to delete tools gog refuses non-interactively ([#125](https://github.com/chrischall/gogcli-mcp/issues/125)) ([412003b](https://github.com/chrischall/gogcli-mcp/commit/412003bfab6695c17f2d4f7dd5c302801819e4c8))


### Documentation

* **docs:** clarify footnote segment ID source in segment param ([#124](https://github.com/chrischall/gogcli-mcp/issues/124)) ([ccb6a77](https://github.com/chrischall/gogcli-mcp/commit/ccb6a7748ee5ed016dab3ec4941e63d3a767fe7e))
* document the --force gotcha for gated deletes ([#126](https://github.com/chrischall/gogcli-mcp/issues/126)) ([9ebaad4](https://github.com/chrischall/gogcli-mcp/commit/9ebaad443c86f1531f9119d5160463b8baa90985))

## [2.9.0](https://github.com/chrischall/gogcli-mcp/compare/v2.8.0...v2.9.0) (2026-06-15)


### Features

* **gmail:** catch up to gog v0.27.0 — first-class reply / reply-all ([#110](https://github.com/chrischall/gogcli-mcp/issues/110)) ([a6148b9](https://github.com/chrischall/gogcli-mcp/commit/a6148b976df072cb9e6cabcad4ae5e74c44d5a6d))
* **tools:** catch up to gog v0.26.0 — calendar unsubscribe/delete-calendar, gmail draft HTML-file ([#108](https://github.com/chrischall/gogcli-mcp/issues/108)) ([2ba9e4c](https://github.com/chrischall/gogcli-mcp/commit/2ba9e4cbed76460390f746189642d1e49363f238))
* **tools:** catch up to gog v0.28.0 — contacts dedupe --apply, gmail draft reply-all ([#112](https://github.com/chrischall/gogcli-mcp/issues/112)) ([d7521ae](https://github.com/chrischall/gogcli-mcp/commit/d7521aea963f21e1143d9714449f72222d8059bf))


### Documentation

* bump pr-workflow marker to v2 ([#106](https://github.com/chrischall/gogcli-mcp/issues/106)) ([781fa5a](https://github.com/chrischall/gogcli-mcp/commit/781fa5ab65c65eac50b4704e25001c3cf3e79e4c))
* document auto-review follow-up issue convention ([#111](https://github.com/chrischall/gogcli-mcp/issues/111)) ([a7a658f](https://github.com/chrischall/gogcli-mcp/commit/a7a658f4966f9ca2e6d77160dc1815f3b205dcdb))

## [2.8.0](https://github.com/chrischall/gogcli-mcp/compare/v2.7.1...v2.8.0) (2026-06-12)


### Features

* **tools:** catch up to gog v0.25.0 — Docs request batches, gmail thread archive, drive shortcuts ([#101](https://github.com/chrischall/gogcli-mcp/issues/101)) ([d551989](https://github.com/chrischall/gogcli-mcp/commit/d551989304defb99b4cadcea99692a644d85c116))

## [2.7.1](https://github.com/chrischall/gogcli-mcp/compare/v2.7.0...v2.7.1) (2026-06-11)


### Bug Fixes

* bot PRs bypass the CI gate unconditionally (upstream curtaincall[#86](https://github.com/chrischall/gogcli-mcp/issues/86) review) ([#100](https://github.com/chrischall/gogcli-mcp/issues/100)) ([04ce65e](https://github.com/chrischall/gogcli-mcp/commit/04ce65e3d2acb9656113ac598f1abd840a7d90af))


### Documentation

* add MIT LICENSE file ([#96](https://github.com/chrischall/gogcli-mcp/issues/96)) ([c8acf64](https://github.com/chrischall/gogcli-mcp/commit/c8acf642148869268c3c74feb853f54229a07401))
* **readme:** add CI, npm version, coverage, and license badges ([#94](https://github.com/chrischall/gogcli-mcp/issues/94)) ([4a77d1f](https://github.com/chrischall/gogcli-mcp/commit/4a77d1fb5db0704dea31cca5eed1091fcd11f61f))

## [2.7.0](https://github.com/chrischall/gogcli-mcp/compare/v2.6.1...v2.7.0) (2026-06-11)


### Features

* **tools:** catch up to gog v0.24.0 — sheets validation, docs table CRUD & named ranges, drive revisions ([#92](https://github.com/chrischall/gogcli-mcp/issues/92)) ([dcfdfe1](https://github.com/chrischall/gogcli-mcp/commit/dcfdfe15c51655921525b223ff6d4ae56c453320))

## [2.6.1](https://github.com/chrischall/gogcli-mcp/compare/v2.6.0...v2.6.1) (2026-06-09)


### Bug Fixes

* **sheets:** correct off-by-one in gog_sheets_insert start index ([#89](https://github.com/chrischall/gogcli-mcp/issues/89)) ([f59970a](https://github.com/chrischall/gogcli-mcp/commit/f59970accad170bf3dd6d9c31824a57a8bf47fc7))

## [2.6.0](https://github.com/chrischall/gogcli-mcp/compare/v2.5.0...v2.6.0) (2026-06-09)


### Features

* **sheets:** preserve data on table delete + add snapshot & batch-link tools ([#86](https://github.com/chrischall/gogcli-mcp/issues/86)) ([4ba775b](https://github.com/chrischall/gogcli-mcp/commit/4ba775b932bb768ebea2f470db80933a9de50209))
* **tools:** catch up to gog v0.23.0 — table-delete guard, link/anchor docs flags, new tools ([#88](https://github.com/chrischall/gogcli-mcp/issues/88)) ([d8cb5b6](https://github.com/chrischall/gogcli-mcp/commit/d8cb5b61938619ea4d0e95b7f07649fe285d531f))

## [2.5.0](https://github.com/chrischall/gogcli-mcp/compare/v2.4.1...v2.5.0) (2026-06-07)


### Features

* **gmail:** add attachments (attach) to gog_gmail_send ([#80](https://github.com/chrischall/gogcli-mcp/issues/80)) ([2155f91](https://github.com/chrischall/gogcli-mcp/commit/2155f9115b81e22cfd9b762c7ba0f69f73b42d04))
* **tools:** catch up to gog v0.22.0 — drafts threading, code style, comment --since ([#85](https://github.com/chrischall/gogcli-mcp/issues/85)) ([3f455d6](https://github.com/chrischall/gogcli-mcp/commit/3f455d61eebc0a729adbcaacb7bc4e16d3ddacfe))

## [2.4.1](https://github.com/chrischall/gogcli-mcp/compare/v2.4.0...v2.4.1) (2026-06-02)


### Bug Fixes

* **gmail:** add replyToThreadId so draft replies thread to the right message ([#75](https://github.com/chrischall/gogcli-mcp/issues/75)) ([0de0ac6](https://github.com/chrischall/gogcli-mcp/commit/0de0ac6fb8d95763d741049b30c4a1e7ade56ac3))

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
