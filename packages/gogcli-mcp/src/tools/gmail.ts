import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose } from './utils.js';

export function registerGmailTools(server: McpServer): void {
  server.registerTool('gog_gmail_search', {
    description: 'Search Gmail threads using Gmail query syntax (e.g. "from:alice subject:invoice is:unread").',
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe('Gmail search query'),
      max: z.number().int().optional().describe('Max results to return (default: 10)'),
      account: accountParam,
    },
  }, async ({ query, max, account }) => {
    const args = ['gmail', 'search', query];
    if (max !== undefined) args.push(`--max=${max}`);
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

  server.registerTool('gog_gmail_run', {
    description: 'Run any gog gmail subcommand not covered by the other tools. Run `gog gmail --help` for the full list of subcommands, or `gog gmail <subcommand> --help` for flags on a specific subcommand.',
    annotations: { destructiveHint: true },
    inputSchema: {
      subcommand: z.string().describe('The gog gmail subcommand to run, e.g. "archive", "mark-read", "labels"'),
      args: z.array(z.string()).describe('Additional positional args and flags'),
      account: accountParam,
    },
  }, async ({ subcommand, args, account }) => {
    return runOrDiagnose(['gmail', subcommand, ...args], { account });
  });
}
