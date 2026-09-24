import { McpServer, type ServerContext } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { accountParam, runOrDiagnose, registerRunTool, payloadArg, pageTokenParam, pageAliasParam, resolvePageToken, assertNotBoth } from './utils.js';
import { finalizeGmailSearch, fetchGmailPages } from '../gmail-results.js';
import type { GogArg } from '../runner.js';
import { attachInlineParam, inlineAttachmentArgs } from '../attachments.js';
import type { InlineAttachmentInput } from '../attachments.js';
import { attachmentDetails, attachmentNames, attachmentPreview, bodyPreview, CONFIRM_FALLBACK_DESCRIPTION, confirmTokenParam, extractEmails, logGmailDispatch, replyDispatchOp, requireGmailDispatchConfirmation, resultText, senderPreview } from '../gmail-dispatch-guard.js';
import { pos } from '../argv.js';
import { confinePath, confinePaths } from '../file-roots.js';

// gmail reply / reply-all share an identical flag set (gog 0.27+); they differ
// only in the subcommand and default recipient set (reply → sender; reply-all
// → every participant). Recipient flags are repeatable on the CLI, so they are
// arrays here. --to/--cc/--bcc ADD or MOVE recipients onto the inherited reply
// set; --remove drops them. Body/HTML follow the same inline-or-file shape as
// the draft tools.
export const replySchema = {
  messageId: z.string().describe('Gmail message ID to reply to — the short hex `id` from gog_gmail_get / _search (or gog_gmail_messages_search, gogcli-mcp-gmail only). NOT the threadId, NOT the RFC822 `<…@host>` Message-Id header.'),
  body: z.string().optional().describe('Reply body (plain text; required unless bodyHtml or bodyHtmlFile is set). Any size — a large body is written to a temp file on the gog server rather than inlined into the command line. Note gog strips trailing newlines from a file-delivered body.'),
  bodyHtml: z.string().optional().describe('Reply body (HTML; optional). Pass the HTML itself at any size — a large body is written to a temp file on the gog server rather than inlined into the command line. Mutually exclusive with bodyHtmlFile.'),
  bodyHtmlFile: z.string().optional().describe('Path to an HTML file that ALREADY EXISTS on the gog server for the reply body. gog also accepts "-" for stdin, but this server never writes to gog\'s stdin, so "-" would hang until the call times out. Mutually exclusive with bodyHtml — supplying both is rejected. You rarely need this: bodyHtml handles large bodies on its own.'),
  to: z.array(z.string()).optional().describe('Add or move recipients to To (repeatable). Added on top of the recipients inherited from the original message.'),
  cc: z.array(z.string()).optional().describe('Add or move recipients to Cc (repeatable)'),
  bcc: z.array(z.string()).optional().describe('Add or move recipients to Bcc (repeatable)'),
  remove: z.array(z.string()).optional().describe('Remove these recipients from all fields (repeatable) — e.g. to drop someone from a reply-all.'),
  subject: z.string().optional().describe('Override reply subject (default: "Re: <original>"). A changed subject starts a NEW Gmail thread.'),
  noQuote: z.boolean().optional().describe('Do not include the original message quoted below the reply (default: the original is quoted)'),
  attach: z.array(z.string()).optional().describe('File paths to attach (repeatable), resolved ON THE GOG SERVER\'s filesystem — NOT this client\'s. Only usable when gog runs on the same machine you do (local stdio); on a hosted deployment (e.g. mcp-host) these paths do not exist and the call fails with "no such file or directory" — use attachInline there. Read on the server, base64-encoded with a MIME type inferred from the extension. Must be inside the server\'s GOG_FILE_ROOTS directories (default ~/gogcli-mcp-files).'),
  attachInline: attachInlineParam,
  from: z.string().optional().describe('Send from this email address (must be a verified send-as alias)'),
  autoFromAddressedAlias: z.boolean().optional().describe('When from is omitted, send from the verified send-as alias the original message was addressed TO, instead of the account\'s primary address — so a reply to mail sent to an alias goes back out from that alias. Ignored when from is set.'),
  signature: z.boolean().optional().describe('Append the Gmail signature from the active send-as address'),
  signatureFrom: z.string().optional().describe('Append the Gmail signature from this send-as email address'),
  signatureFile: z.string().optional().describe('Append a local signature file (plain text or HTML), read on the gog server'),
  account: accountParam,
};

