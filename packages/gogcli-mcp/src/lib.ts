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
// The gmail confirmation gate — gog_gmail_reply/send/forward/autoreply are
// the only tools that dispatch mail irreversibly on the first call. The
// gmail sub-package's send-side forward/autoreply tools reuse these directly
// rather than re-declaring the gate; the draft-side twins never import them.
export {
  attachmentNames,
  bodyPreview,
  extractEmails,
  logGmailDispatch,
  requireGmailDispatchConfirmation,
  resultText,
} from './gmail-dispatch-guard.js';
export { run, runBinary, isGogFileArg, MIN_GOG_VERSION } from './runner.js';
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
export { bootstrapGogAuth, AUTH_BOOTSTRAP_MARKER } from './bootstrap-auth.js';
export type { AuthBootstrapStatus, AuthBootstrapOptions } from './bootstrap-auth.js';
export type { RunOptions, Spawner, GogArg, GogFileArg } from './runner.js';
export { pos } from './argv.js';
export type { GogPositional } from './argv.js';
// Caller-supplied attachment bytes — the only outbound attachment path that
// works when the caller and gog share no filesystem (a hosted deployment such
// as mcp-host). See src/attachments.ts.
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
// The other half of that hop: stream a downloaded attachment off this machine's
// disk to the URL this process minted. See src/blob-upload.ts.
export {
  uploadToBlobStore,
  ATTACHMENT_DOWNLOAD_ROOT,
  BLOB_UPLOAD_TIMEOUT_MS,
  MAX_BLOB_UPLOAD_BYTES,
} from './blob-upload.js';
export type { BlobUploadRequest, BlobUploadOutcome, BlobUploadOptions } from './blob-upload.js';
