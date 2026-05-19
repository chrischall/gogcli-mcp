import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose } from '../../../gogcli-mcp/src/lib.js';

export function registerExtraDocsTools(server: McpServer): void {
  server.registerTool('gog_docs_copy', {
    description: 'Copy a Google Doc to a new document with the given title.',
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      title: z.string().describe('Title for the new copy'),
      parent: z.string().optional().describe('Parent folder ID to place the copy in'),
      account: accountParam,
    },
  }, async ({ docId, title, parent, account }) => {
    const args = ['docs', 'copy', docId, title];
    if (parent) args.push(`--parent=${parent}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_delete', {
    description: 'Delete content within a Google Doc by character index range.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      start: z.number().describe('Start index (character position, 1-based)'),
      end: z.number().describe('End index (character position, exclusive)'),
      tabId: z.string().optional().describe('Tab ID to delete content from (for multi-tab docs)'),
      account: accountParam,
    },
  }, async ({ docId, start, end, tabId, account }) => {
    const args = ['docs', 'delete', `--start=${start}`, `--end=${end}`, docId];
    if (tabId) args.push(`--tab-id=${tabId}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_edit', {
    description: 'Edit a Google Doc by finding and replacing text (stream-edit style).',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      find: z.string().describe('Text to find'),
      replace: z.string().describe('Replacement text'),
      matchCase: z.boolean().optional().describe('Case-sensitive matching'),
      account: accountParam,
    },
  }, async ({ docId, find, replace, matchCase, account }) => {
    const args = ['docs', 'edit', docId, find, replace];
    if (matchCase) args.push('--match-case');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_read', {
    description: 'Read the content of a Google Doc. Default: plain text body. Use format="json" for the raw Google Docs API response (lossless, includes character indices needed for index-based gog_docs_insert / gog_docs_delete calls). For markdown output, use gog_docs_export with format="md" — it writes to a file. Use gog_docs_structure to see paragraph-by-paragraph layout with indices.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      format: z.enum(['text', 'json']).optional().describe('Output format (default: text)'),
      tab: z.string().optional().describe('Target tab title or ID (text mode only)'),
      allTabs: z.boolean().optional().describe('Show all tabs with headers (text mode only)'),
      maxBytes: z.number().optional().describe('Max bytes to read in text mode (0 = unlimited; default 2000000)'),
      account: accountParam,
    },
  }, async ({ docId, format, tab, allTabs, maxBytes, account }) => {
    if (format === 'json') {
      return runOrDiagnose(['docs', 'raw', docId, '--pretty'], { account });
    }
    const args = ['docs', 'cat', docId];
    if (tab) args.push(`--tab=${tab}`);
    if (allTabs) args.push('--all-tabs');
    if (maxBytes !== undefined) args.push(`--max-bytes=${maxBytes}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_format', {
    description: 'Apply text or paragraph formatting to a Google Doc. Use `match` to format a specific text occurrence, `matchAll` to format every occurrence, or omit both to format the whole doc. Boolean flags (bold/italic/etc.) set the attribute; negated flags (noBold/noItalic/etc.) clear it.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      match: z.string().optional().describe('Format only the first text match'),
      matchAll: z.boolean().optional().describe('Format all matches instead of only the first'),
      matchCase: z.boolean().optional().describe('Case-sensitive matching'),
      tab: z.string().optional().describe('Target tab title or ID'),
      fontFamily: z.string().optional().describe('Font family (e.g. Arial, Georgia)'),
      fontSize: z.number().optional().describe('Font size in points'),
      textColor: z.string().optional().describe('Text color as #RRGGBB or #RGB'),
      bgColor: z.string().optional().describe('Text background color as #RRGGBB or #RGB'),
      bold: z.boolean().optional().describe('Set bold'),
      noBold: z.boolean().optional().describe('Clear bold'),
      italic: z.boolean().optional().describe('Set italic'),
      noItalic: z.boolean().optional().describe('Clear italic'),
      underline: z.boolean().optional().describe('Set underline'),
      noUnderline: z.boolean().optional().describe('Clear underline'),
      strikethrough: z.boolean().optional().describe('Set strikethrough'),
      noStrikethrough: z.boolean().optional().describe('Clear strikethrough'),
      alignment: z.enum(['left', 'center', 'right', 'justify', 'start', 'end', 'justified']).optional().describe('Paragraph alignment'),
      lineSpacing: z.number().optional().describe('Line spacing percentage (e.g. 100 for single, 150 for 1.5x, 200 for double)'),
      account: accountParam,
    },
  }, async (args) => {
    const a = args as {
      docId: string;
      match?: string;
      matchAll?: boolean;
      matchCase?: boolean;
      tab?: string;
      fontFamily?: string;
      fontSize?: number;
      textColor?: string;
      bgColor?: string;
      bold?: boolean; noBold?: boolean;
      italic?: boolean; noItalic?: boolean;
      underline?: boolean; noUnderline?: boolean;
      strikethrough?: boolean; noStrikethrough?: boolean;
      alignment?: string;
      lineSpacing?: number;
      account?: string;
    };
    const argv = ['docs', 'format', a.docId];
    if (a.match) argv.push(`--match=${a.match}`);
    if (a.matchAll) argv.push('--match-all');
    if (a.matchCase) argv.push('--match-case');
    if (a.tab) argv.push(`--tab=${a.tab}`);
    if (a.fontFamily) argv.push(`--font-family=${a.fontFamily}`);
    if (a.fontSize !== undefined) argv.push(`--font-size=${a.fontSize}`);
    if (a.textColor) argv.push(`--text-color=${a.textColor}`);
    if (a.bgColor) argv.push(`--bg-color=${a.bgColor}`);
    if (a.bold) argv.push('--bold');
    if (a.noBold) argv.push('--no-bold');
    if (a.italic) argv.push('--italic');
    if (a.noItalic) argv.push('--no-italic');
    if (a.underline) argv.push('--underline');
    if (a.noUnderline) argv.push('--no-underline');
    if (a.strikethrough) argv.push('--strikethrough');
    if (a.noStrikethrough) argv.push('--no-strikethrough');
    if (a.alignment) argv.push(`--alignment=${a.alignment}`);
    if (a.lineSpacing !== undefined) argv.push(`--line-spacing=${a.lineSpacing}`);
    return runOrDiagnose(argv, { account: a.account });
  });

  server.registerTool('gog_docs_export', {
    description: 'Export a Google Doc as PDF, plain text, HTML, DOCX, or other format.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      format: z.string().optional().describe('Export format: pdf, txt, html, docx, rtf, odt, epub (default: pdf)'),
      out: z.string().optional().describe('Output file path'),
      account: accountParam,
    },
  }, async ({ docId, format, out, account }) => {
    const args = ['docs', 'export', docId];
    if (format) args.push(`--format=${format}`);
    if (out) args.push(`--out=${out}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_insert', {
    description: 'Insert text at a specific character index in a Google Doc. When `index` is omitted, gog defaults to 1 (the very beginning), NOT the end — sequential inserts without an explicit index produce reversed output. To append at the end of the doc, use gog_docs_append (which uses `gog docs write --append` and is the right tool for iterative document construction). To find a valid index for mid-document inserts, call gog_docs_structure or gog_docs_read first.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      content: z.string().optional().describe('Text content to insert'),
      index: z.number().optional().describe('Character index to insert at (1-based; default: 1 = start of doc). Prefer gog_docs_append when you want to add at the end.'),
      file: z.string().optional().describe('Path to a file whose content to insert'),
      tabId: z.string().optional().describe('Tab ID to insert into (for multi-tab docs)'),
      account: accountParam,
    },
  }, async ({ docId, content, index, file, tabId, account }) => {
    const args = ['docs', 'insert', docId];
    if (content) args.push(content);
    if (index !== undefined) args.push(`--index=${index}`);
    if (file) args.push(`--file=${file}`);
    if (tabId) args.push(`--tab-id=${tabId}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_append', {
    description: 'Append text to the end of a Google Doc. This is the right tool for iterative document construction — multiple sequential calls produce content in the order they were called. Use gog_docs_insert only when you need to insert at a specific character position.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      text: z.string().optional().describe('Text content to append'),
      file: z.string().optional().describe('Path to a text file to append (use "-" for stdin)'),
      markdown: z.boolean().optional().describe('Convert markdown to Google Docs formatting (headings, bold, lists, etc.)'),
      tab: z.string().optional().describe('Target tab title or ID (for multi-tab docs)'),
      account: accountParam,
    },
  }, async ({ docId, text, file, markdown, tab, account }) => {
    const args = ['docs', 'write', docId, '--append'];
    if (text) args.push(`--text=${text}`);
    if (file) args.push(`--file=${file}`);
    if (markdown) args.push('--markdown');
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_list_tabs', {
    description: 'List all tabs in a Google Doc.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      account: accountParam,
    },
  }, async ({ docId, account }) => {
    return runOrDiagnose(['docs', 'list-tabs', docId], { account });
  });

  server.registerTool('gog_docs_sed', {
    description: 'Stream-edit a Google Doc with sed-like regex expressions (s/find/replace/ syntax).',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      expression: z.string().optional().describe('Single sed expression (e.g. "s/old/new/g")'),
      expressions: z.array(z.string()).optional().describe('Multiple sed expressions'),
      file: z.string().optional().describe('Path to a sed script file'),
      tab: z.string().optional().describe('Tab name to edit'),
      account: accountParam,
    },
  }, async ({ docId, expression, expressions, file, tab, account }) => {
    const args = ['docs', 'sed', docId];
    if (expression) args.push(expression);
    if (expressions) {
      for (const expr of expressions) {
        args.push(`--expressions=${expr}`);
      }
    }
    if (file) args.push(`--file=${file}`);
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_update', {
    description: 'Update a Google Doc — insert or replace text at a specific position.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      text: z.string().optional().describe('Text content to write'),
      file: z.string().optional().describe('Path to a file whose content to use'),
      index: z.number().optional().describe('Character index to insert at'),
      tabId: z.string().optional().describe('Tab ID for multi-tab docs'),
      pageless: z.boolean().optional().describe('Set document to pageless format'),
      account: accountParam,
    },
  }, async ({ docId, text, file, index, tabId, pageless, account }) => {
    const args = ['docs', 'update', docId];
    if (text) args.push(`--text=${text}`);
    if (file) args.push(`--file=${file}`);
    if (index !== undefined) args.push(`--index=${index}`);
    if (tabId) args.push(`--tab-id=${tabId}`);
    if (pageless) args.push('--pageless');
    return runOrDiagnose(args, { account });
  });

  // Comment-thread tools
  server.registerTool('gog_docs_comments_list', {
    description:
      'List comments on a Google Doc. Returns open comments by default; set includeResolved=true to include resolved comments.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      includeResolved: z.boolean().optional().describe('Include resolved comments (default: false, open only)'),
      account: accountParam,
    },
  }, async ({ docId, includeResolved, account }) => {
    const args = ['docs', 'comments', 'list', docId];
    if (includeResolved) args.push('--include-resolved');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_comments_get', {
    description: 'Get a single comment by ID, including its replies.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      commentId: z.string().describe('Comment ID'),
      account: accountParam,
    },
  }, async ({ docId, commentId, account }) => {
    return runOrDiagnose(['docs', 'comments', 'get', docId, commentId], { account });
  });

  server.registerTool('gog_docs_comments_add', {
    description:
      'Add a comment to a Google Doc. Optionally attach quoted text that appears as the highlighted passage in the Google Docs UI.',
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      content: z.string().describe('Comment text'),
      quoted: z.string().optional().describe('Quoted text to attach to the comment (shown in UIs when available)'),
      account: accountParam,
    },
  }, async ({ docId, content, quoted, account }) => {
    const args = ['docs', 'comments', 'add', docId, content];
    if (quoted) args.push(`--quoted=${quoted}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_comments_reply', {
    description: 'Reply to an existing comment on a Google Doc.',
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      commentId: z.string().describe('Comment ID to reply to'),
      content: z.string().describe('Reply text'),
      account: accountParam,
    },
  }, async ({ docId, commentId, content, account }) => {
    return runOrDiagnose(['docs', 'comments', 'reply', docId, commentId, content], { account });
  });

  server.registerTool('gog_docs_comments_resolve', {
    description: 'Resolve a comment (mark as done). Optionally include a closing message.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      commentId: z.string().describe('Comment ID to resolve'),
      message: z.string().optional().describe('Optional message to include when resolving'),
      account: accountParam,
    },
  }, async ({ docId, commentId, message, account }) => {
    const args = ['docs', 'comments', 'resolve', docId, commentId];
    if (message) args.push(`--message=${message}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_comments_delete', {
    description: 'Delete a comment from a Google Doc. This action is permanent.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      commentId: z.string().describe('Comment ID to delete'),
      account: accountParam,
    },
  }, async ({ docId, commentId, account }) => {
    return runOrDiagnose(['docs', 'comments', 'delete', docId, commentId], { account });
  });
}