export type ReplyFlags = {
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
  attachInline?: InlineAttachmentInput[];
  from?: string;
  autoFromAddressedAlias?: boolean;
  signature?: boolean;
  signatureFrom?: string;
  signatureFile?: string;
};

// Every server path a reply/draft names must sit inside GOG_FILE_ROOTS: each is
// read on the gog host and mailed out, so unconfined it is a file-exfiltration
// primitive (audit SEC-3). Checked before anything else touches gog.
export function confineReplyPaths(f: Pick<ReplyFlags, 'attach' | 'bodyHtmlFile' | 'signatureFile'>): void {
  confinePaths(f.attach, 'attach');
  if (f.bodyHtmlFile) confinePath(f.bodyHtmlFile, 'bodyHtmlFile');
  if (f.signatureFile) confinePath(f.signatureFile, 'signatureFile');
}

export function appendReplyFlags(args: GogArg[], f: ReplyFlags): void {
  assertNotBoth('bodyHtml', 'bodyHtmlFile', f.bodyHtml, f.bodyHtmlFile);
  confineReplyPaths(f);
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
  // Same repeatable --attach flag, but the bytes travel with the call: the
  // runner writes each one to a temp file beside gog and passes that path.
  // This is the only attachment route that works when the caller and gog do not
  // share a filesystem (a hosted deployment such as mcp-host). `args` is
  // passed so the size check sees the body too, which shares the same budget
  // once payloadArg has turned it into a file arg.
  args.push(...inlineAttachmentArgs('attach', f.attachInline, args));
  if (f.from) args.push(`--from=${f.from}`);
  if (f.signature) args.push('--signature');
  if (f.signatureFrom) args.push(`--signature-from=${f.signatureFrom}`);
  if (f.signatureFile) args.push(`--signature-file=${f.signatureFile}`);
  // PINNED, not conditional: GOG_GMAIL_AUTO_FROM_ADDRESSED_ALIAS in the host env
  // silently changes which address the mail goes out FROM, with nothing in the arg
  // array to show for it — and a hosted deployment's env is not the caller's to set.
  // An explicit flag is the only value authoritative everywhere.
  args.push(f.autoFromAddressedAlias ? '--auto-from-addressed-alias' : '--auto-from-addressed-alias=false');
}

// The send-side reply/reply-all schema, distinct from the shared replySchema
// above. gog_gmail_drafts_reply / _reply_all (gogcli-mcp-gmail) reuse
// replySchema verbatim and must never gain a send-confirmation input — draft
// tools stage mail, while send tools request confirmation (through MCP, or the
// opt-in confirmToken fallback, which is why only THIS schema carries it).
const sendReplySchema = z.object({ ...replySchema, confirmToken: confirmTokenParam });

