import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose, registerRunTool, payloadArg, pageTokenParam, pageAliasParam, resolvePageToken } from './utils.js';
import { finalizeGmailSearch, fetchGmailPages } from '../gmail-results.js';
import type { GogArg } from '../runner.js';
import { attachInlineParam, inlineAttachmentArgs } from '../attachments.js';

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
      + 'and byte sizes — check it to confirm the files were embedded.',
    annotations: { destructiveHint: true },
    inputSchema: {
      to: z.string().describe('Recipient(s), comma-separated'),
      subject: z.string().describe('Subject line'),
      body: z.string().describe('Email body (plain text). Any size — a large body is written to a temp file on the gog server rather than inlined into the command line. Note gog strips trailing newlines from a file-delivered body.'),
      cc: z.string().optional().describe('CC recipients, comma-separated'),
      bcc: z.string().optional().describe('BCC recipients, comma-separated'),
      replyToMessageId: z.string().optional().describe('Message ID to reply to'),
      threadId: z.string().optional().describe('Thread ID to reply within'),
      attach: z.array(z.string()).optional().describe('File paths to attach (repeatable), resolved ON THE GOG SERVER\'s filesystem — NOT this client\'s. Only usable when gog runs on the same machine you do (local stdio); on the hosted connector or any GOG_RUNNER_URL backend these paths do not exist and the call fails with "no such file or directory" — use attachInline there. Each file is read on the server, base64-encoded with a MIME type inferred from its extension, and added as a multipart attachment.'),
      attachInline: attachInlineParam,
      account: accountParam,
    },
  }, async ({ to, subject, body, cc, bcc, replyToMessageId, threadId, attach, attachInline, account }) => {
    // A long body cannot ride in argv: the hosted runner caps a single arg and
    // Linux caps MAX_ARG_STRLEN at 128 KiB. payloadArg swaps it for --body-file
    // past the shared threshold; the executor materializes the temp file.
    const args: GogArg[] = ['gmail', 'send', `--to=${to}`, `--subject=${subject}`, payloadArg('body', 'body-file', body)];
    if (cc) args.push(`--cc=${cc}`);
    if (bcc) args.push(`--bcc=${bcc}`);
    if (replyToMessageId) args.push(`--reply-to-message-id=${replyToMessageId}`);
    if (threadId) args.push(`--thread-id=${threadId}`);
    if (attach) for (const path of attach) args.push(`--attach=${path}`);
    // Same repeatable --attach flag; the executor materializes each payload to a
    // temp file beside gog and substitutes its path. `args` is passed so the
    // size check sees the whole request — chiefly the body, which is itself a
    // file arg once it passes payloadArg's threshold and spends the same budget.
    const inline = inlineAttachmentArgs('attach', attachInline, args);
    args.push(...inline);
    return runOrDiagnose(args, { account });
  });

  registerRunTool(server, { service: 'gmail', examples: '"archive", "mark-read", "labels"' });
}
