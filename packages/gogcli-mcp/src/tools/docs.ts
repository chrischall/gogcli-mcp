import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose, registerRunTool } from './utils.js';

export function registerDocsTools(server: McpServer): void {
  server.registerTool('gog_docs_info', {
    description: 'Get Google Doc metadata: title, ID, and other properties.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      account: accountParam,
    },
  }, async ({ docId, account }) => {
    return runOrDiagnose(['docs', 'info', docId], { account });
  });

  server.registerTool('gog_docs_cat', {
    description: 'Read a Google Doc as plain text.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      chips: z.boolean().optional().describe('Render Google Docs smart chips (people, dates, rich links) inline in the text output'),
      account: accountParam,
    },
  }, async ({ docId, chips, account }) => {
    const args = ['docs', 'cat', docId];
    if (chips) args.push('--chips');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_create', {
    description: 'Create a new Google Doc. Returns JSON with the new docId and URL.',
    inputSchema: {
      title: z.string().describe('Title for the new document'),
      account: accountParam,
    },
  }, async ({ title, account }) => {
    return runOrDiagnose(['docs', 'create', title], { account });
  });

  server.registerTool('gog_docs_write', {
    description: 'Write text content to a Google Doc, replacing existing body content by default. Set append=true to add after existing content.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      text: z.string().describe('Text content to write'),
      append: z.boolean().optional().describe('Append to existing content instead of replacing (default: false)'),
      checkOrphans: z.boolean().optional().describe('Block the write (exit code 11) if it would orphan an open comment — i.e. remove the text the comment is anchored to. Recommended for replacement writes on commented docs.'),
      bullets: z.boolean().optional().describe('Write the paragraphs as a bulleted list with the default disc preset'),
      bulletPreset: z.string().optional().describe('Write a bulleted list with a specific Google Docs bullet glyph preset (e.g. BULLET_DISC_CIRCLE_SQUARE)'),
      ordered: z.boolean().optional().describe('Write the paragraphs as a numbered list with the default decimal preset'),
      noBullets: z.boolean().optional().describe('Remove bullets or numbering from the written paragraphs'),
      indentStart: z.number().optional().describe('Paragraph start indentation in points'),
      indentEnd: z.number().optional().describe('Paragraph end indentation in points'),
      indentFirstLine: z.number().optional().describe('Paragraph first-line indentation in points'),
      spaceAbove: z.number().optional().describe('Space above the paragraph in points'),
      spaceBelow: z.number().optional().describe('Space below the paragraph in points'),
      keepLinesTogether: z.boolean().optional().describe('Keep all lines of the paragraph on one page/column (true) or clear that setting (false)'),
      keepWithNext: z.boolean().optional().describe('Keep the paragraph with the next paragraph (true) or clear that setting (false)'),
      batch: z.string().optional().describe('Append this mutation to a persisted batch (from gog_batch_begin in gogcli-mcp-docs) instead of applying it — nothing changes in the doc until the batch is submitted.'),
      account: accountParam,
    },
  }, async ({ docId, text, append, checkOrphans, bullets, bulletPreset, ordered, noBullets, indentStart, indentEnd, indentFirstLine, spaceAbove, spaceBelow, keepLinesTogether, keepWithNext, batch, account }) => {
    const args = ['docs', 'write', docId, `--text=${text}`];
    if (append) args.push('--append');
    if (checkOrphans) args.push('--check-orphans');
    if (bullets) args.push('--bullets');
    if (bulletPreset) args.push(`--bullet-preset=${bulletPreset}`);
    if (ordered) args.push('--ordered');
    if (noBullets) args.push('--no-bullets');
    if (indentStart !== undefined) args.push(`--indent-start=${indentStart}`);
    if (indentEnd !== undefined) args.push(`--indent-end=${indentEnd}`);
    if (indentFirstLine !== undefined) args.push(`--indent-first-line=${indentFirstLine}`);
    if (spaceAbove !== undefined) args.push(`--space-above=${spaceAbove}`);
    if (spaceBelow !== undefined) args.push(`--space-below=${spaceBelow}`);
    if (keepLinesTogether !== undefined) args.push(keepLinesTogether ? '--keep-lines-together' : '--no-keep-lines-together');
    if (keepWithNext !== undefined) args.push(keepWithNext ? '--keep-with-next' : '--no-keep-with-next');
    if (batch) args.push(`--batch=${batch}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_find_replace', {
    description: 'Find and replace text in a Google Doc.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      find: z.string().describe('Text to find'),
      replace: z.string().describe('Replacement text'),
      account: accountParam,
    },
  }, async ({ docId, find, replace, account }) => {
    return runOrDiagnose(['docs', 'find-replace', docId, find, replace], { account });
  });

  server.registerTool('gog_docs_structure', {
    description: 'Show a Google Doc\'s structure with numbered paragraphs. Useful for understanding the document layout before making index-based edits.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      account: accountParam,
    },
  }, async ({ docId, account }) => {
    return runOrDiagnose(['docs', 'structure', docId], { account });
  });

  registerRunTool(server, { service: 'docs', examples: '"copy", "clear", "insert", "sed", "export"' });
}
