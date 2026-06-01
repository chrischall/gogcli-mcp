import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose, registerRunTool } from './utils.js';

export function registerGmailTools(server: McpServer): void {
  server.registerTool('gog_gmail_search', {
    description: 'Search Gmail threads using Gmail query syntax (e.g. "from:alice subject:invoice is:unread"). The query is passed verbatim to Gmail; a bare name token (from:alison) matches per Gmail\'s own heuristics, a full address (from:alison@example.com) is exact. To match a contact across several addresses, OR them: from:(a@x.com OR b@y.com).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe('Gmail search query'),
      max: z.number().int().optional().describe('Max results to return (default: 10)'),
      fromContact: z.string().optional().describe('Resolve a Google Contact (name or email) to its addresses and AND a from:(addr OR addr) clause onto the query — saves looking the contact up first when you only know who, not which address.'),
      account: accountParam,
    },
  }, async ({ query, max, fromContact, account }) => {
    const args = ['gmail', 'search', query];
    if (max !== undefined) args.push(`--max=${max}`);
    if (fromContact) args.push(`--from-contact=${fromContact}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_get', {
    description: 'Get a Gmail message by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      messageId: z.string().describe('Message ID'),
      format: z.enum(['full', 'metadata', 'raw']).optional().describe('Message format (default: full)'),
      account: accountParam,
    },
  }, async ({ messageId, format, account }) => {
    const args = ['gmail', 'get', messageId];
    if (format) args.push(`--format=${format}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_gmail_send', {
    description: 'Send an email.',
    annotations: { destructiveHint: true },
    inputSchema: {
      to: z.string().describe('Recipient(s), comma-separated'),
      subject: z.string().describe('Subject line'),
      body: z.string().describe('Email body (plain text)'),
      cc: z.string().optional().describe('CC recipients, comma-separated'),
      bcc: z.string().optional().describe('BCC recipients, comma-separated'),
      replyToMessageId: z.string().optional().describe('Message ID to reply to'),
      threadId: z.string().optional().describe('Thread ID to reply within'),
      account: accountParam,
    },
  }, async ({ to, subject, body, cc, bcc, replyToMessageId, threadId, account }) => {
    const args = ['gmail', 'send', `--to=${to}`, `--subject=${subject}`, `--body=${body}`];
    if (cc) args.push(`--cc=${cc}`);
    if (bcc) args.push(`--bcc=${bcc}`);
    if (replyToMessageId) args.push(`--reply-to-message-id=${replyToMessageId}`);
    if (threadId) args.push(`--thread-id=${threadId}`);
    return runOrDiagnose(args, { account });
  });

  registerRunTool(server, { service: 'gmail', examples: '"archive", "mark-read", "labels"' });
}
