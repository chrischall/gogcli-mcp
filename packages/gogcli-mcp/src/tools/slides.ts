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
