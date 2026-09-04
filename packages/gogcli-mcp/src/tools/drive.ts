import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { rawTextResult, viewParam, resolveView } from '@chrischall/mcp-utils';

import { run, runBinary } from '../runner.js';
import { accountParam, diagnose, runOrDiagnose, registerRunTool, pageTokenParam, pageAliasParam, resolvePageToken} from './utils.js';

// A native Google Doc exports to text directly; anything else (PDF, image,
// docx, …) is first copied WITH conversion to this type, which makes Drive run
// OCR, before exporting.
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';

// Parse `gog drive get` JSON into { name, mimeType }. gog nests the payload
// under `file`; fall back to the top level if that ever changes.
function fileMeta(raw: string): { name?: string; mimeType?: string } {
  const parsed = JSON.parse(raw) as { file?: { name?: string; mimeType?: string }; name?: string; mimeType?: string };
  const f = parsed.file ?? parsed;
  return { name: f.name, mimeType: f.mimeType };
}


// The `compact` rung for gog_drive_ls, as a Google Drive field mask.
//
// nextPageToken FIRST and always: a mask of `files(...)` alone drops the cursor
// from the envelope, and a compact listing would then look complete when it was
// one page of many. Verified live against gog 0.39.0.
//
// The dropped fields were chosen from the DATA, not from taste — measured over
// a 25-row listing: thumbnailLink costs 4,998 bytes at ONE distinct value,
// owners 1,400 at one, parents 900 at one, hasThumbnail 550 at one. Everything
// kept below varies across rows. Net: 15,718 -> 8,095 bytes, 48% smaller.
// A caller who needs an owner or a parent asks for view="full".
export const DRIVE_LS_COMPACT_FIELDS =
  'nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink)';

