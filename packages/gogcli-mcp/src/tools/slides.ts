import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { accountParam, runOrDiagnose, registerRunTool } from './utils.js';
import { pos } from '../argv.js';
import { confinePath } from '../file-roots.js';
import type { GogArg } from '../runner.js';

export function registerSlidesTools(server: McpServer): void {
  server.registerTool('gog_slides_export', {
    description: 'Export a Google Slides presentation to a local file (pdf or pptx). The out path must be inside the server\'s GOG_FILE_ROOTS directories.',
    // Writes a file on the gog host and can overwrite one: not read-only.
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: z.object({
      presentationId: z.string().describe('Presentation ID'),
      out: z.string().optional().describe('Output file path'),
      format: z.enum(['pdf', 'pptx']).optional().describe('Export format (default: pptx)'),
      overwrite: z.boolean().optional().describe('Overwrite the output file if it already exists (gog refuses otherwise)'),
      account: accountParam,
    }),
  }, async ({ presentationId, out, format, overwrite, account }) => {
    if (out) confinePath(out, 'out');
    const args: GogArg[] = ['slides', 'export', pos(presentationId)];
    if (out) args.push(`--out=${out}`);
    if (format) args.push(`--format=${format}`);
    if (overwrite) args.push('--overwrite');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_info', {
    description: 'Get metadata for a Google Slides presentation (title, ID, slide count, etc.).',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      presentationId: z.string().describe('Presentation ID'),
      account: accountParam,
    }),
  }, async ({ presentationId, account }) => {
    return runOrDiagnose(['slides', 'info', pos(presentationId)], { account });
  });

  server.registerTool('gog_slides_create', {
    description: 'Create a new Google Slides presentation, optionally in a folder or copying from a template.',
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      title: z.string().describe('Presentation title'),
      parent: z.string().optional().describe('Destination folder ID'),
      template: z.string().optional().describe('Template presentation ID to copy from'),
      account: accountParam,
    }),
  }, async ({ title, parent, template, account }) => {
    const args: GogArg[] = ['slides', 'create', pos(title)];
    if (parent) args.push(`--parent=${parent}`);
    if (template) args.push(`--template=${template}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_copy', {
    description: 'Copy a Google Slides presentation to a new presentation with the given title.',
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      presentationId: z.string().describe('Presentation ID to copy'),
      title: z.string().describe('Title for the new copy'),
      parent: z.string().optional().describe('Destination folder ID'),
      account: accountParam,
    }),
  }, async ({ presentationId, title, parent, account }) => {
    const args: GogArg[] = ['slides', 'copy', pos(presentationId), pos(title)];
    if (parent) args.push(`--parent=${parent}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_list_slides', {
    description: 'List slides in a Google Slides presentation.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      presentationId: z.string().describe('Presentation ID'),
      account: accountParam,
    }),
  }, async ({ presentationId, account }) => {
    return runOrDiagnose(['slides', 'list-slides', pos(presentationId)], { account });
  });

  server.registerTool('gog_slides_read_slide', {
    description: 'Read the content of a slide (text, shapes, speaker notes). Set detail=true to also include normalized element geometry, styled text runs, paragraphs, table-cell content, and image source URLs.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      presentationId: z.string().describe('Presentation ID'),
      slideId: z.string().describe('Slide ID to read'),
      detail: z.boolean().optional().describe('Include normalized element geometry, styled text runs, paragraphs, table-cell content, and image source URLs'),
      account: accountParam,
    }),
  }, async ({ presentationId, slideId, detail, account }) => {
    const args: GogArg[] = ['slides', 'read-slide', pos(presentationId), pos(slideId)];
    if (detail) args.push('--detail');
    return runOrDiagnose(args, { account });
  });

  registerRunTool(server, { service: 'slides', examples: '"add-slide", "delete-slide", "update-notes"' });
}
