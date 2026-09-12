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
// Signed URLs for mcp-host's per-registration blob store — the only way a
// hosted child can hand an agent BYTES it can fetch with `curl`. Exported from
// the base package so the gmail sub-package (and any later one) shares ONE
// implementation of the signing; see src/blob-urls.ts for why that matters.
// Deliberately NOT re-exporting the payload builders: a caller outside this
// module has no business assembling a payload and signing it by hand, which is
// the mistake the shared minter exists to prevent.
export {
  blobStoreFromEnv,
  createBlobUrlMinter,
  BLOB_URL_MAX_TTL_MS,
  BLOB_URL_DEFAULT_TTL_MS,
} from './blob-urls.js';
export type { BlobStoreConfig, BlobUrlMinter, MintOptions } from './blob-urls.js';
// The other half of that hop: under the hosted connector the bytes are on the
// RUNNER's disk and this child never sees them, so the runner is asked to
// stream them to the URL this process minted. See src/blob-upload.ts.
export { uploadToBlobStore, RUNNER_UPLOAD_TIMEOUT_MS } from './blob-upload.js';
export type { BlobUploadRequest, BlobUploadOutcome, BlobUploadOptions } from './blob-upload.js';
