import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { accountParam, runOrDiagnose } from '../../../gogcli-mcp/src/lib.js';

export function registerExtraSlidesTools(server: McpServer): void {
  server.registerTool('gog_slides_create_from_markdown', {
    description: 'Create a new Google Slides presentation from markdown content (inline or from a file).',
    inputSchema: {
      title: z.string().describe('Presentation title'),
      content: z.string().optional().describe('Inline markdown content'),
      contentFile: z.string().optional().describe('Path to a markdown file'),
      parent: z.string().optional().describe('Destination folder ID'),
      debug: z.boolean().optional().describe('Enable debug output'),
      account: accountParam,
    },
  }, async ({ title, content, contentFile, parent, debug, account }) => {
    const args = ['slides', 'create-from-markdown', title];
    if (content) args.push(`--content=${content}`);
    if (contentFile) args.push(`--content-file=${contentFile}`);
    if (parent) args.push(`--parent=${parent}`);
    if (debug) args.push('--debug');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_create_from_template', {
    description: 'Create a new Google Slides presentation from a template, with optional placeholder replacements.',
    inputSchema: {
      templateId: z.string().describe('Template presentation ID'),
      title: z.string().describe('New presentation title'),
      replacements: z.record(z.string(), z.string()).optional().describe('Placeholder replacements as a key/value object (emitted as --replace=k=v for each entry)'),
      replacementsFile: z.string().optional().describe('Path to a JSON file containing replacements'),
      parent: z.string().optional().describe('Destination folder ID'),
      exact: z.boolean().optional().describe('Require exact placeholder matches'),
      account: accountParam,
    },
  }, async ({ templateId, title, replacements, replacementsFile, parent, exact, account }) => {
    const args = ['slides', 'create-from-template', templateId, title];
    if (replacements) {
      for (const [k, v] of Object.entries(replacements)) {
        args.push(`--replace=${k}=${v}`);
      }
    }
    if (replacementsFile) args.push(`--replacements=${replacementsFile}`);
    if (parent) args.push(`--parent=${parent}`);
    if (exact) args.push('--exact');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_add_slide', {
    description: 'Add a new slide to a presentation from a local image, with optional speaker notes.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      image: z.string().describe('Path to the local image file'),
      notes: z.string().optional().describe('Speaker notes text'),
      notesFile: z.string().optional().describe('Path to a file containing speaker notes'),
      before: z.string().optional().describe('Insert before this slide ID (default: append at end)'),
      account: accountParam,
    },
  }, async ({ presentationId, image, notes, notesFile, before, account }) => {
    const args = ['slides', 'add-slide', presentationId, image];
    if (notes) args.push(`--notes=${notes}`);
    if (notesFile) args.push(`--notes-file=${notesFile}`);
    if (before) args.push(`--before=${before}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_delete_slide', {
    description: 'Delete a slide from a Google Slides presentation.',
    annotations: { destructiveHint: true },
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      slideId: z.string().describe('Slide ID to delete'),
      account: accountParam,
    },
  }, async ({ presentationId, slideId, account }) => {
    return runOrDiagnose(['slides', 'delete-slide', presentationId, slideId], { account });
  });

  server.registerTool('gog_slides_update_notes', {
    description: 'Update the speaker notes on a slide (inline text or from a file).',
    annotations: { destructiveHint: true },
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      slideId: z.string().describe('Slide ID'),
      notes: z.string().optional().describe('New speaker notes text'),
      notesFile: z.string().optional().describe('Path to a file containing new speaker notes'),
      account: accountParam,
    },
  }, async ({ presentationId, slideId, notes, notesFile, account }) => {
    const args = ['slides', 'update-notes', presentationId, slideId];
    if (notes) args.push(`--notes=${notes}`);
    if (notesFile) args.push(`--notes-file=${notesFile}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_replace_slide', {
    description: 'Replace the image content of an existing slide, with optional speaker notes.',
    annotations: { destructiveHint: true },
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      slideId: z.string().describe('Slide ID to replace'),
      image: z.string().describe('Path to the new local image file'),
      notes: z.string().optional().describe('Speaker notes text'),
      notesFile: z.string().optional().describe('Path to a file containing speaker notes'),
      account: accountParam,
    },
  }, async ({ presentationId, slideId, image, notes, notesFile, account }) => {
    const args = ['slides', 'replace-slide', presentationId, slideId, image];
    if (notes) args.push(`--notes=${notes}`);
    if (notesFile) args.push(`--notes-file=${notesFile}`);
    return runOrDiagnose(args, { account });
  });
}