// gog's own `reply`/`reply-all` response never echoes the resolved
// recipients when replying to a single message (the common case: gog only
// includes `to` in its JSON when composing several messages at once, per
// internal/cmd/gmail_compose.go's gmailMessageResultJSON). So the only way to
// tell a caller — or the audit log below — who a reply is REALLY going to is
// to read the original message's own headers, which is what the reply
// inherits from. This makes the confirmation prompt accurate rather than a
// restatement of the flags the caller already passed.
export function parseMetadataHeaders(raw: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const headers = (parsed as { headers?: unknown } | null)?.headers;
  if (!headers || typeof headers !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

// reply → sender only; reply-all → sender plus every To/Cc participant. Both
// then apply the caller's own to/cc/bcc adds and remove drops, mirroring what
// gog itself would compose. This is intentionally an approximation (it does
// not, for instance, know about Reply-To or gog's self-exclusion rules) —
// good enough for a confirmation prompt and an audit log, neither of which is the
// enforcement point; the protocol confirmation gate is. Over-including a participant who
// would not actually receive the reply is the safe direction of error here.
export function computeReplyRecipients(
  kind: 'reply' | 'reply-all',
  headers: Record<string, string>,
  flags: Pick<ReplyFlags, 'to' | 'cc' | 'bcc' | 'remove'>,
): string[] {
  const base = kind === 'reply'
    ? [headers.from]
    : [headers.from, headers.to, headers.cc];
  let emails = extractEmails(...base, ...(flags.to ?? []), ...(flags.cc ?? []), ...(flags.bcc ?? []));
  if (flags.remove?.length) {
    const removed = new Set(extractEmails(...flags.remove));
    emails = emails.filter((e) => !removed.has(e));
  }
  return emails;
}

/** `message.threadId` out of `gog gmail get --format=metadata --json`, if present. */
export function metadataThreadId(raw: string): string | undefined {
  try {
    const threadId = (JSON.parse(raw) as { message?: { threadId?: unknown } } | null)?.message?.threadId;
    return typeof threadId === 'string' ? threadId : undefined;
  } catch {
    return undefined;
  }
}

// The token fallback's preview and bound payload for a reply. To/Cc/Bcc are the
// same approximation computeReplyRecipients makes (gog composes the final list),
// split by field so the user can see who is on Bcc.
function replyTokenSubject(
  kind: 'reply' | 'reply-all',
  messageId: string,
  account: string | undefined,
  headers: Record<string, string>,
  threadId: string | undefined,
  flags: ReplyFlags,
) {
  const removed = new Set(extractEmails(...(flags.remove ?? [])));
  const keep = (emails: string[]) => emails.filter((e) => !removed.has(e));
  const to = keep(extractEmails(headers.from, ...(kind === 'reply-all' ? [headers.to] : []), ...(flags.to ?? [])));
  const cc = keep(extractEmails(...(kind === 'reply-all' ? [headers.cc] : []), ...(flags.cc ?? [])));
  const bcc = keep(extractEmails(...(flags.bcc ?? [])));
  const attachments = attachmentDetails(flags.attach, flags.attachInline);
  const subject = flags.subject || (headers.subject ? `Re: ${headers.subject}` : undefined);
  const from = flags.from ?? (flags.autoFromAddressedAlias ? 'the send-as alias the original was addressed to' : senderPreview(account));
  const localFiles = attachmentDetails([flags.bodyHtmlFile, flags.signatureFile].filter((p): p is string => Boolean(p)), undefined);
  return {
    target: messageId,
    payload: {
      kind, to, cc, bcc, subject, from,
      body: flags.body, bodyHtml: flags.bodyHtml, localFiles,
      signature: Boolean(flags.signature), signatureFrom: flags.signatureFrom,
      attachments, quote: !flags.noQuote,
      threadId, inReplyTo: headers.message_id, references: headers.references,
    },
    preview: {
      from, to, cc, bcc, subject,
      body: flags.body,
      ...(flags.bodyHtml ? { bodyHtml: flags.bodyHtml } : {}),
      ...(flags.bodyHtmlFile ? { bodyHtmlFile: flags.bodyHtmlFile } : {}),
      ...(flags.signature || flags.signatureFrom || flags.signatureFile
        ? { signature: flags.signatureFile ?? flags.signatureFrom ?? 'the Gmail signature of the sending address' }
        : {}),
      quotesOriginal: !flags.noQuote,
      attachments: attachmentPreview(attachments),
      replyingToMessageId: messageId,
      threadId,
      inReplyTo: headers.message_id,
    },
  };
}

// Shared by gog_gmail_reply and gog_gmail_reply_all: fetch the target
// message's headers (always — the prompt needs them and so does the audit
// log on the accepted path), then confirm and send.
// assertNotBoth runs BEFORE the metadata fetch, in the caller, so a bad
// bodyHtml/bodyHtmlFile pair fails with zero gog calls, same as before this
// confirmation gate existed.
async function sendReply(
  kind: 'reply' | 'reply-all',
  toolName: string,
  messageId: string,
  account: string | undefined,
  flags: ReplyFlags,
  ctx: ServerContext,
  confirmToken?: string,
) {
  const metaResult = await runOrDiagnose(['gmail', 'get', pos(messageId), '--format=metadata'], { account });
  if (metaResult.isError) return metaResult;
  const metaText = resultText(metaResult);
  const headers = parseMetadataHeaders(metaText);
  const recipients = computeReplyRecipients(kind, headers, flags);
  const confirmation = await requireGmailDispatchConfirmation(ctx, replyDispatchOp(kind), {
    messageId,
    recipients,
    recipientCount: recipients.length,
    subject: flags.subject || (headers.subject ? `Re: ${headers.subject}` : undefined),
    quoting: !flags.noQuote,
    bodyLength: (flags.body ?? flags.bodyHtml ?? '').length,
    bodyPreview: bodyPreview(flags.body ?? flags.bodyHtml),
    bodyHtmlFile: flags.bodyHtmlFile,
    attachmentCount: (flags.attach?.length ?? 0) + (flags.attachInline?.length ?? 0),
    attachments: attachmentNames(flags.attach, flags.attachInline),
  }, {
    tool: toolName,
    account,
    confirmToken,
    // The metadata read above IS the phase-2 re-read: it runs on every call,
    // so the original's Message-ID/References are fresh here.
    subject: () => replyTokenSubject(kind, messageId, account, headers, metadataThreadId(metaText), flags),
  });
  if (confirmation) return confirmation;
  const args: GogArg[] = ['gmail', kind, pos(messageId)];
  appendReplyFlags(args, flags);
  const result = await runOrDiagnose(args, { account });
  if (!result.isError) logGmailDispatch(toolName, recipients, account);
  return result;
}

// What --gmail-no-send does NOT cover (verified on gog 0.41.0): a bulk
// auto-reply, and the settings that route future mail to someone else —
// forwarding addresses, auto-forwarding, filters (which can forward) and
// delegates (which grant another account the mailbox). Each has a dedicated,
// reviewable tool; none may ride the escape hatch.
//
// gog accepts these both under `settings` AND one level up, as
// `gog gmail filters|forwarding|autoforward|delegates ...` (left out of
// `gog schema`, but they reach Google), so both spellings are refused.
const GMAIL_RUN_BLOCKED_SETTINGS = new Set(['forwarding', 'autoforward', 'filters', 'delegates']);

export function vetGmailRun(subcommand: string, args: readonly string[]): string | undefined {
  if (subcommand === 'autoreply') {
    return 'gog gmail autoreply sends mail and is not available through gog_gmail_run. Use gog_gmail_autoreply, which asks the user to confirm.';
  }
  if (GMAIL_RUN_BLOCKED_SETTINGS.has(subcommand)) {
    return `gog gmail ${subcommand} can forward or hand over mail and is not available through gog_gmail_run. Use the dedicated gog_gmail_* tool instead.`;
  }
  if (subcommand === 'settings') {
    // kong lets flags precede the command word, and a global flag can take its
    // value as the next token (`settings --color never filters ...`), so the
    // word is not necessarily args[0]. Refuse it wherever it appears; a
    // legitimate settings call carrying one of these words as a value is rare
    // and has a dedicated tool anyway.
    const blocked = args.find((a) => GMAIL_RUN_BLOCKED_SETTINGS.has(a.toLowerCase()));
    if (blocked) {
      return `gog gmail settings ${blocked} can forward or hand over mail and is not available through gog_gmail_run. Use the dedicated gog_gmail_* tool instead.`;
    }
  }
  return undefined;
}

export function registerGmailTools(server: McpServer): void {
  server.registerTool('gog_gmail_search', {
    description: 'Search Gmail threads using Gmail query syntax (e.g. "from:alice subject:invoice is:unread"). The query is passed verbatim to Gmail; a bare name token (from:alison) matches per Gmail\'s own heuristics, a full address (from:alison@example.com) is exact. To match a contact across several addresses, OR them: from:(a@x.com OR b@y.com). '
      + 'Results are ALWAYS newest-first by Gmail\'s internalDate — the wrapper sorts them, so the first result is the most recent match and a recent message can never be buried below older ones. '
      + 'IMPORTANT — a response carrying "truncated": true is an INCOMPLETE view of the matches: NEVER report that a message does not exist, or that there is no such mail, on the strength of one. Page through it (pass nextPageToken back as `pageToken`), set maxPages to walk several pages in one call, or narrow the query, and only then draw a conclusion. '
      + 'If you already know the thread, do not search for it at all — read it directly with gog_gmail_thread_get, which returns the whole thread and cannot be truncated or mis-ranked.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      query: z.string().describe('Gmail search query'),
      max: z.number().int().optional().describe('Max results to return (default: 10)'),
      pageToken: pageTokenParam,
      page: pageAliasParam,
      maxPages: z.number().int().positive().max(20).optional().describe('Walk up to this many pages in ONE call and merge the results, instead of returning a single page. Use it for existence questions (\"is there any mail matching X?\"), which a single page cannot answer. Stops early at the last page; if pages remain when the cap is hit the response is still marked truncated. Prefer this over all=true, which is unbounded.'),
      all: z.boolean().optional().describe('Fetch every page instead of one. Removes truncation entirely, at the cost of one API round-trip per page — the reliable way to answer "does any message match?" for a query with few expected hits.'),
      fromContact: z.string().optional().describe('Resolve a Google Contact (name or email) to its addresses and AND a from:(addr OR addr) clause onto the query — saves looking the contact up first when you only know who, not which address.'),
      account: accountParam,
    }),
  }, async ({ query, max, pageToken, page, maxPages, all, fromContact, account }) => {
    const args: GogArg[] = ['gmail', 'search', pos(query)];
    if (max !== undefined) args.push(`--max=${max}`);
    if (all) args.push('--all');
    if (fromContact) args.push(`--from-contact=${fromContact}`);
    // The cursor is applied per page rather than baked into args, so the
    // multi-page walk can advance it.
    const runPage = (tok: string | undefined) =>
      runOrDiagnose(tok ? [...args, `--page=${tok}`] : args, { account });
    const token = resolvePageToken({ pageToken, page });
    const result = maxPages !== undefined
      ? await fetchGmailPages(runPage, 'threads', maxPages, token)
      : await runPage(token);
    return finalizeGmailSearch(result, {
      itemsKey: 'threads',
      method: 'users.threads.list',
      query,
      account,
      // --from-contact is expanded INSIDE gog, against the People API, so the
      // query Gmail actually saw is not the one we hold here.
      queryIsExact: !fromContact,
    });
  });

  server.registerTool('gog_gmail_get', {
    description: 'Get a Gmail message by ID. For a long message, sanitizeContent is the cheapest way to keep it in context: it drops the raw MIME payload and the HTML part, which are usually the bulk of the response.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      messageId: z.string().describe('Message ID'),
      format: z.enum(['full', 'metadata', 'raw']).optional().describe('Message format (default: full)'),
      // Requires gog >= 0.37.0. Before that (openclaw/gogcli#992) the JSON
      // carried the headers and body TWICE — once inside `message`, once
      // copied to the top level — so the flag meant to shrink the payload
      // enlarged it. MIN_GOG_VERSION is the guard; there is no runtime check.
      sanitizeContent: z.boolean().optional().describe('Return agent-oriented sanitized content: HTML stripped, HTTP(S) URLs removed, raw Gmail payloads omitted from the JSON. The largest payload-size reduction available here. Note the URL removal is lossy — omit this when you need to follow a link out of the message.'),
      account: accountParam,
    }),
  }, async ({ messageId, format, sanitizeContent, account }) => {
    const args: GogArg[] = ['gmail', 'get', pos(messageId)];
    if (format) args.push(`--format=${format}`);
    if (sanitizeContent) args.push('--sanitize-content');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_send', {
    description:
      'SENDS MAIL — asks the MCP host to show a confirmation prompt with the recipients, subject, a preview of the body and the attachment names. '
      + 'Mail is sent only after the user accepts that prompt. '
      + 'Two ways to attach a file: `attach` takes paths READ ON THE GOG SERVER, and '
      + '`attachInline` takes the bytes themselves. Use attachInline unless you know the file exists on '
      + 'the same machine gog runs on — on the hosted connector and any remote deployment there is no '
      + 'shared filesystem, so no path you can name resolves there and `attach` will fail with '
      + '"no such file or directory". When either is used, the JSON result echoes the attached filenames '
      + 'and byte sizes — check it to confirm the files were embedded. '
      + 'NOT the tool for answering a message: replyToMessageId only files this in the right thread — the '
      + 'subject, recipients and body are entirely yours, and the original is not quoted unless you set '
      + 'quote. Use gog_gmail_reply / gog_gmail_reply_all instead, which inherit all three.'
      + CONFIRM_FALLBACK_DESCRIPTION,
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      to: z.string().describe('Recipient(s), comma-separated'),
      subject: z.string().describe('Subject line'),
      body: z.string().describe('Email body (plain text). Any size — a large body is written to a temp file on the gog server rather than inlined into the command line. Note gog strips trailing newlines from a file-delivered body.'),
      cc: z.string().optional().describe('CC recipients, comma-separated'),
      bcc: z.string().optional().describe('BCC recipients, comma-separated'),
      replyToMessageId: z.string().optional().describe('Message ID to thread this message against — sets In-Reply-To/References only. It does NOT quote the original (pass quote for that), inherit its recipients, or prefix the subject with "Re:". For an actual reply use gog_gmail_reply.'),
      threadId: z.string().optional().describe('Thread ID to thread this message within. Same caveat as replyToMessageId: threading only, no quote and no inherited subject or recipients.'),
      quote: z.boolean().optional().describe('Include the original message quoted below the body. Requires replyToMessageId or threadId. gog quotes by DEFAULT on gmail reply but never on gmail send, so without this a threaded send arrives with the original nowhere in it.'),
      attach: z.array(z.string()).optional().describe('File paths to attach (repeatable), resolved ON THE GOG SERVER\'s filesystem — NOT this client\'s. Only usable when gog runs on the same machine you do (local stdio); on a hosted deployment (e.g. mcp-host) these paths do not exist and the call fails with "no such file or directory" — use attachInline there. Each file is read on the server, base64-encoded with a MIME type inferred from its extension, and added as a multipart attachment. Must be inside the server\'s GOG_FILE_ROOTS directories (default ~/gogcli-mcp-files).'),
      attachInline: attachInlineParam,
      account: accountParam,
      confirmToken: confirmTokenParam,
    }),
  }, async ({ to, subject, body, cc, bcc, replyToMessageId, threadId, quote, attach, attachInline, account, confirmToken }, ctx) => {
    confinePaths(attach, 'attach');
    // Built (and validated — inlineAttachmentArgs throws on bad base64 or an
    // oversize file) BEFORE the confirmation request, on both paths: a prompt that
    // skipped this would tell a caller "looks fine, send it" about an
    // attachment that was always going to fail.
    //
    // A long body cannot ride in argv: Linux caps MAX_ARG_STRLEN at 128 KiB.
    // payloadArg swaps it for --body-file past the shared threshold; the runner
    // materializes the temp file.
    const args: GogArg[] = ['gmail', 'send', `--to=${to}`, `--subject=${subject}`, payloadArg('body', 'body-file', body)];
    if (cc) args.push(`--cc=${cc}`);
    if (bcc) args.push(`--bcc=${bcc}`);
    if (replyToMessageId) args.push(`--reply-to-message-id=${replyToMessageId}`);
    if (threadId) args.push(`--thread-id=${threadId}`);
    // gog's --quote on `gmail send` is opt-in (a plain bool defaulting false),
    // the mirror image of `gmail reply`, where quoting is the default and
    // --no-quote opts out. Nothing here can be inferred from the reply target.
    if (quote) args.push('--quote');
    if (attach) for (const path of attach) args.push(`--attach=${path}`);
    // Same repeatable --attach flag; the executor materializes each payload to a
    // temp file beside gog and substitutes its path. `args` is passed so the
    // size check sees the whole request — chiefly the body, which is itself a
    // file arg once it passes payloadArg's threshold and spends the same budget.
    const inline = inlineAttachmentArgs('attach', attachInline, args);
    args.push(...inline);

    const recipients = extractEmails(to, cc, bcc);
    const confirmation = await requireGmailDispatchConfirmation(ctx, 'gmail.send', {
      to, cc, bcc, recipients, recipientCount: recipients.length, subject,
      bodyLength: body.length,
      bodyPreview: bodyPreview(body),
      threaded: Boolean(replyToMessageId || threadId),
      quoting: Boolean(quote),
      attachmentCount: (attach?.length ?? 0) + (attachInline?.length ?? 0),
      attachments: attachmentNames(attach, attachInline),
    }, {
      tool: 'gog_gmail_send',
      account,
      confirmToken,
      // Nothing is stored between the phases: the payload IS the arguments,
      // so phase 2 must repeat them and any difference is a changed send.
      subject: () => {
        const attachments = attachmentDetails(attach, attachInline);
        const from = senderPreview(account);
        return {
          target: replyToMessageId ?? threadId ?? '',
          payload: { from, to, cc, bcc, subject, body, attachments, threadId, inReplyTo: replyToMessageId, quote: Boolean(quote) },
          preview: {
            from, to, cc, bcc, subject, body,
            attachments: attachmentPreview(attachments),
            threadId,
            inReplyTo: replyToMessageId,
            quotesOriginal: Boolean(quote),
          },
        };
      },
    });
    if (confirmation) return confirmation;
    const result = await runOrDiagnose(args, { account });
    if (!result.isError) logGmailDispatch('gog_gmail_send', recipients, account);
    return result;
  });

  // ==========================================================================
  // REPLY / REPLY-ALL
  //
  // These live here, in the base package, because gog_gmail_send +
  // replyToMessageId is NOT a reply. It sets In-Reply-To/References — so Gmail
  // files it in the right thread — and stops there: no quoted original, no
  // inherited "Re:" subject, no inherited recipients. To anyone reading the
  // body it arrives as a brand-new message.
  //
  // The asymmetry is gog's: `gmail reply` quotes BY DEFAULT (opt out with
  // --no-quote), while `gmail send` quotes only on an explicit --quote
  // (internal/cmd/gmail_send.go, a plain bool defaulting false). The gmail
  // sub-package reuses replySchema/appendReplyFlags for its draft-side twins
  // rather than declaring a second copy — registering these tools twice in the
  // one server would be a duplicate-name error.
  // ==========================================================================
  server.registerTool('gog_gmail_reply', {
    description:
      'SENDS MAIL — asks the MCP host to show a confirmation prompt with the resolved recipient, subject, a preview of the body and the attachment names. '
      + 'Mail is sent only after the user accepts that prompt. To STAGE a reply instead '
      + 'of sending it, use gog_gmail_drafts_reply (gogcli-mcp-gmail only), which never needs confirmation. '
      + 'Reply to a Gmail message (goes to the original sender only). USE THIS, not gog_gmail_send, whenever you are '
      + 'answering a message: it threads off the original AND inherits its "Re:" subject and quotes its body below '
      + 'yours, which gog_gmail_send does not — a send with replyToMessageId lands in the right thread but reads as a '
      + 'brand-new message, with the original nowhere in it. To answer every participant use gog_gmail_reply_all. '
      + 'The gogcli-mcp-gmail package adds two more routes with the same composition: gog_gmail_autoreply to reply '
      + 'across every message matching a query, and gog_gmail_drafts_reply to stage this exact reply as a draft '
      + 'instead of sending it.'
      + CONFIRM_FALLBACK_DESCRIPTION,
    annotations: { destructiveHint: true },
    inputSchema: sendReplySchema,
  }, async ({ messageId, account, confirmToken, ...flags }, ctx) => {
    assertNotBoth('bodyHtml', 'bodyHtmlFile', flags.bodyHtml, flags.bodyHtmlFile);
    confineReplyPaths(flags);
    return sendReply('reply', 'gog_gmail_reply', messageId, account, flags, ctx, confirmToken);
  });

  server.registerTool('gog_gmail_reply_all', {
    description:
      'SENDS MAIL — asks the MCP host to show a confirmation prompt with the resolved recipients, subject, a preview of the body and the attachment names. '
      + 'Mail is sent only after the user accepts that prompt. To STAGE a '
      + 'reply-all instead of sending it, use gog_gmail_drafts_reply_all (gogcli-mcp-gmail only), which never needs '
      + 'confirmation. '
      + 'Reply to all participants of a Gmail message (the sender plus every To/Cc recipient). Same inherited "Re:" '
      + 'subject and quoted original as gog_gmail_reply. Use the remove flag to drop specific recipients from the '
      + 'reply-all.'
      + CONFIRM_FALLBACK_DESCRIPTION,
    annotations: { destructiveHint: true },
    inputSchema: sendReplySchema,
  }, async ({ messageId, account, confirmToken, ...flags }, ctx) => {
    assertNotBoth('bodyHtml', 'bodyHtmlFile', flags.bodyHtml, flags.bodyHtmlFile);
    confineReplyPaths(flags);
    return sendReply('reply-all', 'gog_gmail_reply_all', messageId, account, flags, ctx, confirmToken);
  });

  registerRunTool(server, {
    service: 'gmail',
    examples: '"archive", "mark-read", "labels"',
    // gog's --gmail-no-send blocks send/reply/forward/drafts send and all of
    // their aliases at runtime (verified on gog 0.41.0). Sending goes through the
    // confirmed tools, never this escape hatch.
    gmailNoSend: true,
    vet: vetGmailRun,
  });
}
