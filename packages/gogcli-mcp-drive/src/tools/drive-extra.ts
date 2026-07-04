import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose, paginationParams, pushPaginationFlags } from '../../../gogcli-mcp/src/lib.js';

export function registerExtraDriveTools(server: McpServer): void {
  server.registerTool('gog_drive_download', {
    description: 'Download a Drive file to the local filesystem. For Google Docs formats, specify an export format (pdf, csv, xlsx, pptx, txt, png, docx, md).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      fileId: z.string().describe('File ID to download'),
      out: z.string().optional().describe('Output file path (default: gogcli config dir)'),
      format: z.string().optional().describe('Export format for Google Docs: pdf, csv, xlsx, pptx, txt, png, docx, md (default: inferred)'),
      overwrite: z.boolean().optional().describe('Overwrite the output file if it already exists (gog refuses otherwise)'),
      account: accountParam,
    },
  }, async ({ fileId, out, format, overwrite, account }) => {
    const args = ['drive', 'download', fileId];
    if (out) args.push(`--out=${out}`);
    if (format) args.push(`--format=${format}`);
    if (overwrite) args.push('--overwrite');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_upload', {
    description: 'Upload a local file to Drive. Use --replace to replace the content of an existing file (preserves link/permissions), or --convert to auto-convert to a Google format.',
    annotations: { destructiveHint: true },
    inputSchema: {
      localPath: z.string().describe('Path to the local file to upload'),
      name: z.string().optional().describe('Override filename (create) or rename target (replace)'),
      parent: z.string().optional().describe('Destination folder ID (create only)'),
      replace: z.string().optional().describe('Replace content of an existing Drive file ID (preserves link/permissions)'),
      mimeType: z.string().optional().describe('Override MIME type inference'),
      keepRevisionForever: z.boolean().optional().describe('Keep the new head revision forever (binary files only)'),
      convert: z.boolean().optional().describe('Auto-convert to native Google format based on file extension (create only)'),
      convertTo: z.string().optional().describe('Convert to a specific Google format: doc | sheet | slides (create only)'),
      account: accountParam,
    },
  }, async ({ localPath, name, parent, replace, mimeType, keepRevisionForever, convert, convertTo, account }) => {
    const args = ['drive', 'upload', localPath];
    if (name) args.push(`--name=${name}`);
    if (parent) args.push(`--parent=${parent}`);
    if (replace) args.push(`--replace=${replace}`);
    if (mimeType) args.push(`--mime-type=${mimeType}`);
    if (keepRevisionForever) args.push('--keep-revision-forever');
    if (convert) args.push('--convert');
    if (convertTo) args.push(`--convert-to=${convertTo}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_copy', {
    description: 'Copy a Drive file to a new file with the given name.',
    inputSchema: {
      fileId: z.string().describe('File ID to copy'),
      name: z.string().describe('Name for the new copy'),
      parent: z.string().optional().describe('Destination folder ID'),
      account: accountParam,
    },
  }, async ({ fileId, name, parent, account }) => {
    const args = ['drive', 'copy', fileId, name];
    if (parent) args.push(`--parent=${parent}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_url', {
    description: 'Print shareable web URLs for one or more Drive files.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      fileIds: z.array(z.string()).min(1).describe('One or more file IDs to get URLs for'),
      account: accountParam,
    },
  }, async ({ fileIds, account }) => {
    return runOrDiagnose(['drive', 'url', ...fileIds], { account });
  });

  server.registerTool('gog_drive_permissions', {
    description: 'List permissions on a Drive file.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      fileId: z.string().describe('File ID'),
      max: z.number().optional().describe('Max results (default: 100)'),
      page: z.string().optional().describe('Page token'),
      account: accountParam,
    },
  }, async ({ fileId, max, page, account }) => {
    const args = ['drive', 'permissions', fileId];
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_unshare', {
    description: 'Remove a permission from a Drive file. Get the permissionId from gog_drive_permissions.',
    annotations: { destructiveHint: true },
    inputSchema: {
      fileId: z.string().describe('File ID'),
      permissionId: z.string().describe('Permission ID to remove'),
      account: accountParam,
    },
  }, async ({ fileId, permissionId, account }) => {
    return runOrDiagnose(['drive', 'unshare', fileId, permissionId, '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  server.registerTool('gog_drive_drives_list', {
    description: 'List shared drives (Team Drives) accessible to the account.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      max: z.number().optional().describe('Max results (default: 100, max allowed: 100)'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      query: z.string().optional().describe('Search query for filtering shared drives'),
      account: accountParam,
    },
  }, async ({ max, page, all, query, account }) => {
    const args = ['drive', 'drives'];
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    if (query) args.push(`--query=${query}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_comments_list', {
    description: 'List comments on a Drive file.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      fileId: z.string().describe('File ID'),
      since: z.string().optional().describe('Only return comments modified at or after this RFC3339 timestamp (e.g. 2026-06-01T00:00:00Z)'),
      includeQuoted: z.boolean().optional().describe('Include the quoted content each comment is anchored to'),
      ...paginationParams,
      account: accountParam,
    },
  }, async ({ fileId, since, includeQuoted, max, page, all, account }) => {
    const args = ['drive', 'comments', 'list', fileId];
    if (since) args.push(`--since=${since}`);
    if (includeQuoted) args.push('--include-quoted');
    pushPaginationFlags(args, { max, page, all });
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_comments_get', {
    description: 'Get a single comment on a Drive file by ID.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      fileId: z.string().describe('File ID'),
      commentId: z.string().describe('Comment ID'),
      account: accountParam,
    },
  }, async ({ fileId, commentId, account }) => {
    return runOrDiagnose(['drive', 'comments', 'get', fileId, commentId], { account });
  });

  server.registerTool('gog_drive_comments_add', {
    description: 'Add a new comment to a Drive file.',
    inputSchema: {
      fileId: z.string().describe('File ID'),
      content: z.string().describe('Comment text'),
      account: accountParam,
    },
  }, async ({ fileId, content, account }) => {
    return runOrDiagnose(['drive', 'comments', 'create', fileId, content], { account });
  });

  server.registerTool('gog_drive_comments_update', {
    description: 'Update the text of an existing comment.',
    annotations: { destructiveHint: true },
    inputSchema: {
      fileId: z.string().describe('File ID'),
      commentId: z.string().describe('Comment ID to update'),
      content: z.string().describe('New comment text'),
      account: accountParam,
    },
  }, async ({ fileId, commentId, content, account }) => {
    return runOrDiagnose(['drive', 'comments', 'update', fileId, commentId, content], { account });
  });

  server.registerTool('gog_drive_comments_delete', {
    description: 'Delete a comment from a Drive file.',
    annotations: { destructiveHint: true },
    inputSchema: {
      fileId: z.string().describe('File ID'),
      commentId: z.string().describe('Comment ID to delete'),
      account: accountParam,
    },
  }, async ({ fileId, commentId, account }) => {
    return runOrDiagnose(['drive', 'comments', 'delete', fileId, commentId, '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  server.registerTool('gog_drive_comments_reply', {
    description: 'Reply to an existing comment on a Drive file. Pass `action: "resolve"` or `"reopen"` to atomically flip the parent comment\'s resolved state via the Drive API\'s Reply.action field — avoids the older workaround of deleting the comment (which destroys review-thread context).',
    inputSchema: {
      fileId: z.string().describe('File ID'),
      commentId: z.string().describe('Comment ID to reply to'),
      content: z.string().describe('Reply text'),
      action: z.enum(['resolve', 'reopen']).optional().describe('Optional action on the parent comment alongside the reply'),
      account: accountParam,
    },
  }, async ({ fileId, commentId, content, action, account }) => {
    const args = ['drive', 'comments', 'reply', fileId, commentId, content];
    if (action) args.push(`--action=${action}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_comments_resolve', {
    description: 'Resolve a comment on a Drive file (mark as done) without posting a reply. To resolve while replying, use gog_drive_comments_reply with action: "resolve".',
    annotations: { destructiveHint: true },
    inputSchema: {
      fileId: z.string().describe('File ID'),
      commentId: z.string().describe('Comment ID to resolve'),
      account: accountParam,
    },
  }, async ({ fileId, commentId, account }) => {
    return runOrDiagnose(['drive', 'comments', 'resolve', fileId, commentId], { account });
  });

  server.registerTool('gog_drive_comments_reopen', {
    description: 'Reopen a previously resolved comment on a Drive file. To reopen while replying, use gog_drive_comments_reply with action: "reopen".',
    annotations: { destructiveHint: true },
    inputSchema: {
      fileId: z.string().describe('File ID'),
      commentId: z.string().describe('Comment ID to reopen'),
      account: accountParam,
    },
  }, async ({ fileId, commentId, account }) => {
    return runOrDiagnose(['drive', 'comments', 'reopen', fileId, commentId], { account });
  });

  // --- gog 0.19.0 ---

  server.registerTool('gog_drive_du', {
    description: 'Summarize Drive folder sizes (disk-usage style) starting from a folder.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      parent: z.string().optional().describe('Folder ID to start from (default: root)'),
      depth: z.number().optional().describe('Depth for folder totals (default: 1)'),
      max: z.number().optional().describe('Max folders to return (0 = unlimited; default: 50)'),
      sort: z.enum(['size', 'path', 'files']).optional().describe('Sort key (default: size)'),
      order: z.enum(['asc', 'desc']).optional().describe('Sort order (default: desc)'),
      noAllDrives: z.boolean().optional().describe('My Drive only — exclude shared drives (shared drives are included by default)'),
      account: accountParam,
    },
  }, async ({ parent, depth, max, sort, order, noAllDrives, account }) => {
    const args = ['drive', 'du'];
    if (parent) args.push(`--parent=${parent}`);
    if (depth !== undefined) args.push(`--depth=${depth}`);
    if (max !== undefined) args.push(`--max=${max}`);
    if (sort) args.push(`--sort=${sort}`);
    if (order) args.push(`--order=${order}`);
    if (noAllDrives) args.push('--no-all-drives');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_tree', {
    description: 'Print a read-only folder tree starting from a folder.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      parent: z.string().optional().describe('Folder ID to start from (default: root)'),
      depth: z.number().optional().describe('Max depth (0 = unlimited; default: 2)'),
      max: z.number().optional().describe('Max items to return (0 = unlimited; default: 0)'),
      noAllDrives: z.boolean().optional().describe('My Drive only — exclude shared drives (shared drives are included by default)'),
      account: accountParam,
    },
  }, async ({ parent, depth, max, noAllDrives, account }) => {
    const args = ['drive', 'tree'];
    if (parent) args.push(`--parent=${parent}`);
    if (depth !== undefined) args.push(`--depth=${depth}`);
    if (max !== undefined) args.push(`--max=${max}`);
    if (noAllDrives) args.push('--no-all-drives');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_changes_start_token', {
    description: 'Get a Drive changes start page token — the cursor you pass to gog_drive_changes_list to enumerate changes since this point.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      drive: z.string().optional().describe('Shared drive ID for a shared-drive change log'),
      account: accountParam,
    },
  }, async ({ drive, account }) => {
    const args = ['drive', 'changes', 'start-token'];
    if (drive) args.push(`--drive=${drive}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_changes_list', {
    description: 'List Drive changes since a page token (for sync/automation). Get the initial token from gog_drive_changes_start_token; the response includes a newStartPageToken to persist for the next poll.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      token: z.string().describe('Start page token or next page token'),
      max: z.number().optional().describe('Max results (default: 100)'),
      page: z.string().optional().describe('Alias for token when continuing a page'),
      all: z.boolean().optional().describe('Fetch all pages'),
      includeRemoved: z.boolean().optional().describe('Include removed changes'),
      drive: z.string().optional().describe('Shared drive ID for a shared-drive change log'),
      account: accountParam,
    },
  }, async ({ token, max, page, all, includeRemoved, drive, account }) => {
    const args = ['drive', 'changes', 'list', `--token=${token}`];
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    if (includeRemoved) args.push('--include-removed');
    if (drive) args.push(`--drive=${drive}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_revisions_list', {
    description: 'List a file\'s revision history — paged revision metadata plus provider export links for each revision.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      fileId: z.string().describe('File ID'),
      ...paginationParams,
      account: accountParam,
    },
  }, async ({ fileId, max, page, all, account }) => {
    const args = ['drive', 'revisions', 'list', fileId];
    pushPaginationFlags(args, { max, page, all });
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_revisions_get', {
    description: 'Get one revision of a Drive file by revision ID (metadata + export links). Find revision IDs with gog_drive_revisions_list.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      fileId: z.string().describe('File ID'),
      revisionId: z.string().describe('Revision ID'),
      account: accountParam,
    },
  }, async ({ fileId, revisionId, account }) => {
    return runOrDiagnose(['drive', 'revisions', 'get', fileId, revisionId], { account });
  });

  server.registerTool('gog_drive_shortcut_create', {
    description: 'Create a Drive shortcut to a file or folder inside a destination folder. Shortcuts are classified distinctly in listing/tree output and are never followed by tree scans.',
    inputSchema: {
      targetId: z.string().describe('File or folder ID the shortcut points to'),
      parent: z.string().describe('Destination folder ID for the shortcut'),
      name: z.string().optional().describe('Shortcut name (default: the target\'s name)'),
      account: accountParam,
    },
  }, async ({ targetId, parent, name, account }) => {
    const args = ['drive', 'shortcut', 'create', targetId, `--parent=${parent}`];
    if (name) args.push(`--name=${name}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_labels_list', {
    description: 'List Drive label schemas available to the account.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      language: z.string().optional().describe('BCP-47 language code'),
      view: z.enum(['LABEL_VIEW_BASIC', 'LABEL_VIEW_FULL']).optional().describe('Label view (default: LABEL_VIEW_BASIC)'),
      minimumRole: z.string().optional().describe('Minimum role filter (e.g. READER, APPLIER, ORGANIZER)'),
      publishedOnly: z.boolean().optional().describe('Only list published labels'),
      adminAccess: z.boolean().optional().describe('Use admin access for Workspace admin accounts'),
      account: accountParam,
    },
  }, async ({ language, view, minimumRole, publishedOnly, adminAccess, account }) => {
    const args = ['drive', 'labels', 'list'];
    if (language) args.push(`--language=${language}`);
    if (view) args.push(`--view=${view}`);
    if (minimumRole) args.push(`--minimum-role=${minimumRole}`);
    if (publishedOnly) args.push('--published-only');
    if (adminAccess) args.push('--admin-access');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_labels_get', {
    description: 'Get a single Drive label schema by name (e.g. "labels/abc123").',
    annotations: { readOnlyHint: true },
    inputSchema: {
      name: z.string().describe('Label schema name (e.g. labels/abc123)'),
      language: z.string().optional().describe('BCP-47 language code'),
      view: z.enum(['LABEL_VIEW_BASIC', 'LABEL_VIEW_FULL']).optional().describe('Label view (default: LABEL_VIEW_FULL)'),
      adminAccess: z.boolean().optional().describe('Use admin access for Workspace admin accounts'),
      account: accountParam,
    },
  }, async ({ name, language, view, adminAccess, account }) => {
    const args = ['drive', 'labels', 'get', name];
    if (language) args.push(`--language=${language}`);
    if (view) args.push(`--view=${view}`);
    if (adminAccess) args.push('--admin-access');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_labels_file_list', {
    description: 'List labels applied to a Drive file.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      fileId: z.string().describe('File ID'),
      max: z.number().optional().describe('Max results (default: 100)'),
      page: z.string().optional().describe('Page token'),
      account: accountParam,
    },
  }, async ({ fileId, max, page, account }) => {
    const args = ['drive', 'labels', 'file', 'list', fileId];
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_labels_file_apply', {
    description: 'Apply or update a label on a Drive file, optionally setting field values. Each field flag takes "fieldId=value" entries (repeatable). selection/integer/date/user values may be comma-separated within one entry for multi-valued fields.',
    inputSchema: {
      fileId: z.string().describe('File ID'),
      labelId: z.string().describe('Label ID to apply'),
      text: z.array(z.string()).optional().describe('Text fields as fieldId=value (repeatable)'),
      selection: z.array(z.string()).optional().describe('Selection fields as fieldId=choiceId[,choiceId] (repeatable)'),
      integer: z.array(z.string()).optional().describe('Integer fields as fieldId=123[,456] (repeatable)'),
      date: z.array(z.string()).optional().describe('Date fields as fieldId=YYYY-MM-DD[,YYYY-MM-DD] (repeatable)'),
      user: z.array(z.string()).optional().describe('User fields as fieldId=email[,email] (repeatable)'),
      unset: z.array(z.string()).optional().describe('Field IDs to unset (repeatable)'),
      fieldsJson: z.string().optional().describe('Simple JSON object of fieldId to string/number/bool/string-array values'),
      account: accountParam,
    },
  }, async ({ fileId, labelId, text, selection, integer, date, user, unset, fieldsJson, account }) => {
    const args = ['drive', 'labels', 'file', 'apply', fileId, labelId];
    if (text) for (const t of text) args.push(`--text=${t}`);
    if (selection) for (const s of selection) args.push(`--selection=${s}`);
    if (integer) for (const i of integer) args.push(`--integer=${i}`);
    if (date) for (const d of date) args.push(`--date=${d}`);
    if (user) for (const u of user) args.push(`--user=${u}`);
    if (unset) for (const u of unset) args.push(`--unset=${u}`);
    if (fieldsJson) args.push(`--fields-json=${fieldsJson}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_labels_file_remove', {
    description: 'Remove a label from a Drive file.',
    annotations: { destructiveHint: true },
    inputSchema: {
      fileId: z.string().describe('File ID'),
      labelId: z.string().describe('Label ID to remove'),
      account: accountParam,
    },
  }, async ({ fileId, labelId, account }) => {
    return runOrDiagnose(['drive', 'labels', 'file', 'remove', fileId, labelId, '--force'], { account }); // gog gates this op; without --force the runner's --no-input makes it refuse
  });

  server.registerTool('gog_drive_activity', {
    description: 'Query the Drive Activity API for audit events (edits, creates, deletes, moves, shares, etc.) scoped to a file or folder and/or time range.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      file: z.string().optional().describe('Drive file ID to query'),
      folder: z.string().optional().describe('Drive folder ID; includes descendants'),
      actions: z.string().optional().describe('Comma-separated action filters: edit,create,delete,move,rename,restore,comment,share,label,dlp,reference,settings'),
      from: z.string().optional().describe('Lower activity time bound (RFC3339)'),
      to: z.string().optional().describe('Upper activity time bound (RFC3339)'),
      filter: z.string().optional().describe('Raw Drive Activity filter expression appended with AND'),
      max: z.number().optional().describe('Page size (default: 10)'),
      page: z.string().optional().describe('Page token'),
      all: z.boolean().optional().describe('Fetch all pages'),
      consolidate: z.boolean().optional().describe('Use Drive Activity legacy consolidation strategy'),
      account: accountParam,
    },
  }, async ({ file, folder, actions, from, to, filter, max, page, all, consolidate, account }) => {
    const args = ['drive', 'activity', 'query'];
    if (file) args.push(`--file=${file}`);
    if (folder) args.push(`--folder=${folder}`);
    if (actions) args.push(`--actions=${actions}`);
    if (from) args.push(`--from=${from}`);
    if (to) args.push(`--to=${to}`);
    if (filter) args.push(`--filter=${filter}`);
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (all) args.push('--all');
    if (consolidate) args.push('--consolidate');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_audit_sharing', {
    description: 'Audit Drive sharing without mutation — find public (anyone-with-link) or external permissions across a folder tree or a single file.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      file: z.string().optional().describe('Audit one file ID instead of a folder tree'),
      parent: z.string().optional().describe('Folder ID to scan (default: root)'),
      depth: z.number().optional().describe('Max folder depth (0 = unlimited; default: 2)'),
      max: z.number().optional().describe('Max files/folders to scan (0 = unlimited; default: 500)'),
      internalDomain: z.array(z.string()).optional().describe('Domains treated as internal (defaults to account email domain)'),
      publicOnly: z.boolean().optional().describe('Only report anyone-with-link/public permissions'),
      externalOnly: z.boolean().optional().describe('Only report external user/group/domain permissions'),
      noAllDrives: z.boolean().optional().describe('My Drive only — exclude shared drives (shared drives are included by default)'),
      account: accountParam,
    },
  }, async ({ file, parent, depth, max, internalDomain, publicOnly, externalOnly, noAllDrives, account }) => {
    const args = ['drive', 'audit', 'sharing'];
    if (file) args.push(`--file=${file}`);
    if (parent) args.push(`--parent=${parent}`);
    if (depth !== undefined) args.push(`--depth=${depth}`);
    if (max !== undefined) args.push(`--max=${max}`);
    if (internalDomain) for (const d of internalDomain) args.push(`--internal-domain=${d}`);
    if (publicOnly) args.push('--public-only');
    if (externalOnly) args.push('--external-only');
    if (noAllDrives) args.push('--no-all-drives');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_audit_user', {
    description: 'Audit Drive sharing without mutation — find permissions granted to a specific user across a folder tree or a single file.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      user: z.string().describe('User email to audit permissions for'),
      file: z.string().optional().describe('Audit one file ID instead of a folder tree'),
      parent: z.string().optional().describe('Folder ID to scan (default: root)'),
      depth: z.number().optional().describe('Max folder depth (0 = unlimited; default: 2)'),
      max: z.number().optional().describe('Max files/folders to scan (0 = unlimited; default: 500)'),
      noAllDrives: z.boolean().optional().describe('My Drive only — exclude shared drives (shared drives are included by default)'),
      account: accountParam,
    },
  }, async ({ user, file, parent, depth, max, noAllDrives, account }) => {
    const args = ['drive', 'audit', 'user', user];
    if (file) args.push(`--file=${file}`);
    if (parent) args.push(`--parent=${parent}`);
    if (depth !== undefined) args.push(`--depth=${depth}`);
    if (max !== undefined) args.push(`--max=${max}`);
    if (noAllDrives) args.push('--no-all-drives');
    return runOrDiagnose(args, { account });
  });
}
