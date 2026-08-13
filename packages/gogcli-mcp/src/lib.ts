export {
  BASE_TOOL_REGISTRARS,
  VERSION,
  registerApiTools,
  registerAuthTools,
  authToolsFor,
  registerCalendarTools,
  registerClassroomTools,
  registerContactsTools,
  registerDocsTools,
  registerDriveTools,
  registerGmailTools,
  registerSheetsTools,
  registerSlidesTools,
  registerTasksTools,
} from './server.js';
export { run, runBinary, runExecutor, isGogFileArg, MIN_GOG_VERSION } from './runner.js';
// Sub-package tools that read gog JSON through bare `run()` (rather than the
// `runOrDiagnose` seam) must still apply this, or their timestamps skip the
// offset repair and the `<field>Display` sibling every other tool returns.
export { normalizeTimestamps } from './timestamps.js';
export { annotateTruncatedList, stripConsumedPageToken } from './pagination.js';
// Search-result finalization (newest-first ordering + loud truncation metadata).
// Sub-package search tools must route their output through this or they lose both
// guarantees the base gog_gmail_search makes.
export { finalizeGmailSearch, fetchGmailPages } from './gmail-results.js';
export type { FinalizeOptions, GmailListMethod } from './gmail-results.js';
export { useRemoteGogRunner } from './remote-runner.js';
export type { RunOptions, Spawner, GogExecutor, GogArg, GogFileArg } from './runner.js';
export {
  PAYLOAD_INLINE_MAX,
  payloadArg,
  accountParam,
  runOrDiagnose,
  diagnose,
  errorText,
  ids,
  paginationParams,
  pushPaginationFlags,
  pageTokenParam,
  pageAliasParam,
  resolvePageToken,
  registerRunTool,
} from './tools/utils.js';
