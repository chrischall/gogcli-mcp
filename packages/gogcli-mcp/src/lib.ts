export {
  BASE_TOOL_REGISTRARS,
  VERSION,
  registerApiTools,
  registerAppScriptTools,
  registerAuthTools,
  authToolsFor,
  registerCalendarTools,
  registerChatTools,
  registerClassroomTools,
  registerContactsTools,
  registerDocsTools,
  registerDriveTools,
  registerGmailTools,
  registerSheetsTools,
  registerSlidesTools,
  registerTasksTools,
} from './server.js';
// The reply/reply-all schema and flag builder live in the base package so the
// gmail sub-package's draft-side twins reuse ONE definition — registering the
// same tool name from both registrar lists would be a duplicate-name error.
export { replySchema, appendReplyFlags } from './tools/gmail.js';
export type { ReplyFlags } from './tools/gmail.js';
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
// Caller-supplied attachment bytes — the only outbound attachment path that
// works when the caller and gog share no filesystem (hosted connector, or any
// GOG_RUNNER_URL backend). See src/attachments.ts.
export {
  attachInlineParam,
  inlineAttachmentSchema,
  inlineAttachmentArgs,
  inlineFileArg,
  INLINE_ATTACHMENT_LIMITS_TEXT,
  MAX_INLINE_ATTACHMENT_BYTES,
  MAX_INLINE_ATTACHMENT_TOTAL_BYTES,
  MAX_REQUEST_PAYLOAD_WIRE_BYTES,
} from './attachments.js';
export type { InlineAttachmentInput } from './attachments.js';
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
  assertNotBoth,
} from './tools/utils.js';
