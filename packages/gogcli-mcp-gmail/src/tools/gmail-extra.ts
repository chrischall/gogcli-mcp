import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { rawTextResult, textResult, errorResult } from '@chrischall/mcp-utils';
import { accountParam, runOrDiagnose, run, diagnose, payloadArg } from '../../../gogcli-mcp/src/lib.js';
import type { GogArg } from '../../../gogcli-mcp/src/lib.js';

// gog rejects an inline flag together with its --*-file twin — `gmail drafts
// create` errors with "use only one of --body-html or --body-html-file", and
// `gmail forward` does the same for --note (misreporting it as --body). Catch
// the conflict here so the caller gets a message naming the TOOL params it
// actually passed, instead of a gog error naming flags it never saw.
function assertNotBoth(
  inlineParam: string,
  fileParam: string,
  inlineValue: string | undefined,
  fileValue: string | undefined,
): void {
  if (inlineValue !== undefined && fileValue !== undefined) {
    throw new Error(
      `${inlineParam} and ${fileParam} are mutually exclusive — gog accepts only one of them. ` +
      `Pass ${inlineParam} with the content itself (it is written to a temp file automatically when large), ` +
      `or ${fileParam} with a path that already exists on the gog server.`,
    );
  }
}

// Pull the text out of a single-text-block tool result; undefined for any
// other shape (an error result is still a text block, so it parses below).
function resultText(result: CallToolResult): string | undefined {
  const first = result.content[0];
  return first?.type === 'text' ? first.text : undefined;
}

type GmailHeader = { name?: string; value?: string };
type GmailMessage = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: { headers?: GmailHeader[] };
};

// Headers worth keeping in a snippets-only thread view.
const SNIPPET_HEADERS = ['From', 'To', 'Cc', 'Subject', 'Date'];

// Reduce a full Gmail message to a lightweight overview: id/labels/snippet plus
// the key envelope headers, dropping the raw MIME payload that dominates the
// size of a thread fetch.
function summarizeMessage(m: GmailMessage): Record<string, unknown> {
  const rawHeaders = m.payload?.headers;
  const headers: Record<string, string | undefined> = {};
  if (Array.isArray(rawHeaders)) {
    for (const h of rawHeaders) {
      if (h.name && SNIPPET_HEADERS.includes(h.name)) headers[h.name] = h.value;
    }
  }
  return {
    id: m.id,
    threadId: m.threadId,
    internalDate: m.internalDate,
    labelIds: m.labelIds,
    snippet: m.snippet,
    headers,
  };
}

// Wrapper-side trim of a `gog gmail thread get` JSON result: keep only the last
// `latestN` messages and/or reduce each to a snippet view. gog has no native
// message-limit flag, so this is done by post-processing its output. Any
// non-JSON output (an error, an unexpected shape) is passed through untouched.
function trimThread(
  result: CallToolResult,
  latestN: number | undefined,
  snippetsOnly: boolean | undefined,
): CallToolResult {
  try {
    const parsed = JSON.parse(resultText(result) ?? '') as { thread?: { messages?: unknown[] } };
    const messages = parsed.thread?.messages;
    if (!Array.isArray(messages)) return result;
    let trimmed: unknown[] = messages;
    if (latestN !== undefined) trimmed = trimmed.slice(-latestN);
    if (snippetsOnly) trimmed = trimmed.map((m) => summarizeMessage(m as GmailMessage));
    return rawTextResult(JSON.stringify({ ...parsed, thread: { ...parsed.thread, messages: trimmed } }));
  } catch {
    return result;
  }
}

// `gog gmail attachment --inline --json` emits only these fields (no MIME type):
// base64 content when the attachment is within gog's 3 MiB inline cap, otherwise
// just the on-disk path plus a `reason` explaining the size fallback.
type InlineAttachment = {
  path?: string;
  bytes?: number;
  contentBase64?: string;
  reason?: string;
};

// MIME type by file extension — gog doesn't report one, and the client needs it
// to render an inline image or label an embedded resource. Sniffing (below)
// backstops anything not listed here.
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  heic: 'image/heic',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  ics: 'text/calendar',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

