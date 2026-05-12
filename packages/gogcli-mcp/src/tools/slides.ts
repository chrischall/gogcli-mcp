import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose } from './utils.js';

export function registerSlidesTools(server: McpServer): void {
  server.registerTool('gog_slides_export', {
    description: 'Export a Google Slides presentation to a local file (pdf or pptx).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      out: z.string().optional().describe('Output file path'),
      format: z.enum(['pdf', 'pptx']).optional().describe('Export format (default: pptx)'),
      account: accountParam,
    },
  }, async ({ presentationId, out, format, account }) => {
    const args = ['slides', 'export', presentationId];
    if (out) args.push(`--out=${out}`);
    if (format) args.push(`--format=${format}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_info', {
    description: 'Get metadata for a Google Slides presentation (title, ID, slide count, etc.).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      account: accountParam,
    },
  }, async ({ presentationId, account }) => {
    return runOrDiagnose(['slides', 'info', presentationId], { account });
  });

  server.registerTool('gog_slides_create', {
    description: 'Create a new Google Slides presentation, optionally in a folder or copying from a template.',
    inputSchema: {
      title: z.string().describe('Presentation title'),
      parent: z.string().optional().describe('Destination folder ID'),
      template: z.string().optional().describe('Template presentation ID to copy from'),
      account: accountParam,
    },
  }, async ({ title, parent, template, account }) => {
    const args = ['slides', 'create', title];
    if (parent) args.push(`--parent=${parent}`);
    if (template) args.push(`--template=${template}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_copy', {
    description: 'Copy a Google Slides presentation to a new presentation with the given title.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID to copy'),
      title: z.string().describe('Title for the new copy'),
      parent: z.string().optional().describe('Destination folder ID'),
      account: accountParam,
    },
  }, async ({ presentationId, title, parent, account }) => {
    const args = ['slides', 'copy', presentationId, title];
    if (parent) args.push(`--parent=${parent}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_list_slides', {
    description: 'List slides in a Google Slides presentation.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      account: accountParam,
    },
  }, async ({ presentationId, account }) => {
    return runOrDiagnose(['slides', 'list-slides', presentationId], { account });
  });

  server.registerTool('gog_slides_read_slide', {
    description: 'Read the content of a slide (text, shapes, speaker notes).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      slideId: z.string().describe('Slide ID to read'),
      account: accountParam,
    },
  }, async ({ presentationId, slideId, account }) => {
    return runOrDiagnose(['slides', 'read-slide', presentationId, slideId], { account });
  });

  server.registerTool('gog_slides_run', {
    description: 'Run any gog slides subcommand not covered by the other tools. Run `gog slides --help` for the full list of subcommands, or `gog slides <subcommand> --help` for flags on a specific subcommand.',
    inputSchema: {
      subcommand: z.string().describe('The gog slides subcommand to run'),
      args: z.array(z.string()).describe('Additional positional args and flags'),
      account: accountParam,
    },
  }, async ({ subcommand, args, account }) => {
    return runOrDiagnose(['slides', subcommand, ...args], { account });
  });
}
