import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose } from './utils.js';

export function registerDriveTools(server: McpServer): void {
  server.registerTool('gog_drive_ls', {
    description: 'List files in a Google Drive folder (default: root).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      folderId: z.string().optional().describe('Folder ID to list (default: root)'),
      max: z.number().optional().describe('Max results (default: 20)'),
      page: z.string().optional().describe('Page token for pagination'),
      query: z.string().optional().describe('Drive query filter (e.g. "name contains \'budget\'")'),
      allDrives: z.boolean().optional().describe('Include shared drives (default: true). Set false for My Drive only.'),
      account: accountParam,
    },
  }, async ({ folderId, max, page, query, allDrives, account }) => {
    const args = ['drive', 'ls'];
    if (folderId) args.push(`--parent=${folderId}`);
    if (max !== undefined) args.push(`--max=${max}`);
    if (page) args.push(`--page=${page}`);
    if (query) args.push(`--query=${query}`);
    if (allDrives === false) args.push('--no-all-drives');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_search', {
    description: 'Search Google Drive files by full-text query.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe('Search query'),
      account: accountParam,
    },
  }, async ({ query, account }) => {
    return runOrDiagnose(['drive', 'search', query], { account });
  });

  server.registerTool('gog_drive_get', {
    description: 'Get metadata for a Google Drive file.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      fileId: z.string().describe('File ID'),
      account: accountParam,
    },
  }, async ({ fileId, account }) => {
    return runOrDiagnose(['drive', 'get', fileId], { account });
  });

  server.registerTool('gog_drive_mkdir', {
    description: 'Create a new folder in Google Drive.',
    annotations: { destructiveHint: false },
    inputSchema: {
      name: z.string().describe('Folder name'),
      account: accountParam,
    },
  }, async ({ name, account }) => {
    return runOrDiagnose(['drive', 'mkdir', name], { account });
  });

  server.registerTool('gog_drive_rename', {
    description: 'Rename a file or folder in Google Drive.',
    annotations: { destructiveHint: true },
    inputSchema: {
      fileId: z.string().describe('File or folder ID'),
      newName: z.string().describe('New name'),
      account: accountParam,
    },
  }, async ({ fileId, newName, account }) => {
    return runOrDiagnose(['drive', 'rename', fileId, newName], { account });
  });

  server.registerTool('gog_drive_move', {
    description: 'Move a file to a different folder in Google Drive.',
    annotations: { destructiveHint: true },
    inputSchema: {
      fileId: z.string().describe('File ID to move'),
      parentId: z.string().describe('Destination folder ID'),
      account: accountParam,
    },
  }, async ({ fileId, parentId, account }) => {
    return runOrDiagnose(['drive', 'move', fileId, `--parent=${parentId}`], { account });
  });

  server.registerTool('gog_drive_delete', {
    description: 'Move a Google Drive file to trash, or permanently delete it with permanent=true (irreversible).',
    annotations: { destructiveHint: true },
    inputSchema: {
      fileId: z.string().describe('File ID to delete'),
      permanent: z.boolean().optional().describe('Permanently delete instead of moving to trash (irreversible)'),
      account: accountParam,
    },
  }, async ({ fileId, permanent, account }) => {
    const args = ['drive', 'delete', fileId];
    if (permanent) args.push('--permanent');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_share', {
    description: 'Share a Google Drive file or folder.',
    annotations: { destructiveHint: true },
    inputSchema: {
      fileId: z.string().describe('File or folder ID'),
      to: z.enum(['user', 'anyone', 'domain']).describe('Share target type'),
      email: z.string().optional().describe('User email (required when to=user)'),
      domain: z.string().optional().describe('Domain (required when to=domain)'),
      role: z.enum(['reader', 'writer']).optional().describe('Permission role (default: reader)'),
      account: accountParam,
    },
  }, async ({ fileId, to, email, domain, role, account }) => {
    const args = ['drive', 'share', fileId, `--to=${to}`];
    if (email) args.push(`--email=${email}`);
    if (domain) args.push(`--domain=${domain}`);
    if (role) args.push(`--role=${role}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_run', {
    description: 'Run any gog drive subcommand not covered by the other tools. Run `gog drive --help` for the full list of subcommands, or `gog drive <subcommand> --help` for flags on a specific subcommand.',
    annotations: { destructiveHint: true },
    inputSchema: {
      subcommand: z.string().describe('The gog drive subcommand to run, e.g. "copy", "upload", "download", "permissions"'),
      args: z.array(z.string()).describe('Additional positional args and flags'),
      account: accountParam,
    },
  }, async ({ subcommand, args, account }) => {
    return runOrDiagnose(['drive', subcommand, ...args], { account });
  });
}