// Last path segment of a gog-written attachment path (forward slashes on both
// the local and Fly-backend filesystems), falling back to a generic name.
function attachmentBasename(path: string | undefined): string {
  const base = (path ?? '').replace(/^.*\//, '');
  return base || 'attachment';
}

// Leading magic bytes → MIME type, for the common binary attachments.
const MAGIC_SIGNATURES: ReadonlyArray<readonly [string, string]> = [
  ['%PDF', 'application/pdf'],
  ['\x89PNG', 'image/png'],
  ['\xFF\xD8\xFF', 'image/jpeg'],
  ['GIF8', 'image/gif'],
];

// Sniff a MIME type from the leading bytes of standard base64; returns undefined
// for anything unrecognised. gog emits standard base64, and any 4-aligned prefix
// of a valid base64 string is itself valid, so atob never throws here.
function sniffMime(base64: string): string | undefined {
  const head = atob(base64.slice(0, 16)); // 4-aligned slice; decodes to ~12 bytes
  for (const [signature, mimeType] of MAGIC_SIGNATURES) {
    if (head.startsWith(signature)) return mimeType;
  }
  return undefined;
}

// Best-effort MIME type: filename extension first, then a magic-byte sniff, then
// a generic binary fallback.
function inferMime(filename: string, base64: string): string {
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
  return MIME_BY_EXT[ext] ?? sniffMime(base64) ?? 'application/octet-stream';
}

// Return the attachment bytes as an MCP content block: a native image block for
// images (so clients render them), an embedded resource blob for everything else.
// A leading text block summarises the attachment for the model.
function inlineResult(
  messageId: string,
  filename: string,
  bytes: number | undefined,
  base64: string,
): CallToolResult {
  const mimeType = inferMime(filename, base64);
  const summary = `${filename} — ${bytes ?? '?'} bytes, ${mimeType}, returned inline.`;
  if (mimeType.startsWith('image/')) {
    return { content: [{ type: 'text', text: summary }, { type: 'image', data: base64, mimeType }] };
  }
  return {
    content: [
      { type: 'text', text: summary },
      {
        type: 'resource',
        resource: { uri: `gmail-attachment://${messageId}/${filename}`, mimeType, blob: base64 },
      },
    ],
  };
}

// Upload the file gog wrote (server-side, on the same box that ran the download)
// to Google Drive and return its metadata + shareable link. This is how a large
// attachment — one the connector can't hand back inline — reaches the caller.
async function deliverViaDrive(
  path: string,
  name: string | undefined,
  driveFolder: string | undefined,
  account: string | undefined,
): Promise<CallToolResult> {
  const args = ['drive', 'upload', path, '--json'];
  if (driveFolder) args.push(`--parent=${driveFolder}`);
  if (name) args.push(`--name=${name}`);
  // `gog drive upload --json` wraps the created file under a `file` key.
  const parsed = JSON.parse(await run(args, { account })) as {
    file?: { id?: string; name?: string; mimeType?: string; size?: number | string; webViewLink?: string };
  };
  const file = parsed.file ?? {};
  return textResult({
    deliveredVia: 'drive',
    note: 'Attachment delivered via Google Drive; open or download it at webViewLink.',
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    webViewLink: file.webViewLink,
  });
}

export function registerExtraGmailTools(server: McpServer): void {
  server.registerTool('gog_gmail_raw', {
    description: 'Dump the raw Gmail API response as JSON (lossless; for scripting and LLM consumption).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      messageId: z.string().describe('Gmail message ID'),
      format: z.enum(['full', 'metadata', 'minimal', 'raw']).optional().describe('Gmail format (default: full)'),
      pretty: z.boolean().optional().describe('Pretty-print JSON (default: compact single-line)'),
      account: accountParam,
    },
  }, async ({ messageId, format, pretty, account }) => {
    const args = ['gmail', 'raw', messageId];
    if (format) args.push(`--format=${format}`);
    if (pretty) args.push('--pretty');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_attachment', {
    description:
      'Download a Gmail attachment and deliver its contents. deliver="auto" (default) returns the bytes ' +
      'inline — a native image block for images, an embedded resource blob otherwise — when the attachment ' +
      'is within gog\'s 3 MiB inline limit, and otherwise uploads the file to Google Drive and returns a ' +
      'shareable link (this is how large attachments reach you through the remote connector, whose backend ' +
      'filesystem you can\'t read). deliver="inline" forces inline and errors if the attachment is too large; ' +
      'deliver="drive" always uploads to Drive; deliver="off" just writes the file server-side and returns ' +
      '{path, cached, bytes}. Drive delivery creates a file in your Drive (blocked when GOG_READONLY is set).',
    inputSchema: {
      messageId: z.string().describe('Gmail message ID'),
      attachmentId: z.string().describe('Attachment ID (from the message payload)'),
      deliver: z
        .enum(['auto', 'inline', 'drive', 'off'])
        .optional()
        .describe('How to return the contents: auto (inline if small, else Drive link), inline, drive, or off (server-side download only). Default: auto.'),
      out: z.string().optional().describe('Server-side path where gog writes the file (also the Drive-upload source). Default: gogcli config dir.'),
      name: z.string().optional().describe('Filename override (used by gog when --out is a directory, as the Drive copy name, and to infer the MIME type).'),
      driveFolder: z.string().optional().describe('Destination Google Drive folder ID for the uploaded copy (drive/auto delivery of oversized attachments).'),
      account: accountParam,
    },
  }, async ({ messageId, attachmentId, deliver = 'auto', out, name, driveFolder, account }) => {
    // Legacy passthrough: just download server-side and return gog's JSON.
    if (deliver === 'off') {
      const args = ['gmail', 'attachment', messageId, attachmentId];
      if (out) args.push(`--out=${out}`);
      if (name) args.push(`--name=${name}`);
      return runOrDiagnose(args, { account });
    }
    try {
      const args = ['gmail', 'attachment', messageId, attachmentId];
      if (deliver !== 'drive') args.push('--inline'); // only need base64 when we might inline
      if (out) args.push(`--out=${out}`);
      if (name) args.push(`--name=${name}`);
      const info = JSON.parse(await run(args, { account })) as InlineAttachment;
      const path = info.path ?? '';
      const filename = name ?? attachmentBasename(info.path);
      if (deliver === 'drive') {
        return await deliverViaDrive(path, name, driveFolder, account);
      }
      if (info.contentBase64) {
        return inlineResult(messageId, filename, info.bytes, info.contentBase64);
      }
      if (deliver === 'inline') {
        return errorResult(
          `Attachment is too large to return inline (${info.reason ?? 'exceeds gog\'s 3 MiB inline limit'}). ` +
          'Use deliver="auto" or deliver="drive" to receive it as a Google Drive link.',
        );
      }
      // deliver === 'auto' and over the inline cap → hand back a Drive link.
      return await deliverViaDrive(path, name, driveFolder, account);
    } catch (err) {
      return diagnose(err);
    }
  });

  server.registerTool('gog_gmail_url', {
    description: 'Print Gmail web URLs for one or more threads.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      threadIds: z.array(z.string()).min(1).describe('One or more thread IDs'),
      account: accountParam,
    },
  }, async ({ threadIds, account }) => {
    return runOrDiagnose(['gmail', 'url', ...threadIds], { account });
  });

  server.registerTool('gog_gmail_history', {
    description: 'List Gmail history events since a given historyId (for syncing).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      since: z.string().optional().describe('Start history ID'),
      max: z.number().optional().describe('Max results (default: 100)'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    },
  }, async ({ since, max, page, all, account }) => {
    const args = ['gmail', 'history'];
    if (since) args.push(`--since=${since}`);
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  const bulkActions: Array<{ tool: string; cmd: string; description: string; supportsThread?: boolean }> = [
    {
      tool: 'gog_gmail_archive',
      cmd: 'archive',
      description: 'Archive messages (remove from inbox). Pass either messageIds or a Gmail search query. Set thread=true to treat the ids as THREAD ids and archive every message in each thread (the right mode for ids that came from thread search).',
      supportsThread: true,
    },
    {
      tool: 'gog_gmail_mark_read',
      cmd: 'mark-read',
      description: 'Mark messages as read. Pass either messageIds or a Gmail search query.',
    },
    {
      tool: 'gog_gmail_mark_unread',
      cmd: 'unread',
      description: 'Mark messages as unread. Pass either messageIds or a Gmail search query.',
    },
    {
      tool: 'gog_gmail_trash',
      cmd: 'trash',
      description: 'Move messages to trash. Pass either messageIds or a Gmail search query.',
    },
  ];

  for (const { tool, cmd, description, supportsThread } of bulkActions) {
    const inputSchema: Record<string, z.ZodTypeAny> = {
      messageIds: z.array(z.string()).optional().describe('Specific message IDs to act on'),
      query: z.string().optional().describe('Gmail search query (alternative to messageIds; acts on all matching)'),
      max: z.number().optional().describe('Max messages when using --query (default: 100)'),
      account: accountParam,
    };
    if (supportsThread) {
      inputSchema.thread = z.boolean().optional().describe('Treat messageIds as THREAD ids and act on every message in each thread');
    }
    server.registerTool(tool, {
      description,
      annotations: { destructiveHint: true },
      inputSchema,
    }, async (rawArgs) => {
      const { messageIds, query, max, thread, account } = rawArgs as {
        messageIds?: string[]; query?: string; max?: number; thread?: boolean; account?: string;
      };
      const args = ['gmail', cmd];
      if (messageIds) args.push(...messageIds);
      if (query) args.push(`--query=${query}`);
      if (max !== undefined) args.push(`--max=${max}`);
      if (supportsThread && thread) args.push('--thread');
      return runOrDiagnose(args, { account });
    });
  }

  server.registerTool('gog_gmail_message_modify', {
    description: 'Modify labels on a single message (add and/or remove labels).',
    annotations: { destructiveHint: true },
    inputSchema: {
      messageId: z.string().describe('Gmail message ID'),
      add: z.string().optional().describe('Labels to add (comma-separated, name or ID)'),
      remove: z.string().optional().describe('Labels to remove (comma-separated, name or ID)'),
      account: accountParam,
    },
  }, async ({ messageId, add, remove, account }) => {
    const args = ['gmail', 'messages', 'modify', messageId];
    if (add) args.push(`--add=${add}`);
    if (remove) args.push(`--remove=${remove}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_batch_delete', {
    description: 'Permanently delete multiple messages (requires the broader Gmail scope; not reversible — messages bypass Trash). Requires force:true to delete non-interactively. Use gog_gmail_trash for normal deletes.',
    annotations: { destructiveHint: true },
    inputSchema: {
      messageIds: z.array(z.string()).min(1).describe('Message IDs to permanently delete'),
      force: z.boolean().optional().describe('Required to delete in this non-interactive context — without it the delete is refused as a safety guard.'),
      account: accountParam,
    },
  }, async ({ messageIds, force, account }) => {
    const args = ['gmail', 'batch', 'delete', ...messageIds];
    if (force) args.push('--force');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_batch_modify', {
    description: 'Modify labels on multiple messages in one call (add and/or remove labels).',
    annotations: { destructiveHint: true },
    inputSchema: {
      messageIds: z.array(z.string()).min(1).describe('Message IDs to modify'),
      add: z.string().optional().describe('Labels to add (comma-separated, name or ID)'),
      remove: z.string().optional().describe('Labels to remove (comma-separated, name or ID)'),
      account: accountParam,
    },
  }, async ({ messageIds, add, remove, account }) => {
    const args = ['gmail', 'batch', 'modify', ...messageIds];
    if (add) args.push(`--add=${add}`);
    if (remove) args.push(`--remove=${remove}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_thread_get', {
    description: 'Get a Gmail thread with all messages. For long threads that overflow context, use latestN to fetch only the most recent messages and/or snippetsOnly for a lightweight per-message headers+snippet view; sanitizeContent strips raw payloads/HTML and is the biggest size reducer when you do need bodies. Note each message carries two distinct id concepts: the top-level `id` (the Gmail short hex message id — pass THIS as replyToMessageId to reply) and the `Message-Id` header (the RFC822 `<…@host>` value used in In-Reply-To/References) — don\'t confuse either with the `threadId`. To reply to the thread itself, pass the thread\'s id as replyToThreadId on gog_gmail_drafts_create.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      threadId: z.string().describe('Gmail thread ID'),
      download: z.boolean().optional().describe('Download all attachments'),
      full: z.boolean().optional().describe('Show full message bodies'),
      sanitizeContent: z.boolean().optional().describe('Strip HTML, remove URLs, omit raw payloads from JSON (largest payload-size reduction)'),
      latestN: z.number().int().positive().optional().describe('Return only the most recent N messages in the thread (wrapper-side trim; avoids overflowing context on long threads)'),
      snippetsOnly: z.boolean().optional().describe('Reduce each message to its id, labels, snippet, and key headers (From/To/Cc/Subject/Date), dropping full bodies'),
      outDir: z.string().optional().describe('Directory to write attachments to (default: current directory)'),
      account: accountParam,
    },
  }, async ({ threadId, download, full, sanitizeContent, latestN, snippetsOnly, outDir, account }) => {
    const args = ['gmail', 'thread', 'get', threadId];
    if (download) args.push('--download');
    if (full) args.push('--full');
    if (sanitizeContent) args.push('--sanitize-content');
    if (outDir) args.push(`--out-dir=${outDir}`);
    const result = await runOrDiagnose(args, { account });
    if (latestN === undefined && !snippetsOnly) return result;
    return trimThread(result, latestN, snippetsOnly);
  });

  server.registerTool('gog_gmail_thread_modify', {
    description: 'Modify labels on all messages in a thread (add and/or remove labels).',
    annotations: { destructiveHint: true },
    inputSchema: {
      threadId: z.string().describe('Gmail thread ID'),
      add: z.string().optional().describe('Labels to add (comma-separated, name or ID)'),
      remove: z.string().optional().describe('Labels to remove (comma-separated, name or ID)'),
      account: accountParam,
    },
  }, async ({ threadId, add, remove, account }) => {
    const args = ['gmail', 'thread', 'modify', threadId];
    if (add) args.push(`--add=${add}`);
    if (remove) args.push(`--remove=${remove}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_thread_attachments', {
    description: 'List all attachments in a Gmail thread, optionally downloading them.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      threadId: z.string().describe('Gmail thread ID'),
      download: z.boolean().optional().describe('Download all attachments'),
      outDir: z.string().optional().describe('Directory to write attachments to (default: current directory)'),
      account: accountParam,
    },
  }, async ({ threadId, download, outDir, account }) => {
    const args = ['gmail', 'thread', 'attachments', threadId];
    if (download) args.push('--download');
    if (outDir) args.push(`--out-dir=${outDir}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_labels_list', {
    description: 'List all Gmail labels for the account.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      account: accountParam,
    },
  }, async ({ account }) => {
    return runOrDiagnose(['gmail', 'labels', 'list'], { account });
  });

  server.registerTool('gog_gmail_labels_get', {
    description: 'Get label details, including message and thread counts.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      labelIdOrName: z.string().describe('Label ID or name (e.g. INBOX, STARRED, or a user-created label)'),
      account: accountParam,
    },
  }, async ({ labelIdOrName, account }) => {
    return runOrDiagnose(['gmail', 'labels', 'get', labelIdOrName], { account });
  });

  server.registerTool('gog_gmail_labels_create', {
    description: 'Create a new Gmail label.',
    inputSchema: {
      name: z.string().describe('Label name'),
      account: accountParam,
    },
  }, async ({ name, account }) => {
    return runOrDiagnose(['gmail', 'labels', 'create', name], { account });
  });

  server.registerTool('gog_gmail_labels_rename', {
    description: 'Rename a Gmail label.',
    annotations: { destructiveHint: true },
    inputSchema: {
      labelIdOrName: z.string().describe('Current label ID or name'),
      newName: z.string().describe('New label name'),
      account: accountParam,
    },
  }, async ({ labelIdOrName, newName, account }) => {
    return runOrDiagnose(['gmail', 'labels', 'rename', labelIdOrName, newName], { account });
  });

  server.registerTool('gog_gmail_labels_delete', {
    description: 'Delete a Gmail label.',
    annotations: { destructiveHint: true },
    inputSchema: {
      labelIdOrName: z.string().describe('Label ID or name to delete'),
      account: accountParam,
    },
  }, async ({ labelIdOrName, account }) => {
    return runOrDiagnose(['gmail', 'labels', 'delete', labelIdOrName, '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  server.registerTool('gog_gmail_labels_modify', {
    description: 'Modify labels on one or more threads (add and/or remove labels).',
    annotations: { destructiveHint: true },
    inputSchema: {
      threadIds: z.array(z.string()).min(1).describe('One or more thread IDs'),
      add: z.string().optional().describe('Labels to add (comma-separated, name or ID)'),
      remove: z.string().optional().describe('Labels to remove (comma-separated, name or ID)'),
      account: accountParam,
    },
  }, async ({ threadIds, add, remove, account }) => {
    const args = ['gmail', 'labels', 'modify', ...threadIds];
    if (add) args.push(`--add=${add}`);
    if (remove) args.push(`--remove=${remove}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_drafts_list', {
    description: 'List Gmail drafts.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      max: z.number().optional().describe('Max results (default: 20)'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      account: accountParam,
    },
  }, async ({ max, page, all, account }) => {
    const args = ['gmail', 'drafts', 'list'];
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_drafts_get', {
    description: 'Get a Gmail draft by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      draftId: z.string().describe('Draft ID'),
      download: z.boolean().optional().describe('Download draft attachments'),
      account: accountParam,
    },
  }, async ({ draftId, download, account }) => {
    const args = ['gmail', 'drafts', 'get', draftId];
    if (download) args.push('--download');
    return runOrDiagnose(args, { account });
  });

  const draftWriteSchema = {
    to: z.string().optional().describe('Recipients (comma-separated)'),
    cc: z.string().optional().describe('CC recipients (comma-separated)'),
    bcc: z.string().optional().describe('BCC recipients (comma-separated)'),
    subject: z.string().describe('Subject'),
    body: z.string().describe('Body (plain text). Any size — a large body is written to a temp file on the gog server rather than inlined into the command line. Note gog strips trailing newlines from a file-delivered body.'),
    bodyHtml: z.string().optional().describe('Body (HTML; optional). Pass the HTML itself at any size — a large body is written to a temp file on the gog server rather than inlined into the command line. Mutually exclusive with bodyHtmlFile.'),
    bodyHtmlFile: z.string().optional().describe('Path to an HTML file that ALREADY EXISTS on the gog server to use as the HTML body, or "-" to read from stdin. Mutually exclusive with bodyHtml — supplying both is rejected. You rarely need this: bodyHtml handles large bodies on its own.'),
    replyToMessageId: z.string().optional().describe('Reply to a specific Gmail MESSAGE id — the short hex `id` field from gog_gmail_get / _search / _thread_get (e.g. 19e7593d77fd9636), NOT a thread id and NOT the RFC822 `<…@host>` Message-Id header. Anchors In-Reply-To/References to that exact message. To reply to a thread when you don\'t know the latest message, use replyToThreadId instead. If both are given, replyToMessageId wins.'),
    replyToThreadId: z.string().optional().describe('Reply to a Gmail THREAD id — passed to gog as --thread-id, which threads the draft using the thread\'s latest-message headers (In-Reply-To/References). This is what "reply to this thread" almost always means. Mutually exclusive with replyToMessageId (which wins if both are set). Thread ids and message ids are both 16-hex strings and easy to confuse — use this param, not replyToMessageId, when the id came from a thread.'),
    replyTo: z.string().optional().describe('Reply-To header address'),
    quote: z.boolean().optional().describe('Include quoted original message in reply (requires replyToMessageId or replyToThreadId)'),
    replyAll: z.boolean().optional().describe('Auto-populate recipients from the original message (reply-all), inferring To/Cc from it. Requires replyToMessageId or replyToThreadId. Explicit to/cc/bcc still apply on top; omitRecipients still suppresses them.'),
    attach: z.array(z.string()).optional().describe('Local file paths to attach (repeatable). Read on the gog server, base64-encoded with a MIME type inferred from the extension. The JSON result echoes attached filenames and byte sizes — check it to confirm the files were found and embedded. On gog_gmail_drafts_update, supplying attach REPLACES the draft\'s existing attachments; omitting it preserves them (use clearAttachments to remove all).'),
    from: z.string().optional().describe('Send from this email address (must be a verified send-as alias)'),
    omitRecipients: z.boolean().optional().describe('Create the draft with no recipients even if to/cc/bcc are supplied — an accidental-send guard. Populate recipients in a later update before sending.'),
    returnFull: z.boolean().optional().describe('After writing, re-fetch and return the full stored draft (subject, body, recipients) instead of just the write acknowledgement. Costs one extra read.'),
    account: accountParam,
  };

  type DraftFlags = {
    to?: string;
    cc?: string;
    bcc?: string;
    subject: string;
    body: string;
    bodyHtml?: string;
    bodyHtmlFile?: string;
    replyToMessageId?: string;
    replyToThreadId?: string;
    replyTo?: string;
    quote?: boolean;
    replyAll?: boolean;
    attach?: string[];
    from?: string;
    omitRecipients?: boolean;
  };

  function appendDraftFlags(args: GogArg[], f: DraftFlags): void {
    assertNotBoth('bodyHtml', 'bodyHtmlFile', f.bodyHtml, f.bodyHtmlFile);
    if (!f.omitRecipients) {
      if (f.to) args.push(`--to=${f.to}`);
      if (f.cc) args.push(`--cc=${f.cc}`);
      if (f.bcc) args.push(`--bcc=${f.bcc}`);
    }
    args.push(`--subject=${f.subject}`);
    // body is required, so this is an either/or swap rather than an extra push:
    // --body and --body-file together are a hard error in gog.
    args.push(payloadArg('body', 'body-file', f.body));
    if (f.bodyHtml) args.push(payloadArg('body-html', 'body-html-file', f.bodyHtml, 'html'));
    else if (f.bodyHtmlFile) args.push(`--body-html-file=${f.bodyHtmlFile}`);
    // A draft can reply to a specific message (--reply-to-message-id) or thread
    // off the latest message in a thread (--thread-id, which gog resolves
    // server-side). replyToMessageId wins when both are supplied.
    if (f.replyToMessageId) args.push(`--reply-to-message-id=${f.replyToMessageId}`);
    else if (f.replyToThreadId) args.push(`--thread-id=${f.replyToThreadId}`);
    // --reply-all infers original recipients; gog requires a reply target above.
    if (f.replyAll) args.push('--reply-all');
    if (f.replyTo) args.push(`--reply-to=${f.replyTo}`);
    if (f.quote) args.push('--quote');
    if (f.attach) for (const path of f.attach) args.push(`--attach=${path}`);
    if (f.from) args.push(`--from=${f.from}`);
  }

  // Run a draft write, then — when returnFull is set — re-fetch the stored
  // draft so the caller can verify subject/body/recipients persisted without a
  // separate gog_gmail_drafts_get round trip. For updates the id is known up
  // front; for creates it's read from the write response's draftId. Degrades to
  // the raw write result if the id can't be determined.
  async function writeDraft(
    args: GogArg[],
    account: string | undefined,
    returnFull: boolean | undefined,
    knownDraftId?: string,
  ): Promise<CallToolResult> {
    const result = await runOrDiagnose(args, { account });
    if (!returnFull) return result;
    // The write must have returned a JSON acknowledgement before we re-fetch.
    // A failed write (an error result, not JSON) is surfaced as-is rather
    // than masked by re-fetching the unchanged draft — this matters for the
    // update path, where a known draftId would otherwise re-fetch a stale draft.
    let parsed: { draftId?: string };
    try {
      parsed = JSON.parse(resultText(result) ?? '') as { draftId?: string };
    } catch {
      return result;
    }
    const draftId = knownDraftId ?? parsed.draftId;
    if (!draftId) return result;
    return runOrDiagnose(['gmail', 'drafts', 'get', draftId], { account });
  }

  server.registerTool('gog_gmail_drafts_create', {
    description: 'Create a new Gmail draft. Recipients (to/cc/bcc) are optional; omit them (or set omitRecipients) to create a recipient-less draft as an accidental-send guard. For replies, prefer replyToThreadId (anchors to the thread\'s latest message) or replyToMessageId (a specific message) — don\'t pass a thread id into replyToMessageId, which mis-threads silently.',
    inputSchema: draftWriteSchema,
  }, async ({ account, returnFull, ...flags }) => {
    const args: GogArg[] = ['gmail', 'drafts', 'create'];
    appendDraftFlags(args, flags);
    return writeDraft(args, account, returnFull);
  });

  server.registerTool('gog_gmail_drafts_update', {
    description: 'Update an existing Gmail draft. For replies, prefer replyToThreadId (threads off the thread\'s latest message) or replyToMessageId (a specific message) over passing a thread id into replyToMessageId. Attachment semantics: supplying attach REPLACES the draft\'s existing attachments; omitting it preserves them; set clearAttachments to remove all.',
    annotations: { destructiveHint: true },
    inputSchema: {
      draftId: z.string().describe('Draft ID'),
      ...draftWriteSchema,
      clearAttachments: z.boolean().optional().describe('Remove all attachments from the draft. By default, omitting attach preserves the draft\'s existing attachments; this intentionally clears them. Ignored if attach is also supplied (attach replaces).'),
    },
  }, async ({ draftId, account, returnFull, clearAttachments, ...flags }) => {
    const args: GogArg[] = ['gmail', 'drafts', 'update', draftId];
    appendDraftFlags(args, flags);
    if (clearAttachments) args.push('--clear-attachments');
    return writeDraft(args, account, returnFull, draftId);
  });

  server.registerTool('gog_gmail_drafts_delete', {
    description: 'Permanently delete a Gmail draft (not reversible — drafts do not go to Trash). Requires force:true to delete non-interactively.',
    annotations: { destructiveHint: true },
    inputSchema: {
      draftId: z.string().describe('Draft ID'),
      force: z.boolean().optional().describe('Required to delete in this non-interactive context — without it the delete is refused as a safety guard.'),
      account: accountParam,
    },
  }, async ({ draftId, account, force }) => {
    const args = ['gmail', 'drafts', 'delete', draftId];
    if (force) args.push('--force');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_drafts_send', {
    description: 'Send an existing Gmail draft.',
    annotations: { destructiveHint: true },
    inputSchema: {
      draftId: z.string().describe('Draft ID to send'),
      account: accountParam,
    },
  }, async ({ draftId, account }) => {
    return runOrDiagnose(['gmail', 'drafts', 'send', draftId], { account });
  });

  server.registerTool('gog_gmail_forward', {
    description: 'Forward an existing Gmail message to new recipients.',
    annotations: { destructiveHint: true },
    inputSchema: {
      messageId: z.string().describe('Gmail message ID to forward'),
      to: z.string().describe('Recipients (comma-separated; required)'),
      cc: z.string().optional().describe('CC recipients (comma-separated)'),
      bcc: z.string().optional().describe('BCC recipients (comma-separated)'),
      note: z.string().optional().describe('Introductory text above the forwarded message'),
      from: z.string().optional().describe('Send from this email address (must be a verified send-as alias)'),
      skipAttachments: z.boolean().optional().describe('Do not include original attachments'),
      account: accountParam,
    },
  }, async ({ messageId, to, cc, bcc, note, from, skipAttachments, account }) => {
    const args: GogArg[] = ['gmail', 'forward', messageId, `--to=${to}`];
    if (cc) args.push(`--cc=${cc}`);
    if (bcc) args.push(`--bcc=${bcc}`);
    if (note) args.push(payloadArg('note', 'note-file', note));
    if (from) args.push(`--from=${from}`);
    if (skipAttachments) args.push('--skip-attachments');
    return runOrDiagnose(args, { account });
  });

  // gmail reply / reply-all share an identical flag set (gog 0.27+); they differ
  // only in the subcommand and default recipient set (reply → sender; reply-all
  // → every participant). Recipient flags are repeatable on the CLI, so they are
  // arrays here. --to/--cc/--bcc ADD or MOVE recipients onto the inherited reply
  // set; --remove drops them. Body/HTML follow the same inline-or-file shape as
  // the draft tools.
  const replySchema = {
    messageId: z.string().describe('Gmail message ID to reply to — the short hex `id` from gog_gmail_get / _search / _messages_search (NOT the threadId, NOT the RFC822 `<…@host>` Message-Id header).'),
    body: z.string().optional().describe('Reply body (plain text; required unless bodyHtml or bodyHtmlFile is set). Any size — a large body is written to a temp file on the gog server rather than inlined into the command line. Note gog strips trailing newlines from a file-delivered body.'),
    bodyHtml: z.string().optional().describe('Reply body (HTML; optional). Pass the HTML itself at any size — a large body is written to a temp file on the gog server rather than inlined into the command line. Mutually exclusive with bodyHtmlFile.'),
    bodyHtmlFile: z.string().optional().describe('Path to an HTML file that ALREADY EXISTS on the gog server for the reply body, or "-" for stdin. Mutually exclusive with bodyHtml — supplying both is rejected. You rarely need this: bodyHtml handles large bodies on its own.'),
    to: z.array(z.string()).optional().describe('Add or move recipients to To (repeatable). Added on top of the recipients inherited from the original message.'),
    cc: z.array(z.string()).optional().describe('Add or move recipients to Cc (repeatable)'),
    bcc: z.array(z.string()).optional().describe('Add or move recipients to Bcc (repeatable)'),
    remove: z.array(z.string()).optional().describe('Remove these recipients from all fields (repeatable) — e.g. to drop someone from a reply-all.'),
    subject: z.string().optional().describe('Override reply subject (default: "Re: <original>"). A changed subject starts a NEW Gmail thread.'),
    noQuote: z.boolean().optional().describe('Do not include the original message quoted below the reply (default: the original is quoted)'),
    attach: z.array(z.string()).optional().describe('Local file paths to attach (repeatable). Read on the gog server, base64-encoded with a MIME type inferred from the extension.'),
    from: z.string().optional().describe('Send from this email address (must be a verified send-as alias)'),
    signature: z.boolean().optional().describe('Append the Gmail signature from the active send-as address'),
    signatureFrom: z.string().optional().describe('Append the Gmail signature from this send-as email address'),
    signatureFile: z.string().optional().describe('Append a local signature file (plain text or HTML), read on the gog server'),
    account: accountParam,
  };

  type ReplyFlags = {
    body?: string;
    bodyHtml?: string;
    bodyHtmlFile?: string;
    to?: string[];
    cc?: string[];
    bcc?: string[];
    remove?: string[];
    subject?: string;
    noQuote?: boolean;
    attach?: string[];
    from?: string;
    signature?: boolean;
    signatureFrom?: string;
    signatureFile?: string;
  };

  function appendReplyFlags(args: GogArg[], f: ReplyFlags): void {
    assertNotBoth('bodyHtml', 'bodyHtmlFile', f.bodyHtml, f.bodyHtmlFile);
    if (f.body) args.push(payloadArg('body', 'body-file', f.body));
    if (f.bodyHtml) args.push(payloadArg('body-html', 'body-html-file', f.bodyHtml, 'html'));
    else if (f.bodyHtmlFile) args.push(`--body-html-file=${f.bodyHtmlFile}`);
    if (f.to) for (const r of f.to) args.push(`--to=${r}`);
    if (f.cc) for (const r of f.cc) args.push(`--cc=${r}`);
    if (f.bcc) for (const r of f.bcc) args.push(`--bcc=${r}`);
    if (f.remove) for (const r of f.remove) args.push(`--remove=${r}`);
    if (f.subject) args.push(`--subject=${f.subject}`);
    if (f.noQuote) args.push('--no-quote');
    if (f.attach) for (const p of f.attach) args.push(`--attach=${p}`);
    if (f.from) args.push(`--from=${f.from}`);
    if (f.signature) args.push('--signature');
    if (f.signatureFrom) args.push(`--signature-from=${f.signatureFrom}`);
    if (f.signatureFile) args.push(`--signature-file=${f.signatureFile}`);
  }

  server.registerTool('gog_gmail_reply', {
    description: 'Reply to a Gmail message (sends to the original sender only). Threads off the message and inherits a "Re:" subject and the quoted original by default. For replying to every participant use gog_gmail_reply_all; to reply across many messages matching a query use gog_gmail_autoreply; to stage a reply without sending use gog_gmail_drafts_create.',
    annotations: { destructiveHint: true },
    inputSchema: replySchema,
  }, async ({ messageId, account, ...flags }) => {
    const args: GogArg[] = ['gmail', 'reply', messageId];
    appendReplyFlags(args, flags);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_reply_all', {
    description: 'Reply to all participants of a Gmail message (sender plus every To/Cc recipient). Same inherited "Re:" subject and quoting as gog_gmail_reply. Use the remove flag to drop specific recipients from the reply-all.',
    annotations: { destructiveHint: true },
    inputSchema: replySchema,
  }, async ({ messageId, account, ...flags }) => {
    const args: GogArg[] = ['gmail', 'reply-all', messageId];
    appendReplyFlags(args, flags);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_autoreply', {
    description: 'Reply once to all messages matching a Gmail search query. Use the label flag to dedupe across runs.',
    annotations: { destructiveHint: true },
    inputSchema: {
      query: z.string().describe('Gmail search query'),
      max: z.number().optional().describe('Max matching messages to inspect (default: 20)'),
      subject: z.string().optional().describe('Override reply subject (default: Re: original subject)'),
      body: z.string().optional().describe('Reply body (plain text; required unless bodyHtml is set)'),
      bodyHtml: z.string().optional().describe('Reply body HTML'),
      from: z.string().optional().describe('Send from this email address (must be a verified send-as alias)'),
      replyTo: z.string().optional().describe('Reply-To header address'),
      label: z.string().optional().describe('Label to add after replying (used for dedupe; default: AutoReplied)'),
      archive: z.boolean().optional().describe('Archive threads after auto-replying'),
      markRead: z.boolean().optional().describe('Mark threads as read after auto-replying'),
      skipBulk: z.boolean().optional().describe('Skip auto-generated/list mail'),
      allowSelf: z.boolean().optional().describe('Allow replying to messages sent by your own address'),
      account: accountParam,
    },
  }, async ({ query, max, subject, body, bodyHtml, from, replyTo, label, archive, markRead, skipBulk, allowSelf, account }) => {
    const args: GogArg[] = ['gmail', 'autoreply', query];
    if (max !== undefined) args.push(`--max=${max}`);
    if (subject) args.push(`--subject=${subject}`);
    if (body) args.push(payloadArg('body', 'body-file', body));
    // `gmail autoreply` has --body-file but NO --body-html-file (verified against
    // gog 0.34.1), so an HTML autoreply body stays inline and is still bounded by
    // the runner's per-arg cap. Route it through payloadArg if gog ever adds one.
    if (bodyHtml) args.push(`--body-html=${bodyHtml}`);
    if (from) args.push(`--from=${from}`);
    if (replyTo) args.push(`--reply-to=${replyTo}`);
    if (label) args.push(`--label=${label}`);
    if (archive) args.push('--archive');
    if (markRead) args.push('--mark-read');
    if (skipBulk) args.push('--skip-bulk');
    if (allowSelf) args.push('--allow-self');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_messages_search', {
    description: 'Search individual messages (not threads) using Gmail query syntax. Returns one result per matching message.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe('Gmail search query (e.g. "from:alice is:unread has:attachment")'),
      max: z.number().optional().describe('Max results'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      includeBody: z.boolean().optional().describe('Include the decoded message body in each result'),
      full: z.boolean().optional().describe('Show full message bodies without truncation (implies includeBody)'),
      bodyFormat: z.enum(['text', 'html']).optional().describe('Body format preference when includeBody is set'),
      account: accountParam,
    },
  }, async ({ query, max, page, all, includeBody, full, bodyFormat, account }) => {
    const args = ['gmail', 'messages', 'search', query];
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    if (includeBody) args.push('--include-body');
    if (full) args.push('--full');
    if (bodyFormat) args.push(`--body-format=${bodyFormat}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_labels_style', {
    description: "Change a user label's color or visibility (background/text color from Gmail's palette, label-list and message-list visibility).",
    annotations: { destructiveHint: true },
    inputSchema: {
      labelIdOrName: z.string().describe('Label ID or name to restyle'),
      backgroundColor: z.string().optional().describe("Background color from Gmail's label palette as #RRGGBB"),
      textColor: z.string().optional().describe("Text color from Gmail's label palette as #RRGGBB"),
      labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).optional().describe('Label-list visibility'),
      messageListVisibility: z.enum(['show', 'hide']).optional().describe('Message-list visibility'),
      account: accountParam,
    },
  }, async ({ labelIdOrName, backgroundColor, textColor, labelListVisibility, messageListVisibility, account }) => {
    const args = ['gmail', 'labels', 'style', labelIdOrName];
    if (backgroundColor) args.push(`--background-color=${backgroundColor}`);
    if (textColor) args.push(`--text-color=${textColor}`);
    if (labelListVisibility) args.push(`--label-list-visibility=${labelListVisibility}`);
    if (messageListVisibility) args.push(`--message-list-visibility=${messageListVisibility}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_vacation_get', {
    description: 'Get the current vacation responder (auto-reply) settings.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      account: accountParam,
    },
  }, async ({ account }) => {
    return runOrDiagnose(['gmail', 'settings', 'vacation', 'get'], { account });
  });

  server.registerTool('gog_gmail_vacation_update', {
    description: 'Update the vacation responder. Pass enable (with subject/body) to turn it on, or disable to turn it off; optional start/end RFC3339 times and contactsOnly/domainOnly scoping.',
    inputSchema: {
      enable: z.boolean().optional().describe('Enable the vacation responder'),
      disable: z.boolean().optional().describe('Disable the vacation responder'),
      subject: z.string().optional().describe('Subject line for the auto-reply'),
      body: z.string().optional().describe('HTML body of the auto-reply message'),
      start: z.string().optional().describe('Start time in RFC3339 format (e.g. 2024-12-20T00:00:00Z)'),
      end: z.string().optional().describe('End time in RFC3339 format (e.g. 2024-12-31T23:59:59Z)'),
      contactsOnly: z.boolean().optional().describe('Only respond to contacts'),
      domainOnly: z.boolean().optional().describe('Only respond to senders in the same domain'),
      account: accountParam,
    },
  }, async ({ enable, disable, subject, body, start, end, contactsOnly, domainOnly, account }) => {
    const args = ['gmail', 'settings', 'vacation', 'update'];
    if (enable) args.push('--enable');
    if (disable) args.push('--disable');
    if (subject) args.push(`--subject=${subject}`);
    // `gmail settings vacation update` exposes only --body — there is no
    // --body-file variant (verified against gog 0.34.1), so this stays inline.
    if (body) args.push(`--body=${body}`);
    if (start) args.push(`--start=${start}`);
    if (end) args.push(`--end=${end}`);
    if (contactsOnly) args.push('--contacts-only');
    if (domainOnly) args.push('--domain-only');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_filters_list', {
    description: 'List all Gmail filters for the account.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      account: accountParam,
    },
  }, async ({ account }) => {
    return runOrDiagnose(['gmail', 'settings', 'filters', 'list'], { account });
  });

  server.registerTool('gog_gmail_filters_get', {
    description: 'Get the criteria and actions of a single Gmail filter by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      filterId: z.string().describe('Filter ID'),
      account: accountParam,
    },
  }, async ({ filterId, account }) => {
    return runOrDiagnose(['gmail', 'settings', 'filters', 'get', filterId], { account });
  });

  server.registerTool('gog_gmail_filters_create', {
    description: 'Create a Gmail filter. Specify match criteria (from/to/subject/query/hasAttachment) and one or more actions (label, archive, mark-read, star, important, trash, forward, never-spam).',
    inputSchema: {
      from: z.string().optional().describe('Match messages from this sender'),
      to: z.string().optional().describe('Match messages to this recipient'),
      subject: z.string().optional().describe('Match messages with this subject'),
      query: z.string().optional().describe('Advanced Gmail search query for matching'),
      hasAttachment: z.boolean().optional().describe('Match messages with attachments'),
      addLabel: z.string().optional().describe('Label(s) to add to matching messages (comma-separated, name or ID)'),
      removeLabel: z.string().optional().describe('Label(s) to remove from matching messages (comma-separated, name or ID)'),
      archive: z.boolean().optional().describe('Archive matching messages (skip inbox)'),
      markRead: z.boolean().optional().describe('Mark matching messages as read'),
      star: z.boolean().optional().describe('Star matching messages'),
      important: z.boolean().optional().describe('Mark as important'),
      trash: z.boolean().optional().describe('Move matching messages to trash'),
      neverSpam: z.boolean().optional().describe('Never mark as spam'),
      forward: z.string().optional().describe('Forward to this email address (must be a verified forwarding address)'),
      account: accountParam,
    },
  }, async ({ from, to, subject, query, hasAttachment, addLabel, removeLabel, archive, markRead, star, important, trash, neverSpam, forward, account }) => {
    const args = ['gmail', 'settings', 'filters', 'create'];
    if (from) args.push(`--from=${from}`);
    if (to) args.push(`--to=${to}`);
    if (subject) args.push(`--subject=${subject}`);
    if (query) args.push(`--query=${query}`);
    if (hasAttachment) args.push('--has-attachment');
    if (addLabel) args.push(`--add-label=${addLabel}`);
    if (removeLabel) args.push(`--remove-label=${removeLabel}`);
    if (archive) args.push('--archive');
    if (markRead) args.push('--mark-read');
    if (star) args.push('--star');
    if (important) args.push('--important');
    if (trash) args.push('--trash');
    if (neverSpam) args.push('--never-spam');
    if (forward) args.push(`--forward=${forward}`, '--force'); // gog gates this op; without --force the runner's --no-input makes it refuse (forwarding filters only)
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_filters_delete', {
    description: 'Delete a Gmail filter by ID.',
    annotations: { destructiveHint: true },
    inputSchema: {
      filterId: z.string().describe('Filter ID to delete'),
      account: accountParam,
    },
  }, async ({ filterId, account }) => {
    return runOrDiagnose(['gmail', 'settings', 'filters', 'delete', filterId, '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  server.registerTool('gog_gmail_sendas_list', {
    description: 'List all send-as aliases configured for the account.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      account: accountParam,
    },
  }, async ({ account }) => {
    return runOrDiagnose(['gmail', 'settings', 'sendas', 'list'], { account });
  });

  server.registerTool('gog_gmail_sendas_get', {
    description: 'Get details of a single send-as alias by its email address.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      email: z.string().describe('Send-as alias email address'),
      account: accountParam,
    },
  }, async ({ email, account }) => {
    return runOrDiagnose(['gmail', 'settings', 'sendas', 'get', email], { account });
  });

  server.registerTool('gog_gmail_sendas_create', {
    description: 'Create a send-as alias. Newly added aliases generally require email verification before they can be used (see gog_gmail_sendas_verify).',
    inputSchema: {
      email: z.string().describe('Email address of the new send-as alias'),
      displayName: z.string().optional().describe('Name that appears in the From field'),
      replyTo: z.string().optional().describe('Reply-to address'),
      signature: z.string().optional().describe('HTML signature for emails sent from this alias'),
      treatAsAlias: z.boolean().optional().describe('Treat as alias (replies sent from Gmail web)'),
      account: accountParam,
    },
  }, async ({ email, displayName, replyTo, signature, treatAsAlias, account }) => {
    const args = ['gmail', 'settings', 'sendas', 'create', email];
    if (displayName) args.push(`--display-name=${displayName}`);
    if (replyTo) args.push(`--reply-to=${replyTo}`);
    if (signature) args.push(`--signature=${signature}`);
    if (treatAsAlias) args.push('--treat-as-alias');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_sendas_update', {
    description: 'Update a send-as alias (display name, reply-to, signature, alias handling, or make it the default).',
    annotations: { destructiveHint: true },
    inputSchema: {
      email: z.string().describe('Send-as alias email address to update'),
      displayName: z.string().optional().describe('Name that appears in the From field'),
      replyTo: z.string().optional().describe('Reply-to address'),
      signature: z.string().optional().describe('HTML signature'),
      treatAsAlias: z.boolean().optional().describe('Treat as alias'),
      makeDefault: z.boolean().optional().describe('Make this the default send-as address'),
      account: accountParam,
    },
  }, async ({ email, displayName, replyTo, signature, treatAsAlias, makeDefault, account }) => {
    const args = ['gmail', 'settings', 'sendas', 'update', email];
    if (displayName) args.push(`--display-name=${displayName}`);
    if (replyTo) args.push(`--reply-to=${replyTo}`);
    if (signature) args.push(`--signature=${signature}`);
    if (treatAsAlias) args.push('--treat-as-alias');
    if (makeDefault) args.push('--make-default');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_sendas_delete', {
    description: 'Delete a send-as alias by its email address.',
    annotations: { destructiveHint: true },
    inputSchema: {
      email: z.string().describe('Send-as alias email address to delete'),
      account: accountParam,
    },
  }, async ({ email, account }) => {
    return runOrDiagnose(['gmail', 'settings', 'sendas', 'delete', email, '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  server.registerTool('gog_gmail_sendas_verify', {
    description: 'Resend the verification email for a send-as alias that is pending verification.',
    inputSchema: {
      email: z.string().describe('Send-as alias email address to verify'),
      account: accountParam,
    },
  }, async ({ email, account }) => {
    return runOrDiagnose(['gmail', 'settings', 'sendas', 'verify', email], { account });
  });
}
