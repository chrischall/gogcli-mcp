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

  server.registerTool('gog_slides_insert_image', {
    description: 'Place an image on an existing slide at a given size and position, from a local file (image) or a public HTTPS URL (url — no Drive upload or sharing required). Unlike gog_slides_add_slide (which creates a new full-bleed image slide), this inserts onto a slide you already have. width is required; omit height to keep aspect ratio when using a local file (gog requires both width and height when using url).',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      slideId: z.string().describe('Slide ID (object ID of the target slide)'),
      image: z.string().optional().describe('Path to the local image file (exactly one of image or url)'),
      url: z.string().optional().describe('Public HTTPS image URL to insert directly — no Drive upload or sharing (exactly one of image or url). gog requires both width and height with url.'),
      width: z.number().describe('Image width, in unit'),
      height: z.number().optional().describe('Image height, in unit; omit to keep the image\'s aspect ratio (required when using url)'),
      x: z.number().optional().describe('Left position of the image, in unit'),
      y: z.number().optional().describe('Top position of the image, in unit'),
      unit: z.enum(['PT', 'EMU']).optional().describe('Measurement unit for x/y/width/height (default: PT)'),
      account: accountParam,
    },
  }, async ({ presentationId, slideId, image, url, width, height, x, y, unit, account }) => {
    const args = ['slides', 'insert-image', presentationId, slideId];
    if (image) args.push(image);
    args.push(`--width=${width}`);
    if (url) args.push(`--url=${url}`);
    if (height !== undefined) args.push(`--height=${height}`);
    if (x !== undefined) args.push(`--x=${x}`);
    if (y !== undefined) args.push(`--y=${y}`);
    if (unit) args.push(`--unit=${unit}`);
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
    // --force: gog refuses this delete under the runner's --no-input without it.
    return runOrDiagnose(['slides', 'delete-slide', presentationId, slideId, '--force'], { account });
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
    description: 'Replace the image content of an existing slide, from a local file (image) or a public HTTPS URL (url — no Drive upload or sharing required), with optional speaker notes.',
    annotations: { destructiveHint: true },
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      slideId: z.string().describe('Slide ID to replace'),
      image: z.string().optional().describe('Path to the new local image file (exactly one of image or url)'),
      url: z.string().optional().describe('Public HTTPS image URL to use directly — no Drive upload or sharing (exactly one of image or url)'),
      notes: z.string().optional().describe('Speaker notes text'),
      notesFile: z.string().optional().describe('Path to a file containing speaker notes'),
      account: accountParam,
    },
  }, async ({ presentationId, slideId, image, url, notes, notesFile, account }) => {
    const args = ['slides', 'replace-slide', presentationId, slideId];
    if (image) args.push(image);
    if (url) args.push(`--url=${url}`);
    if (notes) args.push(`--notes=${notes}`);
    if (notesFile) args.push(`--notes-file=${notesFile}`);
    return runOrDiagnose(args, { account });
  });

  // --- gog 0.29 reads ---

  server.registerTool('gog_slides_raw', {
    description: 'Dump the raw Google Slides API response (Presentations.Get) as JSON — lossless presentation metadata including every page, element, and style. Use gog_slides_read_slide for a friendlier per-slide view.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      pretty: z.boolean().optional().describe('Pretty-print the JSON (default: compact single line)'),
      account: accountParam,
    },
  }, async ({ presentationId, pretty, account }) => {
    const args = ['slides', 'raw', presentationId];
    if (pretty) args.push('--pretty');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_locate', {
    description: 'Locate literal text in a presentation\'s shapes and table cells, returning the containing element object IDs and UTF-16 ranges needed for gog_slides_style_text / gog_slides_link / gog_slides_bullets / gog_slides_insert_text. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      text: z.string().describe('Literal text to locate'),
      page: z.string().optional().describe('Limit matches to one slide object ID'),
      occurrence: z.number().int().optional().describe('Return the Nth occurrence (1-based; default: first)'),
      all: z.boolean().optional().describe('Return all matches instead of just one'),
      matchCase: z.boolean().optional().describe('Case-sensitive matching'),
      failEmpty: z.boolean().optional().describe('Treat no matches as an error instead of returning an empty result'),
      account: accountParam,
    },
  }, async ({ presentationId, text, page, occurrence, all, matchCase, failEmpty, account }) => {
    const args = ['slides', 'locate', presentationId, text];
    if (page) args.push(`--page=${page}`);
    if (occurrence !== undefined) args.push(`--occurrence=${occurrence}`);
    if (all) args.push('--all');
    if (matchCase) args.push('--match-case');
    if (failEmpty) args.push('--fail-empty');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_thumbnail', {
    description: 'Get or download a rendered thumbnail image for a single slide.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      slideId: z.string().describe('Slide object ID'),
      format: z.enum(['png', 'jpeg']).optional().describe('Thumbnail image format'),
      size: z.enum(['small', 'medium', 'large']).optional().describe('Thumbnail size'),
      out: z.string().optional().describe('Write the thumbnail image to a local file'),
      overwrite: z.boolean().optional().describe('Overwrite the output file if it already exists'),
      account: accountParam,
    },
  }, async ({ presentationId, slideId, format, size, out, overwrite, account }) => {
    const args = ['slides', 'thumbnail', presentationId, slideId];
    if (format) args.push(`--format=${format}`);
    if (size) args.push(`--size=${size}`);
    if (out) args.push(`--out=${out}`);
    if (overwrite) args.push('--overwrite');
    return runOrDiagnose(args, { account });
  });

  // --- gog 0.29 slide management ---

  server.registerTool('gog_slides_new_slide', {
    description: 'Create a new native themed slide with a predefined layout (default BLANK) or an exact presentation layout object ID, at a zero-based insertion index.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      layout: z.enum(['BIG_NUMBER', 'BLANK', 'CAPTION_ONLY', 'MAIN_POINT', 'ONE_COLUMN_TEXT', 'SECTION_HEADER', 'SECTION_TITLE_AND_DESCRIPTION', 'TITLE', 'TITLE_AND_BODY', 'TITLE_AND_TWO_COLUMNS', 'TITLE_ONLY']).optional().describe('Predefined slide layout (default: BLANK). Mutually exclusive with layoutId.'),
      layoutId: z.string().optional().describe('Exact presentation layout object ID (from gog_slides_info --json). Mutually exclusive with layout.'),
      index: z.number().int().optional().describe('Zero-based insertion index for the new slide'),
      account: accountParam,
    },
  }, async ({ presentationId, layout, layoutId, index, account }) => {
    const args = ['slides', 'new-slide', presentationId];
    if (layout) args.push(`--layout=${layout}`);
    if (layoutId) args.push(`--layout-id=${layoutId}`);
    if (index !== undefined) args.push(`--index=${index}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_duplicate_slide', {
    description: 'Duplicate a slide by object ID, optionally placing the copy at a zero-based insertion index.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      slideId: z.string().describe('Slide object ID to duplicate'),
      toIndex: z.number().int().optional().describe('Zero-based insertion index for the duplicated slide'),
      account: accountParam,
    },
  }, async ({ presentationId, slideId, toIndex, account }) => {
    const args = ['slides', 'duplicate-slide', presentationId, slideId];
    if (toIndex !== undefined) args.push(`--to-index=${toIndex}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_move_slide', {
    description: 'Move a slide to a zero-based insertion index within the presentation.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      slideId: z.string().describe('Slide object ID to move'),
      toIndex: z.number().int().describe('Zero-based insertion index where the slide should be moved'),
      account: accountParam,
    },
  }, async ({ presentationId, slideId, toIndex, account }) => {
    return runOrDiagnose(['slides', 'move-slide', presentationId, slideId, `--to-index=${toIndex}`], { account });
  });

  // --- gog 0.29 text authoring ---

  server.registerTool('gog_slides_insert_text', {
    description: 'Insert text into an existing page element (shape or table cell) by object ID. Target a table cell with zero-based row + col. Use replace=true to clear the element\'s existing text first.',
    annotations: { destructiveHint: true },
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      objectId: z.string().describe('Object ID of the target shape or table'),
      text: z.string().describe('Text to insert'),
      row: z.number().int().optional().describe('0-based table row index for cell-targeted text (requires col)'),
      col: z.number().int().optional().describe('0-based table column index for cell-targeted text (requires row)'),
      insertionIndex: z.number().int().optional().describe('Zero-based index where text is inserted within the element\'s existing text'),
      replace: z.boolean().optional().describe('Clear the element\'s existing text before inserting'),
      account: accountParam,
    },
  }, async ({ presentationId, objectId, text, row, col, insertionIndex, replace, account }) => {
    const args = ['slides', 'insert-text', presentationId, objectId, text];
    if (row !== undefined) args.push(`--row=${row}`);
    if (col !== undefined) args.push(`--col=${col}`);
    if (insertionIndex !== undefined) args.push(`--insertion-index=${insertionIndex}`);
    if (replace) args.push('--replace');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_style_text', {
    description: 'Apply range-scoped text styling to one page element. range is a UTF-16 start:end span (use gog_slides_locate to find it). Boolean flags set the attribute; the no* flags clear it.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      objectId: z.string().describe('Object ID of the shape or table cell containing the text'),
      range: z.string().describe('UTF-16 text range as start:end'),
      font: z.string().optional().describe('Font family (e.g. Arial, Georgia)'),
      size: z.number().optional().describe('Font size in points'),
      textColor: z.string().optional().describe('Text color as #RRGGBB or #RGB'),
      bold: z.boolean().optional().describe('Set bold'),
      noBold: z.boolean().optional().describe('Clear bold'),
      italic: z.boolean().optional().describe('Set italic'),
      noItalic: z.boolean().optional().describe('Clear italic'),
      underline: z.boolean().optional().describe('Set underline'),
      noUnderline: z.boolean().optional().describe('Clear underline'),
      account: accountParam,
    },
  }, async ({ presentationId, objectId, range, font, size, textColor, bold, noBold, italic, noItalic, underline, noUnderline, account }) => {
    const args = ['slides', 'style-text', presentationId, objectId, `--range=${range}`];
    if (font) args.push(`--font=${font}`);
    if (size !== undefined) args.push(`--size=${size}`);
    if (textColor) args.push(`--text-color=${textColor}`);
    if (bold) args.push('--bold');
    if (noBold) args.push('--no-bold');
    if (italic) args.push('--italic');
    if (noItalic) args.push('--no-italic');
    if (underline) args.push('--underline');
    if (noUnderline) args.push('--no-underline');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_link', {
    description: 'Apply or clear a hyperlink on a UTF-16 text range in one page element. Provide url to set the link, or clear=true to remove it.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      objectId: z.string().describe('Object ID of the shape or table cell containing the text'),
      range: z.string().describe('UTF-16 text range as start:end'),
      url: z.string().optional().describe('External URL to apply as the hyperlink'),
      clear: z.boolean().optional().describe('Remove the hyperlink from the selected range'),
      account: accountParam,
    },
  }, async ({ presentationId, objectId, range, url, clear, account }) => {
    const args = ['slides', 'link', presentationId, objectId, `--range=${range}`];
    if (url) args.push(`--url=${url}`);
    if (clear) args.push('--clear');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_bullets', {
    description: 'Turn paragraph bullets on or off for a UTF-16 paragraph range in one page element. Use on (optionally with a preset glyph) or off.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      objectId: z.string().describe('Object ID of the shape or table cell containing the paragraphs'),
      range: z.string().describe('UTF-16 paragraph range as start:end'),
      on: z.boolean().optional().describe('Turn bullets on for the selected paragraphs'),
      off: z.boolean().optional().describe('Turn bullets off for the selected paragraphs'),
      preset: z.string().optional().describe('Slides bullet glyph preset to use with on (e.g. BULLET_DISC_CIRCLE_SQUARE)'),
      account: accountParam,
    },
  }, async ({ presentationId, objectId, range, on, off, preset, account }) => {
    const args = ['slides', 'bullets', presentationId, objectId, `--range=${range}`];
    if (on) args.push('--on');
    if (off) args.push('--off');
    if (preset) args.push(`--preset=${preset}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_replace_text', {
    description: 'Find-and-replace text within an explicit scope. You MUST choose a scope — restrict to a single shape (object), one or more slides (pages), or the entire presentation (all=true). There is no whole-deck default; gog rejects the call if no scope is given.',
    annotations: { destructiveHint: true },
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      find: z.string().describe('Text to find'),
      replacement: z.string().describe('Replacement text'),
      object: z.string().optional().describe('Scope: restrict replacement to a single shape text object ID'),
      pages: z.array(z.string()).optional().describe('Scope: restrict replacement to these slide object IDs (repeatable)'),
      all: z.boolean().optional().describe('Scope: replace matching text across the entire presentation'),
      matchCase: z.boolean().optional().describe('Case-sensitive match (default: false)'),
      account: accountParam,
    },
  }, async ({ presentationId, find, replacement, object, pages, all, matchCase, account }) => {
    const args = ['slides', 'replace-text', presentationId, find, replacement];
    if (object) args.push(`--object=${object}`);
    if (pages) for (const p of pages) args.push(`--page=${p}`);
    if (all) args.push('--all');
    if (matchCase) args.push('--match-case');
    return runOrDiagnose(args, { account });
  });

  // --- gog 0.29 native shapes & lines (element subtree) ---

  server.registerTool('gog_slides_element_create_shape', {
    description: 'Create a native shape on a slide. type is a Slides shape type (e.g. RECTANGLE, TEXT_BOX, ELLIPSE, ROUND_RECTANGLE). Position/size are in unit (default PT).',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      slideId: z.string().describe('Slide object ID to create the shape on'),
      type: z.string().optional().describe('Slides shape type (e.g. RECTANGLE, TEXT_BOX, ELLIPSE)'),
      x: z.number().optional().describe('Left position'),
      y: z.number().optional().describe('Top position'),
      width: z.number().optional().describe('Shape width'),
      height: z.number().optional().describe('Shape height'),
      unit: z.enum(['PT', 'EMU']).optional().describe('Geometry unit (default: PT)'),
      objectId: z.string().optional().describe('Optional stable object ID (5-50 chars: letters, digits, _, -, :)'),
      account: accountParam,
    },
  }, async ({ presentationId, slideId, type, x, y, width, height, unit, objectId, account }) => {
    const args = ['slides', 'element', 'create-shape', presentationId, slideId];
    if (type) args.push(`--type=${type}`);
    if (x !== undefined) args.push(`--x=${x}`);
    if (y !== undefined) args.push(`--y=${y}`);
    if (width !== undefined) args.push(`--width=${width}`);
    if (height !== undefined) args.push(`--height=${height}`);
    if (unit) args.push(`--unit=${unit}`);
    if (objectId) args.push(`--object-id=${objectId}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_element_create_line', {
    description: 'Create a native line on a slide. category is the connector routing (STRAIGHT, BENT, CURVED). Start position and extent are in unit (default PT).',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      slideId: z.string().describe('Slide object ID to create the line on'),
      category: z.enum(['STRAIGHT', 'BENT', 'CURVED']).optional().describe('Line category / routing (default: STRAIGHT)'),
      x: z.number().optional().describe('Start X position'),
      y: z.number().optional().describe('Start Y position'),
      width: z.number().optional().describe('Horizontal extent'),
      height: z.number().optional().describe('Vertical extent'),
      unit: z.enum(['PT', 'EMU']).optional().describe('Geometry unit (default: PT)'),
      objectId: z.string().optional().describe('Optional stable object ID (5-50 chars: letters, digits, _, -, :)'),
      account: accountParam,
    },
  }, async ({ presentationId, slideId, category, x, y, width, height, unit, objectId, account }) => {
    const args = ['slides', 'element', 'create-line', presentationId, slideId];
    if (category) args.push(`--category=${category}`);
    if (x !== undefined) args.push(`--x=${x}`);
    if (y !== undefined) args.push(`--y=${y}`);
    if (width !== undefined) args.push(`--width=${width}`);
    if (height !== undefined) args.push(`--height=${height}`);
    if (unit) args.push(`--unit=${unit}`);
    if (objectId) args.push(`--object-id=${objectId}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_element_style', {
    description: 'Style a shape fill/outline or a line. Set kind to shape or line. Colors are #RGB or #RRGGBB.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      objectId: z.string().describe('Object ID of the shape or line'),
      kind: z.enum(['shape', 'line']).optional().describe('Element kind (default: shape)'),
      fillColor: z.string().optional().describe('Shape fill as #RGB or #RRGGBB'),
      fillTransparent: z.boolean().optional().describe('Remove the shape fill'),
      outlineColor: z.string().optional().describe('Shape outline or line color as #RGB or #RRGGBB'),
      outlineWeight: z.number().optional().describe('Shape outline or line weight in points'),
      outlineDash: z.enum(['SOLID', 'DOT', 'DASH', 'DASH_DOT', 'LONG_DASH', 'LONG_DASH_DOT']).optional().describe('Shape outline or line dash style'),
      outlineTransparent: z.boolean().optional().describe('Remove the shape outline or make the line transparent'),
      account: accountParam,
    },
  }, async ({ presentationId, objectId, kind, fillColor, fillTransparent, outlineColor, outlineWeight, outlineDash, outlineTransparent, account }) => {
    const args = ['slides', 'element', 'style', presentationId, objectId];
    if (kind) args.push(`--kind=${kind}`);
    if (fillColor) args.push(`--fill-color=${fillColor}`);
    if (fillTransparent) args.push('--fill-transparent');
    if (outlineColor) args.push(`--outline-color=${outlineColor}`);
    if (outlineWeight !== undefined) args.push(`--outline-weight=${outlineWeight}`);
    if (outlineDash) args.push(`--outline-dash=${outlineDash}`);
    if (outlineTransparent) args.push('--outline-transparent');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_element_transform', {
    description: 'Move, resize, rotate, or shear a page element. apply-mode RELATIVE (default) composes with the existing transform; ABSOLUTE replaces it. Translation is in unit (default PT).',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      objectId: z.string().describe('Object ID of the element to transform'),
      translateX: z.number().optional().describe('X translation'),
      translateY: z.number().optional().describe('Y translation'),
      scaleX: z.number().optional().describe('X scale (omitted axis defaults to 1)'),
      scaleY: z.number().optional().describe('Y scale (omitted axis defaults to 1)'),
      shearX: z.number().optional().describe('X shear'),
      shearY: z.number().optional().describe('Y shear'),
      rotate: z.number().optional().describe('Clockwise rotation in degrees around the element origin'),
      applyMode: z.enum(['RELATIVE', 'ABSOLUTE']).optional().describe('Compose with (RELATIVE, default) or replace (ABSOLUTE) the existing transform'),
      unit: z.enum(['PT', 'EMU']).optional().describe('Translation unit (default: PT)'),
      account: accountParam,
    },
  }, async ({ presentationId, objectId, translateX, translateY, scaleX, scaleY, shearX, shearY, rotate, applyMode, unit, account }) => {
    const args = ['slides', 'element', 'transform', presentationId, objectId];
    if (translateX !== undefined) args.push(`--translate-x=${translateX}`);
    if (translateY !== undefined) args.push(`--translate-y=${translateY}`);
    if (scaleX !== undefined) args.push(`--scale-x=${scaleX}`);
    if (scaleY !== undefined) args.push(`--scale-y=${scaleY}`);
    if (shearX !== undefined) args.push(`--shear-x=${shearX}`);
    if (shearY !== undefined) args.push(`--shear-y=${shearY}`);
    if (rotate !== undefined) args.push(`--rotate=${rotate}`);
    if (applyMode) args.push(`--apply-mode=${applyMode}`);
    if (unit) args.push(`--unit=${unit}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_element_z_order', {
    description: 'Change a page element\'s stacking order.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      objectId: z.string().describe('Object ID of the element to restack'),
      operation: z.enum(['BRING_FORWARD', 'BRING_TO_FRONT', 'SEND_BACKWARD', 'SEND_TO_BACK']).describe('Stacking operation'),
      account: accountParam,
    },
  }, async ({ presentationId, objectId, operation, account }) => {
    return runOrDiagnose(['slides', 'element', 'z-order', presentationId, objectId, `--operation=${operation}`], { account });
  });

  server.registerTool('gog_slides_element_group', {
    description: 'Group two or more page elements into a single group.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      objectIds: z.array(z.string()).min(2).describe('Two or more element object IDs to group'),
      groupId: z.string().optional().describe('Optional stable group object ID'),
      account: accountParam,
    },
  }, async ({ presentationId, objectIds, groupId, account }) => {
    const args = ['slides', 'element', 'group', presentationId, ...objectIds];
    if (groupId) args.push(`--group-id=${groupId}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_element_ungroup', {
    description: 'Ungroup one or more element groups back into their constituent elements.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      groupIds: z.array(z.string()).min(1).describe('One or more group object IDs to ungroup'),
      account: accountParam,
    },
  }, async ({ presentationId, groupIds, account }) => {
    return runOrDiagnose(['slides', 'element', 'ungroup', presentationId, ...groupIds], { account });
  });

  server.registerTool('gog_slides_element_alt_text', {
    description: 'Set or clear a page element\'s accessibility title and/or description. Pass an empty string to clear a field.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      objectId: z.string().describe('Object ID of the element'),
      title: z.string().optional().describe('Accessibility title (empty string clears it)'),
      description: z.string().optional().describe('Accessibility description (empty string clears it)'),
      account: accountParam,
    },
  }, async ({ presentationId, objectId, title, description, account }) => {
    const args = ['slides', 'element', 'alt-text', presentationId, objectId];
    if (title !== undefined) args.push(`--title=${title}`);
    if (description !== undefined) args.push(`--description=${description}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_element_delete', {
    description: 'Delete one page element by object ID.',
    annotations: { destructiveHint: true },
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      objectId: z.string().describe('Object ID of the element to delete'),
      account: accountParam,
    },
  }, async ({ presentationId, objectId, account }) => {
    // --force: gog refuses this delete under the runner's --no-input without it.
    return runOrDiagnose(['slides', 'element', 'delete', presentationId, objectId, '--force'], { account });
  });

  // --- gog 0.29 native tables (table subtree). Cell addressing is zero-based. ---

  server.registerTool('gog_slides_table_create', {
    description: 'Create an auto-sized native table on a slide with the given row and column counts.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      slideId: z.string().describe('Slide object ID to create the table on'),
      rows: z.number().int().min(1).describe('Number of rows (>=1)'),
      cols: z.number().int().min(1).describe('Number of columns (>=1)'),
      objectId: z.string().optional().describe('Optional stable table object ID (5-50 chars: letters, digits, _, -, :)'),
      account: accountParam,
    },
  }, async ({ presentationId, slideId, rows, cols, objectId, account }) => {
    const args = ['slides', 'table', 'create', presentationId, slideId, `--rows=${rows}`, `--cols=${cols}`];
    if (objectId) args.push(`--object-id=${objectId}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_table_cell_style', {
    description: 'Style one zero-based table cell: background fill, vertical content alignment, and inline text styling (optionally scoped to a UTF-16 range within the cell). Boolean flags set the attribute; the no* flags clear it.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      tableObjectId: z.string().describe('Table object ID'),
      row: z.number().int().describe('0-based table row index'),
      col: z.number().int().describe('0-based table column index'),
      range: z.string().optional().describe('UTF-16 text range as start:end to scope text styling within the cell'),
      fillColor: z.string().optional().describe('Cell background fill as #RGB or #RRGGBB'),
      fillTransparent: z.boolean().optional().describe('Remove the cell background fill'),
      contentAlign: z.enum(['TOP', 'MIDDLE', 'BOTTOM']).optional().describe('Vertical content alignment within the cell'),
      font: z.string().optional().describe('Font family (e.g. Arial, Georgia)'),
      size: z.number().optional().describe('Font size in points'),
      textColor: z.string().optional().describe('Text color as #RRGGBB or #RGB'),
      bold: z.boolean().optional().describe('Set bold'),
      noBold: z.boolean().optional().describe('Clear bold'),
      italic: z.boolean().optional().describe('Set italic'),
      noItalic: z.boolean().optional().describe('Clear italic'),
      underline: z.boolean().optional().describe('Set underline'),
      noUnderline: z.boolean().optional().describe('Clear underline'),
      account: accountParam,
    },
  }, async ({ presentationId, tableObjectId, row, col, range, fillColor, fillTransparent, contentAlign, font, size, textColor, bold, noBold, italic, noItalic, underline, noUnderline, account }) => {
    const args = ['slides', 'table', 'cell', 'style', presentationId, tableObjectId, `--row=${row}`, `--col=${col}`];
    if (range) args.push(`--range=${range}`);
    if (fillColor) args.push(`--fill-color=${fillColor}`);
    if (fillTransparent) args.push('--fill-transparent');
    if (contentAlign) args.push(`--content-align=${contentAlign}`);
    if (font) args.push(`--font=${font}`);
    if (size !== undefined) args.push(`--size=${size}`);
    if (textColor) args.push(`--text-color=${textColor}`);
    if (bold) args.push('--bold');
    if (noBold) args.push('--no-bold');
    if (italic) args.push('--italic');
    if (noItalic) args.push('--no-italic');
    if (underline) args.push('--underline');
    if (noUnderline) args.push('--no-underline');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_table_border_style', {
    description: 'Style borders around or within a zero-based table cell range. position selects which borders are affected; dash sets the line style.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      tableObjectId: z.string().describe('Table object ID'),
      row: z.number().int().describe('0-based starting row index'),
      col: z.number().int().describe('0-based starting column index'),
      rowSpan: z.number().int().optional().describe('Number of rows in the range'),
      colSpan: z.number().int().optional().describe('Number of columns in the range'),
      position: z.enum(['ALL', 'OUTER', 'INNER', 'INNER_HORIZONTAL', 'INNER_VERTICAL', 'TOP', 'BOTTOM', 'LEFT', 'RIGHT']).optional().describe('Which borders to style'),
      borderColor: z.string().optional().describe('Border color as #RGB or #RRGGBB'),
      weight: z.number().optional().describe('Border weight in points'),
      dash: z.enum(['SOLID', 'DOT', 'DASH', 'DASH_DOT', 'LONG_DASH', 'LONG_DASH_DOT']).optional().describe('Border dash style'),
      transparent: z.boolean().optional().describe('Make the selected borders transparent'),
      account: accountParam,
    },
  }, async ({ presentationId, tableObjectId, row, col, rowSpan, colSpan, position, borderColor, weight, dash, transparent, account }) => {
    const args = ['slides', 'table', 'border', 'style', presentationId, tableObjectId, `--row=${row}`, `--col=${col}`];
    if (rowSpan !== undefined) args.push(`--row-span=${rowSpan}`);
    if (colSpan !== undefined) args.push(`--col-span=${colSpan}`);
    if (position) args.push(`--position=${position}`);
    if (borderColor) args.push(`--border-color=${borderColor}`);
    if (weight !== undefined) args.push(`--weight=${weight}`);
    if (dash) args.push(`--dash=${dash}`);
    if (transparent) args.push('--transparent');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_table_column_insert', {
    description: 'Insert one or more columns relative to a zero-based table column. Inserts to the left by default, or to the right with right=true.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      tableObjectId: z.string().describe('Table object ID'),
      col: z.number().int().describe('0-based reference column index'),
      count: z.number().int().optional().describe('Number of columns to insert (default: 1)'),
      right: z.boolean().optional().describe('Insert to the right of the reference column instead of the left'),
      account: accountParam,
    },
  }, async ({ presentationId, tableObjectId, col, count, right, account }) => {
    const args = ['slides', 'table', 'column', 'insert', presentationId, tableObjectId, `--col=${col}`];
    if (count !== undefined) args.push(`--count=${count}`);
    if (right) args.push('--right');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_table_column_delete', {
    description: 'Delete the column containing a zero-based table cell.',
    annotations: { destructiveHint: true },
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      tableObjectId: z.string().describe('Table object ID'),
      col: z.number().int().describe('0-based column index to delete'),
      account: accountParam,
    },
  }, async ({ presentationId, tableObjectId, col, account }) => {
    return runOrDiagnose(['slides', 'table', 'column', 'delete', presentationId, tableObjectId, `--col=${col}`, '--force'], { account });
  });

  server.registerTool('gog_slides_table_column_size', {
    description: 'Set the width of a zero-based table column.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      tableObjectId: z.string().describe('Table object ID'),
      col: z.number().int().describe('0-based column index'),
      width: z.number().describe('Column width in points'),
      account: accountParam,
    },
  }, async ({ presentationId, tableObjectId, col, width, account }) => {
    return runOrDiagnose(['slides', 'table', 'column', 'size', presentationId, tableObjectId, `--col=${col}`, `--width=${width}`], { account });
  });

  server.registerTool('gog_slides_table_row_insert', {
    description: 'Insert one or more rows relative to a zero-based table row. Inserts above by default, or below with below=true.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      tableObjectId: z.string().describe('Table object ID'),
      row: z.number().int().describe('0-based reference row index'),
      count: z.number().int().optional().describe('Number of rows to insert (default: 1)'),
      below: z.boolean().optional().describe('Insert below the reference row instead of above'),
      account: accountParam,
    },
  }, async ({ presentationId, tableObjectId, row, count, below, account }) => {
    const args = ['slides', 'table', 'row', 'insert', presentationId, tableObjectId, `--row=${row}`];
    if (count !== undefined) args.push(`--count=${count}`);
    if (below) args.push('--below');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_table_row_delete', {
    description: 'Delete the row containing a zero-based table cell.',
    annotations: { destructiveHint: true },
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      tableObjectId: z.string().describe('Table object ID'),
      row: z.number().int().describe('0-based row index to delete'),
      account: accountParam,
    },
  }, async ({ presentationId, tableObjectId, row, account }) => {
    return runOrDiagnose(['slides', 'table', 'row', 'delete', presentationId, tableObjectId, `--row=${row}`, '--force'], { account });
  });

  server.registerTool('gog_slides_table_row_size', {
    description: 'Set the minimum height of a zero-based table row.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      tableObjectId: z.string().describe('Table object ID'),
      row: z.number().int().describe('0-based row index'),
      height: z.number().describe('Minimum row height in points'),
      account: accountParam,
    },
  }, async ({ presentationId, tableObjectId, row, height, account }) => {
    return runOrDiagnose(['slides', 'table', 'row', 'size', presentationId, tableObjectId, `--row=${row}`, `--height=${height}`], { account });
  });

  server.registerTool('gog_slides_table_merge', {
    description: 'Merge a rectangular table cell range starting at a zero-based cell. Content of non-anchor cells is absorbed by the merge; use gog_slides_table_unmerge to split back.',
    annotations: { destructiveHint: true },
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      tableObjectId: z.string().describe('Table object ID'),
      row: z.number().int().describe('0-based anchor row index'),
      col: z.number().int().describe('0-based anchor column index'),
      rowSpan: z.number().int().optional().describe('Number of rows to merge'),
      colSpan: z.number().int().optional().describe('Number of columns to merge'),
      account: accountParam,
    },
  }, async ({ presentationId, tableObjectId, row, col, rowSpan, colSpan, account }) => {
    const args = ['slides', 'table', 'merge', presentationId, tableObjectId, `--row=${row}`, `--col=${col}`];
    if (rowSpan !== undefined) args.push(`--row-span=${rowSpan}`);
    if (colSpan !== undefined) args.push(`--col-span=${colSpan}`);
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_slides_table_unmerge', {
    description: 'Unmerge (split) a rectangular range of previously merged cells, starting at a zero-based cell.',
    inputSchema: {
      presentationId: z.string().describe('Presentation ID'),
      tableObjectId: z.string().describe('Table object ID'),
      row: z.number().int().describe('0-based anchor row index'),
      col: z.number().int().describe('0-based anchor column index'),
      rowSpan: z.number().int().optional().describe('Number of rows in the range'),
      colSpan: z.number().int().optional().describe('Number of columns in the range'),
      account: accountParam,
    },
  }, async ({ presentationId, tableObjectId, row, col, rowSpan, colSpan, account }) => {
    const args = ['slides', 'table', 'unmerge', presentationId, tableObjectId, `--row=${row}`, `--col=${col}`];
    if (rowSpan !== undefined) args.push(`--row-span=${rowSpan}`);
    if (colSpan !== undefined) args.push(`--col-span=${colSpan}`);
    return runOrDiagnose(args, { account });
  });
}
