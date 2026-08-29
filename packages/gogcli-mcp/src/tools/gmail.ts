import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose, registerRunTool, payloadArg, pageTokenParam, pageAliasParam, resolvePageToken, assertNotBoth } from './utils.js';
import { finalizeGmailSearch, fetchGmailPages } from '../gmail-results.js';
import type { GogArg } from '../runner.js';
import { attachInlineParam, inlineAttachmentArgs } from '../attachments.js';
import type { InlineAttachmentInput } from '../attachments.js';

// gmail reply / reply-all share an identical flag set (gog 0.27+); they differ
// only in the subcommand and default recipient set (reply → sender; reply-all
// → every participant). Recipient flags are repeatable on the CLI, so they are
// arrays here. --to/--cc/--bcc ADD or MOVE recipients onto the inherited reply
// set; --remove drops them. Body/HTML follow the same inline-or-file shape as
// the draft tools.
export const replySchema = {
  messageId: z.string().describe('Gmail message ID to reply to — the short hex `id` from gog_gmail_get / _search (NOT the threadId, NOT the RFC822 `<…@host>` Message-Id header).'),
  body: z.string().optional().describe('Reply body (plain text; required unless bodyHtml or bodyHtmlFile is set). Any size — a large body is written to a temp file on the gog server rather than inlined into the command line. Note gog strips trailing newlines from a file-delivered body.'),
  bodyHtml: z.string().optional().describe('Reply body (HTML; optional). Pass the HTML itself at any size — a large body is written to a temp file on the gog server rather than inlined into the command line. Mutually exclusive with bodyHtmlFile.'),
  bodyHtmlFile: z.string().optional().describe('Path to an HTML file that ALREADY EXISTS on the gog server for the reply body. gog also accepts "-" for stdin, but this server never writes to gog\'s stdin, so "-" would hang until the call times out. Mutually exclusive with bodyHtml — supplying both is rejected. You rarely need this: bodyHtml handles large bodies on its own.'),
  to: z.array(z.string()).optional().describe('Add or move recipients to To (repeatable). Added on top of the recipients inherited from the original message.'),
  cc: z.array(z.string()).optional().describe('Add or move recipients to Cc (repeatable)'),
  bcc: z.array(z.string()).optional().describe('Add or move recipients to Bcc (repeatable)'),
  remove: z.array(z.string()).optional().describe('Remove these recipients from all fields (repeatable) — e.g. to drop someone from a reply-all.'),
  subject: z.string().optional().describe('Override reply subject (default: "Re: <original>"). A changed subject starts a NEW Gmail thread.'),
  noQuote: z.boolean().optional().describe('Do not include the original message quoted below the reply (default: the original is quoted)'),
  attach: z.array(z.string()).optional().describe('File paths to attach (repeatable), resolved ON THE GOG SERVER\'s filesystem — NOT this client\'s. Only usable when gog runs on the same machine you do (local stdio); on the hosted connector or any GOG_RUNNER_URL backend these paths do not exist and the call fails with "no such file or directory" — use attachInline there. Read on the server, base64-encoded with a MIME type inferred from the extension.'),
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

export function appendReplyFlags(args: GogArg[], f: ReplyFlags): void {
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
  // Same repeatable --attach flag, but the bytes travel with the call: the
  // executor writes each one to a temp file beside gog and passes that path.
  // This is the only attachment route that works when the caller and gog do not
  // share a filesystem (hosted connector, GOG_RUNNER_URL backend). `args` is
  // passed so the size check sees the body too, which shares the same budget
  // once payloadArg has turned it into a file arg.
  args.push(...inlineAttachmentArgs('attach', f.attachInline, args));
  if (f.from) args.push(`--from=${f.from}`);
  if (f.signature) args.push('--signature');
  if (f.signatureFrom) args.push(`--signature-from=${f.signatureFrom}`);
  if (f.signatureFile) args.push(`--signature-file=${f.signatureFile}`);
  // PINNED, not conditional: GOG_GMAIL_AUTO_FROM_ADDRESSED_ALIAS in the host env
  // silently changes which address the mail goes out FROM, with nothing in the arg
  // array to show for it — and the remote runner's backend env is not ours to set.
  // An explicit flag is the only value authoritative on both transports.
  args.push(f.autoFromAddressedAlias ? '--auto-from-addressed-alias' : '--auto-from-addressed-alias=false');
}

export function registerGmailTools(server: McpServer): void {
  server.registerTool('gog_gmail_search', {
    description: 'Search Gmail threads using Gmail query syntax (e.g. "from:alice subject:invoice is:unread"). The query is passed verbatim to Gmail; a bare name token (from:alison) matches per Gmail\'s own heuristics, a full address (from:alison@example.com) is exact. To match a contact across several addresses, OR them: from:(a@x.com OR b@y.com). '
      + 'Results are ALWAYS newest-first by Gmail\'s internalDate — the wrapper sorts them, so the first result is the most recent match and a recent message can never be buried below older ones. '
      + 'IMPORTANT — a response carrying "truncated": true is an INCOMPLETE view of the matches: NEVER report that a message does not exist, or that there is no such mail, on the strength of one. Page through it (pass nextPageToken back as `pageToken`), set maxPages to walk several pages in one call, or narrow the query, and only then draw a conclusion. '
      + 'If you already know the thread, do not search for it at all — read it directly with gog_gmail_thread_get, which returns the whole thread and cannot be truncated or mis-ranked.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe('Gmail search query'),
      max: z.number().int().optional().describe('Max results to return (default: 10)'),
      pageToken: pageTokenParam,
      page: pageAliasParam,
      maxPages: z.number().int().positive().max(20).optional().describe('Walk up to this many pages in ONE call and merge the results, instead of returning a single page. Use it for existence questions (\"is there any mail matching X?\"), which a single page cannot answer. Stops early at the last page; if pages remain when the cap is hit the response is still marked truncated. Prefer this over all=true, which is unbounded.'),
      all: z.boolean().optional().describe('Fetch every page instead of one. Removes truncation entirely, at the cost of one API round-trip per page — the reliable way to answer "does any message match?" for a query with few expected hits.'),
      fromContact: z.string().optional().describe('Resolve a Google Contact (name or email) to its addresses and AND a from:(addr OR addr) clause onto the query — saves looking the contact up first when you only know who, not which address.'),
      account: accountParam,
    },
  }, async ({ query, max, pageToken, page, maxPages, all, fromContact, account }) => {
    const args = ['gmail', 'search', query];
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
    inputSchema: {
      messageId: z.string().describe('Message ID'),
      format: z.enum(['full', 'metadata', 'raw']).optional().describe('Message format (default: full)'),
      // Requires gog >= 0.37.0. Before that (openclaw/gogcli#992) the JSON
      // carried the headers and body TWICE — once inside `message`, once
      // copied to the top level — so the flag meant to shrink the payload
      // enlarged it. MIN_GOG_VERSION is the guard; there is no runtime check.
      sanitizeContent: z.boolean().optional().describe('Return agent-oriented sanitized content: HTML stripped, HTTP(S) URLs removed, raw Gmail payloads omitted from the JSON. The largest payload-size reduction available here. Note the URL removal is lossy — omit this when you need to follow a link out of the message.'),
      account: accountParam,
    },
  }, async ({ messageId, format, sanitizeContent, account }) => {
    const args = ['gmail', 'get', messageId];
    if (format) args.push(`--format=${format}`);
    if (sanitizeContent) args.push('--sanitize-content');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_send', {
    description:
      'Send an email. Two ways to attach a file: `attach` takes paths READ ON THE GOG SERVER, and '
      + '`attachInline` takes the bytes themselves. Use attachInline unless you know the file exists on '
      + 'the same machine gog runs on — on the hosted connector and any remote deployment there is no '
      + 'shared filesystem, so no path you can name resolves there and `attach` will fail with '
      + '"no such file or directory". When either is used, the JSON result echoes the attached filenames '
      + 'and byte sizes — check it to confirm the files were embedded. '
      + 'NOT the tool for answering a message: replyToMessageId only files this in the right thread — the '
      + 'subject, recipients and body are entirely yours, and the original is not quoted unless you set '
      + 'quote. Use gog_gmail_reply / gog_gmail_reply_all instead, which inherit all three.',
    annotations: { destructiveHint: true },
    inputSchema: {
      to: z.string().describe('Recipient(s), comma-separated'),
      subject: z.string().describe('Subject line'),
      body: z.string().describe('Email body (plain text). Any size — a large body is written to a temp file on the gog server rather than inlined into the command line. Note gog strips trailing newlines from a file-delivered body.'),
      cc: z.string().optional().describe('CC recipients, comma-separated'),
      bcc: z.string().optional().describe('BCC recipients, comma-separated'),
      replyToMessageId: z.string().optional().describe('Message ID to thread this message against — sets In-Reply-To/References only. It does NOT quote the original (pass quote for that), inherit its recipients, or prefix the subject with "Re:". For an actual reply use gog_gmail_reply.'),
      threadId: z.string().optional().describe('Thread ID to thread this message within. Same caveat as replyToMessageId: threading only, no quote and no inherited subject or recipients.'),
      quote: z.boolean().optional().describe('Include the original message quoted below the body. Requires replyToMessageId or threadId. gog quotes by DEFAULT on gmail reply but never on gmail send, so without this a threaded send arrives with the original nowhere in it.'),
      attach: z.array(z.string()).optional().describe('File paths to attach (repeatable), resolved ON THE GOG SERVER\'s filesystem — NOT this client\'s. Only usable when gog runs on the same machine you do (local stdio); on the hosted connector or any GOG_RUNNER_URL backend these paths do not exist and the call fails with "no such file or directory" — use attachInline there. Each file is read on the server, base64-encoded with a MIME type inferred from its extension, and added as a multipart attachment.'),
      attachInline: attachInlineParam,
      account: accountParam,
    },
  }, async ({ to, subject, body, cc, bcc, replyToMessageId, threadId, quote, attach, attachInline, account }) => {
    // A long body cannot ride in argv: the hosted runner caps a single arg and
    // Linux caps MAX_ARG_STRLEN at 128 KiB. payloadArg swaps it for --body-file
    // past the shared threshold; the executor materializes the temp file.
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
    return runOrDiagnose(args, { account });
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
      'Reply to a Gmail message (goes to the original sender only). USE THIS, not gog_gmail_send, whenever you are '
      + 'answering a message: it threads off the original AND inherits its "Re:" subject and quotes its body below '
      + 'yours, which gog_gmail_send does not — a send with replyToMessageId lands in the right thread but reads as a '
      + 'brand-new message, with the original nowhere in it. To answer every participant use gog_gmail_reply_all.',
    annotations: { destructiveHint: true },
    inputSchema: replySchema,
  }, async ({ messageId, account, ...flags }) => {
    const args: GogArg[] = ['gmail', 'reply', messageId];
    appendReplyFlags(args, flags);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_reply_all', {
    description:
      'Reply to all participants of a Gmail message (the sender plus every To/Cc recipient). Same inherited "Re:" '
      + 'subject and quoted original as gog_gmail_reply. Use the remove flag to drop specific recipients from the '
      + 'reply-all.',
    annotations: { destructiveHint: true },
    inputSchema: replySchema,
  }, async ({ messageId, account, ...flags }) => {
    const args: GogArg[] = ['gmail', 'reply-all', messageId];
    appendReplyFlags(args, flags);
    return runOrDiagnose(args, { account });
  });

  registerRunTool(server, { service: 'gmail', examples: '"archive", "mark-read", "labels"' });
}