export function registerDriveTools(server: McpServer): void {
  server.registerTool('gog_drive_ls', {
    description: 'List files in a Google Drive folder (default: root).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      folderId: z.string().optional().describe('Folder ID to list (default: root)'),
      max: z.number().optional().describe('Max results (default: 20)'),
      pageToken: pageTokenParam,
      page: pageAliasParam,
      query: z.string().optional().describe('Drive query filter (e.g. "name contains \'budget\'")'),
      allDrives: z.boolean().optional().describe('Include shared drives (default: true). Set false for My Drive only.'),
      view: viewParam(['compact', 'full'], {
        note: 'compact (the default) drops owners, parents, thumbnailLink and hasThumbnail — '
          + 'near-constant across a listing and 48% of its bytes. Ask for full to get them.',
      }),
      account: accountParam,
    },
  }, async ({ folderId, max, pageToken, page, query, allDrives, view, account }) => {
    const args = ['drive', 'ls'];
    if (folderId) args.push(`--parent=${folderId}`);
    if (max !== undefined) args.push(`--max=${max}`);
    const token = resolvePageToken({ pageToken, page });
    if (token) args.push(`--page=${token}`);
    if (query) args.push(`--query=${query}`);
    if (allDrives === false) args.push('--no-all-drives');
    const rung = resolveView(view, ['compact', 'full']);
    return runOrDiagnose(args, {
      account,
      fieldsMask: rung === 'compact' ? DRIVE_LS_COMPACT_FIELDS : undefined,
    });
  });

  server.registerTool('gog_drive_search', {
    description: 'Search Google Drive files by full-text query.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe('Search query'),
      // gog's `drive search` accepts no --fields mask, so unlike gog_drive_ls
      // this tool's compact rung is a LOCAL projection. Same vocabulary either
      // way: a caller does not need to know which lever is being pulled.
      view: viewParam(['compact', 'full'], { note: 'compact (the default) drops thumbnailLink — a URL a model cannot see, and 30%+ of a Drive file record. Ask for full to get it back.' }),
      account: accountParam,
    },
  }, async ({ query, view, account }) => {
    return runOrDiagnose(['drive', 'search', query], {
      account,
      stripMedia: resolveView(view, ['compact', 'full']) === 'compact',
    });
  });

  server.registerTool('gog_drive_get', {
    description: 'Get metadata for a Google Drive file.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      fileId: z.string().describe('File ID'),
      // A --fields mask saves only 7% here: the default set is already narrow,
      // which is why this tool takes no mask. The media strip saves 27.5% of
      // the tool's actual output, measured end to end over stdio, which is why
      // it takes a view after all. (An earlier note said 32.9%; that was a
      // minified-vs-stripped comparison of the raw gog payload rather than of
      // what the tool returns. The end-to-end figure is the one a caller sees.)
      view: viewParam(['compact', 'full'], { note: 'compact (the default) drops thumbnailLink — a URL a model cannot see, and 30%+ of a Drive file record. Ask for full to get it back.' }),
      account: accountParam,
    },
  }, async ({ fileId, view, account }) => {
    return runOrDiagnose(['drive', 'get', fileId], {
      account,
      stripMedia: resolveView(view, ['compact', 'full']) === 'compact',
    });
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
    // gog gates drive delete behind a confirmation; the runner injects
    // --no-input, so without --force it refuses at runtime.
    args.push('--force');
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
    // gog gates public sharing behind a confirmation; the runner injects
    // --no-input, so without --force it refuses at runtime.
    if (to === 'anyone') args.push('--force');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_extract_text', {
    description:
      'Extract readable TEXT from a Drive file — PDF, image, docx, or a native Google Doc — and return ' +
      'it to you directly (closing the webViewLink dead end). Accepts a Drive file id, including the id ' +
      'from gog_gmail_attachment\'s deliveredVia:"drive" response. For non-Docs it copies the file to a ' +
      'temporary Google Doc so Drive OCRs it (works for scanned PDFs too), exports plain text, then ' +
      'deletes the temp Doc. Operates entirely via the Drive API within the existing drive scope — no ' +
      'host filesystem, no scope widening. For a large file, page through with offset/maxChars.',
    // Creates and deletes a temporary Doc for non-native files, so not read-only.
    annotations: { destructiveHint: false },
    inputSchema: {
      fileId: z.string().describe('Drive file ID (e.g. the id returned by gog_gmail_attachment)'),
      ocrLanguage: z.string().optional().describe(
        'BCP-47 language hint for OCR of scanned/image PDFs (e.g. "en", "fr"). Optional.',
      ),
      offset: z.number().int().nonnegative().optional().describe('Character offset to start from (default: 0)'),
      maxChars: z.number().int().positive().optional().describe('Max characters to return (default: all from offset)'),
      account: accountParam,
    },
  }, async ({ fileId, ocrLanguage, offset = 0, maxChars, account }) => {
    let tempDocId: string | undefined;
    try {
      const { name, mimeType } = fileMeta(await run(['drive', 'get', fileId], { account }));

      // Native Docs export straight to text; everything else is OCR-converted first.
      let sourceId = fileId;
      if (mimeType !== GOOGLE_DOC_MIME) {
        const params = JSON.stringify({ fileId, ...(ocrLanguage ? { ocrLanguage } : {}) });
        const body = JSON.stringify({ name: `gogcli-ocr-${fileId}`, mimeType: GOOGLE_DOC_MIME });
        const copied = JSON.parse(await run(
          ['api', 'call', 'drive', 'v3', 'files.copy', '--allow-write', '--force',
            `--params=${params}`, `--body=${body}`],
          // OCR on a large scanned PDF routinely outruns the default 30s.
          // Same precedent as the interactive auth flow in tools/auth.ts.
          { account, timeout: 300_000 },
        )) as { id?: string; result?: { id?: string } };
        tempDocId = copied.id ?? copied.result?.id;
        if (!tempDocId) throw new Error('OCR conversion did not return a document id');
        sourceId = tempDocId;
      }

      const exportParams = JSON.stringify({ fileId: sourceId, mimeType: 'text/plain' });
      const raw = await run(['api', 'call', 'drive', 'v3', 'files.export', `--params=${exportParams}`], { account });

      const full = raw.replace(/^﻿/, ''); // drop the export's leading BOM
      const start = Math.min(offset, full.length);
      const text = maxChars !== undefined ? full.slice(start, start + maxChars) : full.slice(start);
      return rawTextResult(JSON.stringify({
        fileId,
        name,
        mimeType,
        extractedVia: mimeType === GOOGLE_DOC_MIME ? 'native-export' : 'ocr-convert',
        totalChars: full.length,
        offset: start,
        returnedChars: text.length,
        truncated: start + text.length < full.length,
        text,
      }, null, 2));
    } catch (err) {
      return diagnose(err);
    } finally {
      // Always remove the temp Doc — on success, and on a mid-extraction failure.
      if (tempDocId) {
        await run(['drive', 'delete', tempDocId, '--permanent', '--force'], { account }).catch(() => {});
      }
    }
  });

  server.registerTool('gog_drive_read_bytes', {
    description:
      'Fetch a Drive file\'s raw bytes and return them base64-encoded as an embedded resource — the ' +
      'generic fallback for callers that want the file itself (to parse locally) rather than extracted ' +
      'text. For readable text from a PDF, prefer gog_drive_extract_text. NOTE: only works on the local ' +
      'stdio server; over the hosted connector the transport is text-only and this returns a clear error ' +
      '(use gog_drive_extract_text there).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      fileId: z.string().describe('Drive file ID'),
      account: accountParam,
    },
  }, async ({ fileId, account }): Promise<CallToolResult> => {
    try {
      const { name, mimeType } = fileMeta(await run(['drive', 'get', fileId], { account }));
      const params = JSON.stringify({ fileId, alt: 'media' });
      const blob = await runBinary(['api', 'call', 'drive', 'v3', 'files.get', `--params=${params}`], { account });
      const type = mimeType ?? 'application/octet-stream';
      // Several hosts (claude.ai among them) render embedded IMAGE resources
      // and reject every other type outright — "Resources of type
      // 'application/pdf' are not currently supported". The fetch succeeded and
      // the bytes are right here, but the caller sees only the text block, so
      // that text has to carry the way out rather than end on "resource below".
      const unrenderableHint = type.startsWith('image/')
        ? ''
        : ` If your client does not render a ${type} resource, gog_drive_extract_text`
          + ' returns the same file as text (PDFs included, via OCR).';
      return {
        content: [
          { type: 'text', text: `${name ?? fileId} (${type}) — ${Buffer.from(blob, 'base64').length} bytes, base64 resource below.${unrenderableHint}` },
          {
            type: 'resource',
            resource: {
              uri: `gogdrive://${fileId}/${encodeURIComponent(name ?? 'file')}`,
              mimeType: type,
              blob,
            },
          },
        ],
      };
    } catch (err) {
      return diagnose(err);
    }
  });

  registerRunTool(server, { service: 'drive', examples: '"copy", "upload", "download", "permissions"' });
}
