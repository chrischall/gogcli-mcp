import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose, toText, type ToolResult } from '../../../gogcli-mcp/src/lib.js';

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
  result: ToolResult,
  latestN: number | undefined,
  snippetsOnly: boolean | undefined,
): ToolResult {
  try {
    const parsed = JSON.parse(result.content[0].text) as { thread?: { messages?: unknown[] } };
    const messages = parsed.thread?.messages;
    if (!Array.isArray(messages)) return result;
    let trimmed: unknown[] = messages;
    if (latestN !== undefined) trimmed = trimmed.slice(-latestN);
    if (snippetsOnly) trimmed = trimmed.map((m) => summarizeMessage(m as GmailMessage));
    return toText(JSON.stringify({ ...parsed, thread: { ...parsed.thread, messages: trimmed } }));
  } catch {
    return result;
  }
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
    description: 'Download a single attachment from a Gmail message.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      messageId: z.string().describe('Gmail message ID'),
      attachmentId: z.string().describe('Attachment ID (from the message payload)'),
      out: z.string().optional().describe('Output file path (default: gogcli config dir)'),
      name: z.string().optional().describe('Filename (used when --out is empty or points to a directory)'),
      account: accountParam,
    },
  }, async ({ messageId, attachmentId, out, name, account }) => {
    const args = ['gmail', 'attachment', messageId, attachmentId];
    if (out) args.push(`--out=${out}`);
    if (name) args.push(`--name=${name}`);
    return runOrDiagnose(args, { account });
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

  const bulkActions: Array<{ tool: string; cmd: string; description: string }> = [
    {
      tool: 'gog_gmail_archive',
      cmd: 'archive',
      description: 'Archive messages (remove from inbox). Pass either messageIds or a Gmail search query.',
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

  for (const { tool, cmd, description } of bulkActions) {
    server.registerTool(tool, {
      description,
      annotations: { destructiveHint: true },
      inputSchema: {
        messageIds: z.array(z.string()).optional().describe('Specific message IDs to act on'),
        query: z.string().optional().describe('Gmail search query (alternative to messageIds; acts on all matching)'),
        max: z.number().optional().describe('Max messages when using --query (default: 100)'),
        account: accountParam,
      },
    }, async ({ messageIds, query, max, account }) => {
      const args = ['gmail', cmd];
      if (messageIds) args.push(...messageIds);
      if (query) args.push(`--query=${query}`);
      if (max !== undefined) args.push(`--max=${max}`);
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
    description: 'Permanently delete multiple messages (requires the broader Gmail scope). Use gog_gmail_trash for normal deletes.',
    annotations: { destructiveHint: true },
    inputSchema: {
      messageIds: z.array(z.string()).min(1).describe('Message IDs to permanently delete'),
      account: accountParam,
    },
  }, async ({ messageIds, account }) => {
    return runOrDiagnose(['gmail', 'batch', 'delete', ...messageIds], { account });
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
    return runOrDiagnose(['gmail', 'labels', 'delete', labelIdOrName], { account });
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
    body: z.string().describe('Body (plain text)'),
    bodyHtml: z.string().optional().describe('Body (HTML; optional)'),
    replyToMessageId: z.string().optional().describe('Reply to a specific Gmail MESSAGE id — the short hex `id` field from gog_gmail_get / _search / _thread_get (e.g. 19e7593d77fd9636), NOT a thread id and NOT the RFC822 `<…@host>` Message-Id header. Anchors In-Reply-To/References to that exact message. To reply to a thread when you don\'t know the latest message, use replyToThreadId instead. If both are given, replyToMessageId wins.'),
    replyToThreadId: z.string().optional().describe('Reply to a Gmail THREAD id — passed to gog as --thread-id, which threads the draft using the thread\'s latest-message headers (In-Reply-To/References). This is what "reply to this thread" almost always means. Mutually exclusive with replyToMessageId (which wins if both are set). Thread ids and message ids are both 16-hex strings and easy to confuse — use this param, not replyToMessageId, when the id came from a thread.'),
    replyTo: z.string().optional().describe('Reply-To header address'),
    quote: z.boolean().optional().describe('Include quoted original message in reply (requires replyToMessageId or replyToThreadId)'),
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
    replyToMessageId?: string;
    replyToThreadId?: string;
    replyTo?: string;
    quote?: boolean;
    attach?: string[];
    from?: string;
    omitRecipients?: boolean;
  };

  function appendDraftFlags(args: string[], f: DraftFlags): void {
    if (!f.omitRecipients) {
      if (f.to) args.push(`--to=${f.to}`);
      if (f.cc) args.push(`--cc=${f.cc}`);
      if (f.bcc) args.push(`--bcc=${f.bcc}`);
    }
    args.push(`--subject=${f.subject}`);
    args.push(`--body=${f.body}`);
    if (f.bodyHtml) args.push(`--body-html=${f.bodyHtml}`);
    // A draft can reply to a specific message (--reply-to-message-id) or thread
    // off the latest message in a thread (--thread-id, which gog resolves
    // server-side). replyToMessageId wins when both are supplied.
    if (f.replyToMessageId) args.push(`--reply-to-message-id=${f.replyToMessageId}`);
    else if (f.replyToThreadId) args.push(`--thread-id=${f.replyToThreadId}`);
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
    args: string[],
    account: string | undefined,
    returnFull: boolean | undefined,
    knownDraftId?: string,
  ): Promise<ToolResult> {
    const result = await runOrDiagnose(args, { account });
    if (!returnFull) return result;
    // The write must have returned a JSON acknowledgement before we re-fetch.
    // A failed write (an error ToolResult, not JSON) is surfaced as-is rather
    // than masked by re-fetching the unchanged draft — this matters for the
    // update path, where a known draftId would otherwise re-fetch a stale draft.
    let parsed: { draftId?: string };
    try {
      parsed = JSON.parse(result.content[0].text) as { draftId?: string };
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
    const args = ['gmail', 'drafts', 'create'];
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
    const args = ['gmail', 'drafts', 'update', draftId];
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
    const args = ['gmail', 'forward', messageId, `--to=${to}`];
    if (cc) args.push(`--cc=${cc}`);
    if (bcc) args.push(`--bcc=${bcc}`);
    if (note) args.push(`--note=${note}`);
    if (from) args.push(`--from=${from}`);
    if (skipAttachments) args.push('--skip-attachments');
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
    const args = ['gmail', 'autoreply', query];
    if (max !== undefined) args.push(`--max=${max}`);
    if (subject) args.push(`--subject=${subject}`);
    if (body) args.push(`--body=${body}`);
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
    if (forward) args.push(`--forward=${forward}`);
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
    return runOrDiagnose(['gmail', 'settings', 'filters', 'delete', filterId], { account });
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
    return runOrDiagnose(['gmail', 'settings', 'sendas', 'delete', email], { account });
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
