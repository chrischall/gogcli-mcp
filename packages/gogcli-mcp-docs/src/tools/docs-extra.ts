import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose, paginationParams, pushPaginationFlags } from '../../../gogcli-mcp/src/lib.js';

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
    description: 'Delete content within a Google Doc by character index range. To remove the entire document (move to Drive trash), use gog_docs_trash.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      start: z.number().optional().describe('Start index (character position, 1-based). Required unless `at` is set.'),
      end: z.number().optional().describe('End index (character position, exclusive). Required unless `at` is set.'),
      at: z.string().optional().describe('Anchor by literal text and delete that matched range, instead of supplying start/end indices.'),
      occurrence: z.number().int().optional().describe('Use the Nth `at` match (1-based; required when `at` is ambiguous)'),
      matchCase: z.boolean().optional().describe('Case-sensitive `at` matching'),
      tabId: z.string().optional().describe('Tab ID to delete content from (for multi-tab docs)'),
      batch: z.string().optional().describe('Append this mutation to a persisted batch (from gog_batch_begin) instead of applying it — nothing changes in the doc until gog_batch_end submits the batch.'),
      account: accountParam,
    },
  }, async ({ docId, start, end, at, occurrence, matchCase, tabId, batch, account }) => {
    const args = ['docs', 'delete'];
    if (start !== undefined) args.push(`--start=${start}`);
    if (end !== undefined) args.push(`--end=${end}`);
    args.push(docId);
    if (at) args.push(`--at=${at}`);
    if (occurrence !== undefined) args.push(`--occurrence=${occurrence}`);
    if (matchCase) args.push('--match-case');
    if (tabId) args.push(`--tab-id=${tabId}`);
    if (batch) args.push(`--batch=${batch}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_trash', {
    description: 'Move an entire Google Doc to Drive trash. Convenience wrapper around `gog drive delete` so docs-only users can clean up without installing gogcli-mcp-drive. The doc remains recoverable from Drive trash for ~30 days.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID to move to trash'),
      account: accountParam,
    },
  }, async ({ docId, account }) => {
    return runOrDiagnose(['drive', 'delete', docId], { account });
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
      tab: z.string().optional().describe('Target tab title or ID. In json mode, returns that one tab in the legacy top-level Document shape.'),
      allTabs: z.boolean().optional().describe('Show all tabs. In json mode, returns the canonical Document response with all tab content populated.'),
      maxBytes: z.number().optional().describe('Max bytes to read in text mode (0 = unlimited; default 2000000)'),
      account: accountParam,
    },
  }, async ({ docId, format, tab, allTabs, maxBytes, account }) => {
    if (format === 'json') {
      const args = ['docs', 'raw', docId, '--pretty'];
      if (tab) args.push(`--tab=${tab}`);
      if (allTabs) args.push('--all-tabs');
      return runOrDiagnose(args, { account });
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
      code: z.boolean().optional().describe('Apply code style (Courier New monospace + grey background)'),
      link: z.string().optional().describe('Set a hyperlink on the matched text. Accepts http://, https://, mailto:, #bookmarkId, or #heading-slug.'),
      noLink: z.boolean().optional().describe('Clear any hyperlink on the matched text'),
      alignment: z.enum(['left', 'center', 'right', 'justify', 'start', 'end', 'justified']).optional().describe('Paragraph alignment'),
      lineSpacing: z.number().optional().describe('Line spacing percentage (e.g. 100 for single, 150 for 1.5x, 200 for double)'),
      headingLevel: z.number().int().optional().describe('Set paragraph named style to HEADING_1..HEADING_6 (shortcut for namedStyle=HEADING_N)'),
      namedStyle: z.enum(['NORMAL_TEXT', 'TITLE', 'SUBTITLE', 'HEADING_1', 'HEADING_2', 'HEADING_3', 'HEADING_4', 'HEADING_5', 'HEADING_6']).optional().describe('Set paragraph named style explicitly'),
      batch: z.string().optional().describe('Append this mutation to a persisted batch (from gog_batch_begin) instead of applying it — nothing changes in the doc until gog_batch_end submits the batch.'),
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
      code?: boolean;
      link?: string; noLink?: boolean;
      alignment?: string;
      batch?: string;
      lineSpacing?: number;
      headingLevel?: number;
      namedStyle?: string;
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
    if (a.code) argv.push('--code');
    if (a.link) argv.push(`--link=${a.link}`);
    if (a.noLink) argv.push('--no-link');
    if (a.alignment) argv.push(`--alignment=${a.alignment}`);
    if (a.lineSpacing !== undefined) argv.push(`--line-spacing=${a.lineSpacing}`);
    if (a.headingLevel !== undefined) argv.push(`--heading-level=${a.headingLevel}`);
    if (a.namedStyle) argv.push(`--named-style=${a.namedStyle}`);
    if (a.batch) argv.push(`--batch=${a.batch}`);
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
      at: z.string().optional().describe('Anchor by literal text and insert at the start of the matched range, instead of computing an index.'),
      occurrence: z.number().int().optional().describe('Use the Nth `at` match (1-based; required when `at` is ambiguous)'),
      matchCase: z.boolean().optional().describe('Case-sensitive `at` matching'),
      tabId: z.string().optional().describe('Tab ID to insert into (for multi-tab docs)'),
      batch: z.string().optional().describe('Append this mutation to a persisted batch (from gog_batch_begin) instead of applying it — nothing changes in the doc until gog_batch_end submits the batch.'),
      account: accountParam,
    },
  }, async ({ docId, content, index, file, at, occurrence, matchCase, tabId, batch, account }) => {
    const args = ['docs', 'insert', docId];
    if (content) args.push(content);
    if (index !== undefined) args.push(`--index=${index}`);
    if (file) args.push(`--file=${file}`);
    if (at) args.push(`--at=${at}`);
    if (occurrence !== undefined) args.push(`--occurrence=${occurrence}`);
    if (matchCase) args.push('--match-case');
    if (tabId) args.push(`--tab-id=${tabId}`);
    if (batch) args.push(`--batch=${batch}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_append', {
    description: 'Append text to the end of a Google Doc. This is the right tool for iterative document construction — multiple sequential calls produce content in the order they were called. Use gog_docs_insert only when you need to insert at a specific character position. Known markdown=true limitations (tracked upstream): (a) 3+ tables in one call reorders the trailing punctuation of the paragraph before the 3rd table — split into multiple calls with ≤2 tables each (openclaw/gogcli#607); (b) inline **bold** / *italic* / `code` inside table cells renders as literal characters — pre-format cell text separately or apply formatting after the append via gog_docs_format (openclaw/gogcli#608); (c) tables with an empty header row leak the last data row as literal pipe text — always supply a non-empty header (openclaw/gogcli#609).',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      text: z.string().optional().describe('Text content to append'),
      file: z.string().optional().describe('Path to a text file to append (use "-" for stdin)'),
      markdown: z.boolean().optional().describe('Convert markdown to Google Docs formatting (headings, bold, lists, etc.). See the tool description for known upstream limitations around tables.'),
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
      replaceRange: z.string().optional().describe('Replace a UTF-16 Docs API range START:END (e.g. "25:40") instead of inserting at index. The replacement text/file content overwrites the range.'),
      markdown: z.boolean().optional().describe('Convert markdown in the text/file to Google Docs formatting (headings, bold, lists, etc.) instead of inserting it literally.'),
      at: z.string().optional().describe('Anchor by literal text and replace that matched range, instead of supplying an index or replaceRange.'),
      occurrence: z.number().int().optional().describe('Use the Nth `at` match (1-based; required when `at` is ambiguous)'),
      matchCase: z.boolean().optional().describe('Case-sensitive `at` matching'),
      tabId: z.string().optional().describe('Tab ID for multi-tab docs'),
      pageless: z.boolean().optional().describe('Set document to pageless format'),
      batch: z.string().optional().describe('Append this mutation to a persisted batch (from gog_batch_begin) instead of applying it — nothing changes in the doc until gog_batch_end submits the batch.'),
      account: accountParam,
    },
  }, async ({ docId, text, file, index, replaceRange, markdown, at, occurrence, matchCase, tabId, pageless, batch, account }) => {
    const args = ['docs', 'update', docId];
    if (text) args.push(`--text=${text}`);
    if (file) args.push(`--file=${file}`);
    if (index !== undefined) args.push(`--index=${index}`);
    if (replaceRange) args.push(`--replace-range=${replaceRange}`);
    if (markdown) args.push('--markdown');
    if (at) args.push(`--at=${at}`);
    if (occurrence !== undefined) args.push(`--occurrence=${occurrence}`);
    if (matchCase) args.push('--match-case');
    if (tabId) args.push(`--tab-id=${tabId}`);
    if (pageless) args.push('--pageless');
    if (batch) args.push(`--batch=${batch}`);
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
      since: z.string().optional().describe('Only return comments modified at or after this RFC3339 timestamp (e.g. 2026-06-01T00:00:00Z)'),
      ...paginationParams,
      account: accountParam,
    },
  }, async ({ docId, includeResolved, since, max, page, all, account }) => {
    const args = ['docs', 'comments', 'list', docId];
    if (includeResolved) args.push('--include-resolved');
    if (since) args.push(`--since=${since}`);
    pushPaginationFlags(args, { max, page, all });
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

  server.registerTool('gog_docs_comments_reopen', {
    description: 'Reopen a previously resolved comment (flip resolved → open).',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      commentId: z.string().describe('Comment ID to reopen'),
      account: accountParam,
    },
  }, async ({ docId, commentId, account }) => {
    return runOrDiagnose(['docs', 'comments', 'reopen', docId, commentId], { account });
  });

  server.registerTool('gog_docs_comments_locate', {
    description: 'Locate a comment\'s anchor in a Google Doc — resolves the comment\'s quoted text to its current Docs API index range, or reports the comment as orphaned if the quote can no longer be found (e.g. the anchored text was edited away). Read-only; useful before an index-based edit near a comment.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      commentId: z.string().describe('Comment ID to locate'),
      matchCase: z.boolean().optional().describe('Case-sensitive matching of the comment quote'),
      normalizeWhitespace: z.boolean().optional().describe('Collapse whitespace while matching the comment quote'),
      tab: z.string().optional().describe('Target a specific tab by title or ID'),
      account: accountParam,
    },
  }, async ({ docId, commentId, matchCase, normalizeWhitespace, tab, account }) => {
    const args = ['docs', 'comments', 'locate', docId, commentId];
    if (matchCase) args.push('--match-case');
    if (normalizeWhitespace) args.push('--normalize-whitespace');
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_find_range', {
    description: 'Map literal text in a Google Doc to its Docs API UTF-16 index range(s). Read-only helper for computing the start/end indices that index-based tools (gog_docs_delete, gog_docs_update --replace-range) need. Returns the first match by default; use occurrence to pick a specific one or all to return every match.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      text: z.string().describe('Literal text to locate'),
      occurrence: z.number().int().optional().describe('Return the Nth occurrence (1-based; default: first)'),
      matchCase: z.boolean().optional().describe('Case-sensitive matching'),
      normalizeWhitespace: z.boolean().optional().describe('Collapse whitespace while matching'),
      all: z.boolean().optional().describe('Return all matches instead of just one'),
      failEmpty: z.boolean().optional().describe('Treat no matches as an error instead of returning an empty result'),
      tab: z.string().optional().describe('Target a specific tab by title or ID'),
      account: accountParam,
    },
  }, async ({ docId, text, occurrence, matchCase, normalizeWhitespace, all, failEmpty, tab, account }) => {
    const args = ['docs', 'find-range', docId, text];
    if (occurrence !== undefined) args.push(`--occurrence=${occurrence}`);
    if (matchCase) args.push('--match-case');
    if (normalizeWhitespace) args.push('--normalize-whitespace');
    if (all) args.push('--all');
    if (failEmpty) args.push('--fail-empty');
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  // Persisted, revision-locked Docs request batches (gog 0.25): begin a batch,
  // run docs mutation tools with batch=<id> to compose requests locally, then
  // end to submit them atomically against the locked revision.
  server.registerTool('gog_batch_begin', {
    description: 'Open a persisted, revision-locked request batch for a Google Doc. Subsequent docs mutation tools called with batch=<batchId> append their requests locally instead of applying them; gog_batch_end submits everything atomically. Returns the batchId.',
    inputSchema: {
      docId: z.string().describe('Google Doc ID the batch is locked to'),
      name: z.string().optional().describe('Optional batch label'),
      account: accountParam,
    },
  }, async ({ docId, name, account }) => {
    const args = ['batch', 'begin', `--doc=${docId}`];
    if (name) args.push(`--name=${name}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_batch_end', {
    description: 'Submit a persisted batch: applies every composed request to the doc in one atomic batchUpdate against the locked revision. Atomic by default — set autoSplit to submit >500-request batches as ordered chunks (non-atomic), or continueOnError to retry individually after an atomic validation failure, retaining failures in the batch.',
    annotations: { destructiveHint: true },
    inputSchema: {
      batchId: z.string().describe('Batch ID (from gog_batch_begin)'),
      autoSplit: z.boolean().optional().describe('Submit batches over 500 requests as ordered chunks (non-atomic)'),
      continueOnError: z.boolean().optional().describe('After an atomic validation failure, submit requests individually and retain failures'),
      account: accountParam,
    },
  }, async ({ batchId, autoSplit, continueOnError, account }) => {
    const args = ['batch', 'end', batchId];
    if (autoSplit) args.push('--auto-split');
    if (continueOnError) args.push('--continue-on-error');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_batch_abort', {
    description: 'Discard a persisted batch and its composed requests without applying anything to the doc.',
    annotations: { destructiveHint: true },
    inputSchema: {
      batchId: z.string().describe('Batch ID to discard'),
      account: accountParam,
    },
  }, async ({ batchId, account }) => {
    return runOrDiagnose(['batch', 'abort', batchId], { account });
  });

  server.registerTool('gog_batch_list', {
    description: 'List persisted Docs request batches (id, doc, label, request count, status).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      account: accountParam,
    },
  }, async ({ account }) => {
    return runOrDiagnose(['batch', 'list'], { account });
  });

  server.registerTool('gog_batch_show', {
    description: 'Show one persisted batch: its doc, locked revision, and the composed requests awaiting submission.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      batchId: z.string().describe('Batch ID'),
      account: accountParam,
    },
  }, async ({ batchId, account }) => {
    return runOrDiagnose(['batch', 'show', batchId], { account });
  });

  server.registerTool('gog_batch_prune', {
    description: 'Delete stale persisted batches (not updated within olderThan).',
    annotations: { destructiveHint: true },
    inputSchema: {
      olderThan: z.string().optional().describe('Delete batches not updated within this duration (e.g. 72h, 7d)'),
      account: accountParam,
    },
  }, async ({ olderThan, account }) => {
    const args = ['batch', 'prune'];
    if (olderThan) args.push(`--older-than=${olderThan}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_table_column_width', {
    description: 'Set a fixed width (in points) for a table column, or reset columns to Docs-managed even distribution. Target the table by 1-based index in document order (negative counts from the end) and the column by 1-based number. Pass evenlyDistributed without col to reset every column in the table.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      col: z.number().int().optional().describe('1-based column number. Omit with evenlyDistributed to reset all columns.'),
      width: z.number().optional().describe('Fixed column width in points (minimum 5pt). Mutually exclusive with evenlyDistributed.'),
      evenlyDistributed: z.boolean().optional().describe('Reset the selected column (or all columns when col is omitted) to Docs-managed equal width.'),
      tableIndex: z.number().int().optional().describe('1-based table index in document order; negative counts from the end (default: 1)'),
      tab: z.string().optional().describe('Target tab title or ID'),
      batch: z.string().optional().describe('Append this mutation to a persisted batch (from gog_batch_begin) instead of applying it — nothing changes in the doc until gog_batch_end submits the batch.'),
      account: accountParam,
    },
  }, async ({ docId, col, width, evenlyDistributed, tableIndex, tab, batch, account }) => {
    const args = ['docs', 'table-column-width', docId];
    if (col !== undefined) args.push(`--col=${col}`);
    if (width !== undefined) args.push(`--width=${width}`);
    if (evenlyDistributed) args.push('--evenly-distributed');
    if (tableIndex !== undefined) args.push(`--table-index=${tableIndex}`);
    if (tab) args.push(`--tab=${tab}`);
    if (batch) args.push(`--batch=${batch}`);
    return runOrDiagnose(args, { account });
  });

  // Shared describe for the --table selector used by the table-row/column/merge
  // tools (a richer addressing scheme than the older tableIndex param).
  const tableSelectorParam = z.string().optional().describe('Table selector: 1-based index (negative from the end), exact first-cell text, * for the only table, or text:VALUE for numeric/syntax-looking first-cell text (default: 1)');

  server.registerTool('gog_docs_table_row_insert', {
    description: 'Insert a row into a native Google Docs table, optionally populated from a JSON string array. Inserts before the 1-based position given by `at` (negative counts from the end; "end" appends — the default).',
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      table: tableSelectorParam,
      at: z.string().optional().describe('Insert before this 1-based row, a negative index from the end, or "end" to append (default: end)'),
      valuesJson: z.string().optional().describe('JSON string array with the new row\'s cell values, e.g. ["Name","Qty"]'),
      tab: z.string().optional().describe('Target a specific tab by title or ID'),
      account: accountParam,
    },
  }, async ({ docId, table, at, valuesJson, tab, account }) => {
    const args = ['docs', 'table-row', 'insert', docId];
    if (table) args.push(`--table=${table}`);
    if (at) args.push(`--at=${at}`);
    if (valuesJson) args.push(`--values-json=${valuesJson}`);
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_table_row_delete', {
    description: 'Delete a row from a native Google Docs table by 1-based row number (negative counts from the end). The row\'s cell content is lost.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      row: z.number().int().describe('1-based row number; negative indexes count from the end'),
      table: tableSelectorParam,
      tab: z.string().optional().describe('Target a specific tab by title or ID'),
      account: accountParam,
    },
  }, async ({ docId, row, table, tab, account }) => {
    const args = ['docs', 'table-row', 'delete', docId, `--row=${row}`];
    if (table) args.push(`--table=${table}`);
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_table_column_insert', {
    description: 'Insert a column into a native Google Docs table. Inserts before the 1-based position given by `at` (negative counts from the end; "end" appends — the default).',
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      table: tableSelectorParam,
      at: z.string().optional().describe('Insert before this 1-based column, a negative index from the end, or "end" to append (default: end)'),
      tab: z.string().optional().describe('Target a specific tab by title or ID'),
      account: accountParam,
    },
  }, async ({ docId, table, at, tab, account }) => {
    const args = ['docs', 'table-column', 'insert', docId];
    if (at) args.push(`--at=${at}`);
    if (table) args.push(`--table=${table}`);
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_table_column_delete', {
    description: 'Delete a column from a native Google Docs table by 1-based column number (negative counts from the end). The column\'s cell content is lost.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      col: z.number().int().describe('1-based column number; negative indexes count from the end'),
      table: tableSelectorParam,
      tab: z.string().optional().describe('Target a specific tab by title or ID'),
      account: accountParam,
    },
  }, async ({ docId, col, table, tab, account }) => {
    const args = ['docs', 'table-column', 'delete', docId, `--col=${col}`];
    if (table) args.push(`--table=${table}`);
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_table_merge', {
    description: 'Merge a rectangular cell range in a native Google Docs table. Content of non-first cells in the range is absorbed/discarded by the merge — use gog_docs_table_unmerge to split back.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      range: z.string().describe('1-based cell range r1,c1:r2,c2 (e.g. "1,1:2,3")'),
      table: tableSelectorParam,
      tab: z.string().optional().describe('Target a specific tab by title or ID'),
      account: accountParam,
    },
  }, async ({ docId, range, table, tab, account }) => {
    const args = ['docs', 'table-merge', docId, `--range=${range}`];
    if (table) args.push(`--table=${table}`);
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_table_unmerge', {
    description: 'Unmerge (split) the merged region containing a given cell in a native Google Docs table.',
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      cell: z.string().describe('1-based cell r,c inside the merged region (e.g. "1,1")'),
      table: tableSelectorParam,
      tab: z.string().optional().describe('Target a specific tab by title or ID'),
      account: accountParam,
    },
  }, async ({ docId, cell, table, tab, account }) => {
    const args = ['docs', 'table-unmerge', docId, `--cell=${cell}`];
    if (table) args.push(`--table=${table}`);
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_named_range_create', {
    description: 'Create a named range — a durable, tab-aware anchor over a span of document text that survives subsequent edits (unlike raw indices). Anchor by literal text (`at`) or explicit UTF-16 start/end indices. Pair with gog_docs_named_range_replace for repeatable templated updates.',
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      name: z.string().describe('Unique named range name'),
      at: z.string().optional().describe('Create the range around this literal matched text, instead of start/end indices'),
      occurrence: z.number().int().optional().describe('Use the Nth `at` match (1-based; required when `at` is ambiguous)'),
      matchCase: z.boolean().optional().describe('Case-sensitive `at` matching'),
      start: z.number().int().optional().describe('Range start UTF-16 index (inclusive). Required with end unless `at` is set.'),
      end: z.number().int().optional().describe('Range end UTF-16 index (exclusive). Required with start unless `at` is set.'),
      tab: z.string().optional().describe('Target a specific tab by title or ID'),
      account: accountParam,
    },
  }, async ({ docId, name, at, occurrence, matchCase, start, end, tab, account }) => {
    const args = ['docs', 'named-range', 'create', docId, `--name=${name}`];
    if (at) args.push(`--at=${at}`);
    if (occurrence !== undefined) args.push(`--occurrence=${occurrence}`);
    if (matchCase) args.push('--match-case');
    if (start !== undefined) args.push(`--start=${start}`);
    if (end !== undefined) args.push(`--end=${end}`);
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_named_range_list', {
    description: 'List named ranges in a Google Doc, optionally filtered by name.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      name: z.string().optional().describe('Only return ranges with this name'),
      tab: z.string().optional().describe('Target a specific tab by title or ID'),
      account: accountParam,
    },
  }, async ({ docId, name, tab, account }) => {
    const args = ['docs', 'named-range', 'list', docId];
    if (name) args.push(`--name=${name}`);
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_named_range_delete', {
    description: 'Delete a named range (the anchor only — the underlying document text is untouched).',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      nameOrId: z.string().describe('Named range name or ID'),
      tab: z.string().optional().describe('Target a specific tab by title or ID'),
      account: accountParam,
    },
  }, async ({ docId, nameOrId, tab, account }) => {
    const args = ['docs', 'named-range', 'delete', docId, nameOrId];
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_named_range_replace', {
    description: 'Replace the text inside a named range with new content (inline or from a file), keeping the anchor for future updates — the templated-update workhorse.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      nameOrId: z.string().describe('Named range name or ID'),
      text: z.string().optional().describe('Replacement text'),
      file: z.string().optional().describe('Path to a file with the replacement text'),
      tab: z.string().optional().describe('Target a specific tab by title or ID'),
      account: accountParam,
    },
  }, async ({ docId, nameOrId, text, file, tab, account }) => {
    const args = ['docs', 'named-range', 'replace', docId, nameOrId];
    if (text !== undefined) args.push(`--text=${text}`);
    if (file) args.push(`--file=${file}`);
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_tables_list', {
    description: 'Enumerate the native tables in a Google Doc (dimensions, position) — the index/first-cell-text it reports feeds the `table` selector on the table-row/column/merge tools.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      tab: z.string().optional().describe('Tab title or ID (omit for default)'),
      account: accountParam,
    },
  }, async ({ docId, tab, account }) => {
    const args = ['docs', 'tables', 'list', docId];
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_images_list', {
    description: 'Enumerate inline/positioned images in a Google Doc.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      tab: z.string().optional().describe('Tab title or ID (omit for default)'),
      account: accountParam,
    },
  }, async ({ docId, tab, account }) => {
    const args = ['docs', 'images', 'list', docId];
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_headings_list', {
    description: 'Enumerate headings in a Google Doc (a lightweight outline view), optionally filtered to one heading level.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      level: z.number().int().optional().describe('Only return this heading level (1-6)'),
      tab: z.string().optional().describe('Tab title or ID (omit for default)'),
      account: accountParam,
    },
  }, async ({ docId, level, tab, account }) => {
    const args = ['docs', 'headings', 'list', docId];
    if (level !== undefined) args.push(`--level=${level}`);
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_paragraphs_list', {
    description: 'Enumerate paragraphs in a Google Doc with emptiness, text-run ranges, styles, and links — richer than gog_docs_structure when you need per-run detail. Optionally filter to one named style.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      style: z.string().optional().describe('Only return this named style (e.g. NORMAL_TEXT or HEADING_2)'),
      tab: z.string().optional().describe('Tab title or ID (omit for default)'),
      account: accountParam,
    },
  }, async ({ docId, style, tab, account }) => {
    const args = ['docs', 'paragraphs', 'list', docId];
    if (style) args.push(`--style=${style}`);
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_insert_page_break', {
    description: 'Insert a Google Docs page break via InsertPageBreakRequest — the only path for multi-page deliverables (markdown has no page-break construct). Specify `index` for a precise character position, or `atEnd` for end-of-doc.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      index: z.number().int().optional().describe('Character index to insert at (1 = beginning). Omit or use atEnd for end-of-doc.'),
      atEnd: z.boolean().optional().describe('Insert at end-of-doc/tab (mutually exclusive with index)'),
      at: z.string().optional().describe('Anchor by literal text and insert the page break at the start of the matched range, instead of an index.'),
      occurrence: z.number().int().optional().describe('Use the Nth `at` match (1-based; required when `at` is ambiguous)'),
      matchCase: z.boolean().optional().describe('Case-sensitive `at` matching'),
      tab: z.string().optional().describe('Target a specific tab by title or ID'),
      batch: z.string().optional().describe('Append this mutation to a persisted batch (from gog_batch_begin) instead of applying it — nothing changes in the doc until gog_batch_end submits the batch.'),
      account: accountParam,
    },
  }, async ({ docId, index, atEnd, at, occurrence, matchCase, tab, batch, account }) => {
    const args = ['docs', 'insert-page-break', docId];
    if (index !== undefined) args.push(`--index=${index}`);
    if (atEnd) args.push('--at-end');
    if (at) args.push(`--at=${at}`);
    if (occurrence !== undefined) args.push(`--occurrence=${occurrence}`);
    if (matchCase) args.push('--match-case');
    if (tab) args.push(`--tab=${tab}`);
    if (batch) args.push(`--batch=${batch}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_page_layout', {
    description: 'Toggle the page layout (pageless | pages) of an existing Google Doc. Sibling to the --pageless flag on docs create/write/update for docs that were already created (e.g. by Drive markdown conversion) without the desired layout.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      layout: z.enum(['pageless', 'pages']).optional().describe('Page layout (default: pageless)'),
      pageSize: z.enum(['A4', 'A5', 'Letter', 'Legal', 'Tabloid']).optional().describe('Named page size preset (only applies in paged layout)'),
      pageWidth: z.string().optional().describe('Page width (points by default; supports pt, in, cm, mm — e.g. "8.5in")'),
      pageHeight: z.string().optional().describe('Page height (points by default; supports pt, in, cm, mm)'),
      marginTop: z.string().optional().describe('Top page margin (points by default; supports pt, in, cm, mm)'),
      marginBottom: z.string().optional().describe('Bottom page margin (points by default; supports pt, in, cm, mm)'),
      marginLeft: z.string().optional().describe('Left page margin (points by default; supports pt, in, cm, mm)'),
      marginRight: z.string().optional().describe('Right page margin (points by default; supports pt, in, cm, mm)'),
      account: accountParam,
    },
  }, async ({ docId, layout, pageSize, pageWidth, pageHeight, marginTop, marginBottom, marginLeft, marginRight, account }) => {
    const args = ['docs', 'page-layout', docId];
    if (layout) args.push(`--layout=${layout}`);
    if (pageSize) args.push(`--page-size=${pageSize}`);
    if (pageWidth) args.push(`--page-width=${pageWidth}`);
    if (pageHeight) args.push(`--page-height=${pageHeight}`);
    if (marginTop) args.push(`--margin-top=${marginTop}`);
    if (marginBottom) args.push(`--margin-bottom=${marginBottom}`);
    if (marginLeft) args.push(`--margin-left=${marginLeft}`);
    if (marginRight) args.push(`--margin-right=${marginRight}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_insert_table', {
    description: 'Insert a native Google Docs table via InsertTableRequest, bypassing the markdown writer. Use this instead of writing a markdown table when you need precise dimensions or to avoid the markdown writer\'s table limitations. `valuesJson` is a JSON 2D string array whose dimensions must match rows x cols.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      rows: z.number().int().min(1).describe('Number of rows (>=1)'),
      cols: z.number().int().min(1).describe('Number of columns (>=1)'),
      index: z.number().int().optional().describe('Character index to insert at (1 = beginning). Omit or use atEnd for end-of-doc.'),
      atEnd: z.boolean().optional().describe('Insert at end-of-doc/tab (mutually exclusive with index)'),
      valuesJson: z.string().optional().describe('Cell values as a JSON 2D string array; dimensions must match rows x cols when supplied'),
      tab: z.string().optional().describe('Target a specific tab by title or ID'),
      account: accountParam,
    },
  }, async ({ docId, rows, cols, index, atEnd, valuesJson, tab, account }) => {
    const args = ['docs', 'insert-table', docId, `--rows=${rows}`, `--cols=${cols}`];
    if (index !== undefined) args.push(`--index=${index}`);
    if (atEnd) args.push('--at-end');
    if (valuesJson !== undefined) args.push(`--values-json=${valuesJson}`);
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_cell_update', {
    description: 'Replace (or append to) the content of a single table cell, addressed by table / row / column — non-destructive to the rest of the table, unlike index-based edits that shift on every change. Provide content inline or read it from contentFile. Note: row/col/tableIndex are 1-based here; the sibling gog_docs_cell_style uses 0-based addressing.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      row: z.number().int().describe('1-based row number'),
      col: z.number().int().describe('1-based column number'),
      content: z.string().optional().describe('Replacement content (omit when using contentFile)'),
      contentFile: z.string().optional().describe('Read replacement content from a file instead of content'),
      append: z.boolean().optional().describe('Append inside the cell instead of replacing existing cell content'),
      format: z.enum(['markdown', 'plain']).optional().describe('Content format (default: markdown)'),
      tableIndex: z.number().int().optional().describe('1-based table index in document order; negative counts from the end (default: 1)'),
      tab: z.string().optional().describe('Target a specific tab by title or ID'),
      account: accountParam,
    },
  }, async ({ docId, row, col, content, contentFile, append, format, tableIndex, tab, account }) => {
    const args = ['docs', 'cell-update', docId, `--row=${row}`, `--col=${col}`];
    if (content !== undefined) args.push(`--content=${content}`);
    if (contentFile) args.push(`--content-file=${contentFile}`);
    if (append) args.push('--append');
    if (format) args.push(`--format=${format}`);
    if (tableIndex !== undefined) args.push(`--table-index=${tableIndex}`);
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_cell_style', {
    description: 'Apply background color and/or inline text styling (bold, italic, underline, colors) to one or more table cells, addressed by 0-based row/column with optional spans. Sibling to gog_docs_cell_update, which changes cell content rather than styling. Note: row/col/tableIndex are 0-based here; gog_docs_cell_update uses 1-based addressing.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      row: z.number().int().describe('0-based row number'),
      col: z.number().int().describe('0-based column number'),
      rowSpan: z.number().int().optional().describe('Number of rows to style (default: 1)'),
      colSpan: z.number().int().optional().describe('Number of columns to style (default: 1)'),
      backgroundColor: z.string().optional().describe('Cell background color as #RRGGBB or #RGB'),
      textColor: z.string().optional().describe('Text color as #RRGGBB or #RGB'),
      bold: z.boolean().optional().describe('Set cell text bold'),
      italic: z.boolean().optional().describe('Set cell text italic'),
      underline: z.boolean().optional().describe('Set cell text underline'),
      tableIndex: z.number().int().optional().describe('0-based table index in document order (default: 0)'),
      tab: z.string().optional().describe('Target a specific tab by title or ID'),
      batch: z.string().optional().describe('Append this mutation to a persisted batch (from gog_batch_begin) instead of applying it — nothing changes in the doc until gog_batch_end submits the batch.'),
      account: accountParam,
    },
  }, async ({ docId, row, col, rowSpan, colSpan, backgroundColor, textColor, bold, italic, underline, tableIndex, tab, batch, account }) => {
    const args = ['docs', 'cell-style', docId, `--row=${row}`, `--col=${col}`];
    if (rowSpan !== undefined) args.push(`--row-span=${rowSpan}`);
    if (colSpan !== undefined) args.push(`--col-span=${colSpan}`);
    if (backgroundColor) args.push(`--background-color=${backgroundColor}`);
    if (textColor) args.push(`--text-color=${textColor}`);
    if (bold) args.push('--bold');
    if (italic) args.push('--italic');
    if (underline) args.push('--underline');
    if (tableIndex !== undefined) args.push(`--table-index=${tableIndex}`);
    if (tab) args.push(`--tab=${tab}`);
    if (batch) args.push(`--batch=${batch}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_insert_image', {
    description: 'Insert an image into a Google Doc from a local file or a public HTTPS URL. file: uploaded to Drive, temporarily shared so Docs can fetch it, inserted, then the public permission is revoked. url: inserted directly with no Drive upload or temporary sharing. Replaces placeholder text (at) or appends at end-of-doc.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      file: z.string().optional().describe('Local PNG, JPEG, or GIF image to upload and insert (exactly one of file or url)'),
      url: z.string().optional().describe('Public HTTPS image URL to insert directly — no Drive upload or temporary public sharing (exactly one of file or url)'),
      at: z.string().optional().describe('Placeholder text to replace, or "end" to append (default: end)'),
      width: z.number().optional().describe('Image width in points (default: 468)'),
      height: z.number().optional().describe('Image height in points (optional; width-only preserves aspect ratio)'),
      name: z.string().optional().describe('Override the uploaded Drive filename'),
      parent: z.string().optional().describe('Drive folder ID for the uploaded image'),
      onRestricted: z.enum(['error', 'link']).optional().describe('If public sharing is blocked: error out, or fall back to a linked image (default: error)'),
      tab: z.string().optional().describe('Target a specific tab by title or ID'),
      account: accountParam,
    },
  }, async ({ docId, file, url, at, width, height, name, parent, onRestricted, tab, account }) => {
    const args = ['docs', 'insert-image', docId];
    if (file) args.push(`--file=${file}`);
    if (url) args.push(`--url=${url}`);
    if (at) args.push(`--at=${at}`);
    if (width !== undefined) args.push(`--width=${width}`);
    if (height !== undefined) args.push(`--height=${height}`);
    if (name) args.push(`--name=${name}`);
    if (parent) args.push(`--parent=${parent}`);
    if (onRestricted) args.push(`--on-restricted=${onRestricted}`);
    if (tab) args.push(`--tab=${tab}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_insert_person', {
    description: 'Insert a native Google Docs person smart chip (the interactive @-mention chip) for an email address, at a character index or end-of-doc.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      email: z.string().describe('Email address for the person chip'),
      index: z.number().int().optional().describe('Character index to insert at. Omit or use atEnd for end-of-doc.'),
      atEnd: z.boolean().optional().describe('Insert at end-of-doc/tab (mutually exclusive with index)'),
      at: z.string().optional().describe('Anchor by literal text, delete the match, and insert the person chip there, instead of an index.'),
      occurrence: z.number().int().optional().describe('Use the Nth `at` match (1-based; required when `at` is ambiguous)'),
      matchCase: z.boolean().optional().describe('Case-sensitive `at` matching'),
      tab: z.string().optional().describe('Target a specific tab by title or ID'),
      batch: z.string().optional().describe('Append this mutation to a persisted batch (from gog_batch_begin) instead of applying it — nothing changes in the doc until gog_batch_end submits the batch.'),
      account: accountParam,
    },
  }, async ({ docId, email, index, atEnd, at, occurrence, matchCase, tab, batch, account }) => {
    const args = ['docs', 'insert-person', docId, `--email=${email}`];
    if (index !== undefined) args.push(`--index=${index}`);
    if (atEnd) args.push('--at-end');
    if (at) args.push(`--at=${at}`);
    if (occurrence !== undefined) args.push(`--occurrence=${occurrence}`);
    if (matchCase) args.push('--match-case');
    if (tab) args.push(`--tab=${tab}`);
    if (batch) args.push(`--batch=${batch}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_insert_date_chip', {
    description: 'Insert a native Google Docs date smart chip, at a character index or end-of-doc.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      date: z.string().optional().describe('Date to insert as YYYY-MM-DD (default: today)'),
      format: z.enum(['abbreviated', 'full', 'iso']).optional().describe('Date display format (default: abbreviated)'),
      index: z.number().int().optional().describe('Character index to insert at. Omit or use atEnd for end-of-doc.'),
      atEnd: z.boolean().optional().describe('Insert at end-of-doc/tab (mutually exclusive with index)'),
      tab: z.string().optional().describe('Target a specific tab by title or ID'),
      batch: z.string().optional().describe('Append this mutation to a persisted batch (from gog_batch_begin) instead of applying it — nothing changes in the doc until gog_batch_end submits the batch.'),
      account: accountParam,
    },
  }, async ({ docId, date, format, index, atEnd, tab, batch, account }) => {
    const args = ['docs', 'insert-date-chip', docId];
    if (date) args.push(`--date=${date}`);
    if (format) args.push(`--format=${format}`);
    if (index !== undefined) args.push(`--index=${index}`);
    if (atEnd) args.push('--at-end');
    if (tab) args.push(`--tab=${tab}`);
    if (batch) args.push(`--batch=${batch}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_add_tab', {
    description: 'Add a tab to a Google Doc. Tabs partition a doc into independently-addressable sections (multi-tab docs). Optionally set the title, zero-based position, parent tab (for nesting), and an emoji icon.',
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      title: z.string().optional().describe('User-visible tab title'),
      index: z.number().int().optional().describe('Zero-based tab position within the parent'),
      parentTab: z.string().optional().describe('Parent tab title or ID to nest this tab under'),
      iconEmoji: z.string().optional().describe('Emoji icon for the tab'),
      account: accountParam,
    },
  }, async ({ docId, title, index, parentTab, iconEmoji, account }) => {
    const args = ['docs', 'add-tab', docId];
    if (title) args.push(`--title=${title}`);
    if (index !== undefined) args.push(`--index=${index}`);
    if (parentTab) args.push(`--parent-tab=${parentTab}`);
    if (iconEmoji) args.push(`--icon-emoji=${iconEmoji}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_rename_tab', {
    description: 'Rename a tab in a Google Doc. Identify the existing tab by title or ID and give it a new title.',
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      tab: z.string().describe('Existing tab title or ID to rename'),
      title: z.string().describe('New user-visible tab title'),
      account: accountParam,
    },
  }, async ({ docId, tab, title, account }) => {
    const args = ['docs', 'rename-tab', docId, `--tab=${tab}`, `--title=${title}`];
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_delete_tab', {
    description: 'Delete a tab (and its content) from a Google Doc. Identify the tab by title or ID. This permanently removes the tab and everything in it.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      tab: z.string().describe('Existing tab title or ID to delete'),
      account: accountParam,
    },
  }, async ({ docId, tab, account }) => {
    const args = ['docs', 'delete-tab', docId, `--tab=${tab}`];
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_docs_clear', {
    description: 'Clear all content from a Google Doc, leaving an empty document. The doc itself is preserved (same ID/URL); only its body content is removed. To delete the whole doc instead, use gog_docs_trash.',
    annotations: { destructiveHint: true },
    inputSchema: {
      docId: z.string().describe('Doc ID (from the URL)'),
      account: accountParam,
    },
  }, async ({ docId, account }) => {
    return runOrDiagnose(['docs', 'clear', docId], { account });
  });
}
