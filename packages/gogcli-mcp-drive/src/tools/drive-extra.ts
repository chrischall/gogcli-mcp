import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose } from '../../../gogcli-mcp/src/lib.js';

export function registerExtraDriveTools(server: McpServer): void {
  server.registerTool('gog_drive_download', {
    description: 'Download a Drive file to the local filesystem. For Google Docs formats, specify an export format (pdf, csv, xlsx, pptx, txt, png, docx, md).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      fileId: z.string().describe('File ID to download'),
      out: z.string().optional().describe('Output file path (default: gogcli config dir)'),
      format: z.string().optional().describe('Export format for Google Docs: pdf, csv, xlsx, pptx, txt, png, docx, md (default: inferred)'),
      account: accountParam,
    },
  }, async ({ fileId, out, format, account }) => {
    const args = ['drive', 'download', fileId];
    if (out) args.push(`--out=${out}`);
    if (format) args.push(`--format=${format}`);
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
    return runOrDiagnose(['drive', 'unshare', fileId, permissionId], { account });
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
      account: accountParam,
    },
  }, async ({ fileId, account }) => {
    return runOrDiagnose(['drive', 'comments', 'list', fileId], { account });
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
    return runOrDiagnose(['drive', 'comments', 'delete', fileId, commentId], { account });
  });

  server.registerTool('gog_drive_comments_reply', {
    description: 'Reply to an existing comment on a Drive file.',
    inputSchema: {
      fileId: z.string().describe('File ID'),
      commentId: z.string().describe('Comment ID to reply to'),
      content: z.string().describe('Reply text'),
      account: accountParam,
    },
  }, async ({ fileId, commentId, content, account }) => {
    return runOrDiagnose(['drive', 'comments', 'reply', fileId, commentId, content], { account });
  });
}
