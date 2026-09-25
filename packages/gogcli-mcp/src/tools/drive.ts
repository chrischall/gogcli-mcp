import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { errorResult, rawTextResult, viewParam, resolveView } from '@chrischall/mcp-utils';
import { MAX_INLINE_ATTACHMENT_BYTES } from '../attachments.js';

import { run, runBinary } from '../runner.js';
import { accountParam, diagnose, runOrDiagnose, registerRunTool, pageTokenParam, pageAliasParam, resolvePageToken} from './utils.js';
import { pos } from '../argv.js';
import type { GogArg } from '../runner.js';
import { CONFIRM_FALLBACK_DESCRIPTION, confirmTokenParam, gatedElsewhere, hasTrueFlag, refusedInRun, requireDispatchConfirmation, vetCommentsRun, resultText } from '../dispatch-confirmation.js';

// gog's spellings (internal/cmd/drive*.go; aliases per `gog schema` 0.41.0).
const DRIVE_DELETE_WORDS = new Set(['delete', 'rm', 'del']);

/** gog_drive_run must not do what gog_drive_share / comments / a permanent delete would ask about. */
export function vetDriveRun(subcommand: string, args: readonly string[]): string | undefined {
  const sub = subcommand.toLowerCase();
  if (sub === 'share') return gatedElsewhere('gog drive share', 'gog_drive_run', 'grants access to a file', 'gog_drive_share');
  if (DRIVE_DELETE_WORDS.has(sub) && hasTrueFlag(args, 'permanent')) {
    return gatedElsewhere(`gog drive ${sub} --permanent`, 'gog_drive_run', 'deletes a file for good, bypassing the trash', 'gog_drive_delete');
  }
  // `bulk update-role --from=reader --to=writer` (and `bulk remove-public`)
  // rewrites the permissions of every matching file under a folder, with no
  // positional path for the path guard to see and no file for a preview to
  // name (SEC-1, fleet-audit #930). `permissions` only lists.
  if (sub === 'bulk') {
    return gatedElsewhere('gog drive bulk', 'gog_drive_run',
      'rewrites sharing permissions across every matching file in a tree', 'gog_drive_share (one file at a time)');
  }
  // `unshare` removes a collaborator's access; the dedicated tool shows the
  // host a structured, annotated call rather than an opaque argv.
  if (sub === 'unshare') {
    return refusedInRun('gog drive unshare', 'gog_drive_run', "removes someone's access to a file", 'Use gog_drive_unshare.');
  }
  return vetCommentsRun('drive', sub, args);
}

// A native Google Doc exports to text directly; anything else (PDF, image,
// docx, …) is first copied WITH conversion to this type, which makes Drive run
// OCR, before exporting.
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';

// Parse `gog drive get` JSON into { name, mimeType }. gog nests the payload
// under `file`; fall back to the top level if that ever changes.
type DriveMeta = { name?: string; mimeType?: string; size?: string | number };

/** fileMeta for a preview: unreadable output names nothing rather than throwing. */
export function shareTargetMeta(raw: string): { name?: string; mimeType?: string } {
  try {
    const { name, mimeType } = fileMeta(raw);
    return { name, mimeType };
  } catch {
    return {};
  }
}

/**
 * A Drive/Docs comment as a reply's prompt shows it: who wrote it, what it
 * says and whether it is resolved. Unreadable output names nothing.
 */
export function commentSnapshot(raw: string): { author?: string; content?: string; resolved?: boolean } {
  let comment: { content?: unknown; resolved?: unknown; author?: { displayName?: unknown; emailAddress?: unknown } } | undefined;
  try {
    const parsed = JSON.parse(raw) as ({ comment?: typeof comment } & NonNullable<typeof comment>) | null;
    comment = parsed?.comment ?? parsed ?? undefined;
  } catch {
    comment = undefined;
  }
  const name = typeof comment?.author?.displayName === 'string' ? comment.author.displayName : undefined;
  const email = typeof comment?.author?.emailAddress === 'string' ? comment.author.emailAddress : undefined;
  const author = name && email ? `${name} <${email}>` : name ?? email;
  return {
    ...(author ? { author } : {}),
    ...(typeof comment?.content === 'string' ? { content: comment.content } : {}),
    ...(typeof comment?.resolved === 'boolean' ? { resolved: comment.resolved } : {}),
  };
}

/**
 * The people a comment's text +mentions (or @mentions) by email — Drive
 * notifies each of them, so a comment's prompt names them.
 */
export function commentMentions(text: string): string[] {
  return [...new Set(text.match(/(?<=[+@])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [])];
}

function fileMeta(raw: string): { name?: string; mimeType?: string; size?: number } {
  const parsed = JSON.parse(raw) as { file?: DriveMeta } & DriveMeta;
  const f = parsed.file ?? parsed;
  // Drive reports int64 fields as strings; native Google formats carry none.
  const size = f.size === undefined ? undefined : Number(f.size);
  return { name: f.name, mimeType: f.mimeType, size: Number.isFinite(size) ? size : undefined };
}

// The most gog_drive_read_bytes returns inline — the same 8 MiB per-file cap
// the attachment path enforces. The bytes travel base64-encoded (4/3 larger)
// inside one JSON-RPC message, and past this no MCP client accepts the result.
export const MAX_DRIVE_READ_BYTES = MAX_INLINE_ATTACHMENT_BYTES;


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
    inputSchema: z.object({
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
    }),
  }, async ({ folderId, max, pageToken, page, query, allDrives, view, account }) => {
    const args: GogArg[] = ['drive', 'ls'];
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
    inputSchema: z.object({
      query: z.string().describe('Search query'),
      // gog's `drive search` accepts no --fields mask, so unlike gog_drive_ls
      // this tool's compact rung is a LOCAL projection. Same vocabulary either
      // way: a caller does not need to know which lever is being pulled.
      view: viewParam(['compact', 'full'], { note: 'compact (the default) drops thumbnailLink — a URL a model cannot see, and 30%+ of a Drive file record. Ask for full to get it back.' }),
      account: accountParam,
    }),
  }, async ({ query, view, account }) => {
    return runOrDiagnose(['drive', 'search', pos(query)], {
      account,
      stripMedia: resolveView(view, ['compact', 'full']) === 'compact',
    });
  });

  server.registerTool('gog_drive_get', {
    description: 'Get metadata for a Google Drive file.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      fileId: z.string().describe('File ID'),
      // A --fields mask saves only 7% here: the default set is already narrow,
      // which is why this tool takes no mask. The media strip saves 27.5% of
      // the tool's actual output, measured end to end over stdio, which is why
      // it takes a view after all. (An earlier note said 32.9%; that was a
      // minified-vs-stripped comparison of the raw gog payload rather than of
      // what the tool returns. The end-to-end figure is the one a caller sees.)
      view: viewParam(['compact', 'full'], { note: 'compact (the default) drops thumbnailLink — a URL a model cannot see, and 30%+ of a Drive file record. Ask for full to get it back.' }),
      account: accountParam,
    }),
  }, async ({ fileId, view, account }) => {
    return runOrDiagnose(['drive', 'get', pos(fileId)], {
      account,
      stripMedia: resolveView(view, ['compact', 'full']) === 'compact',
    });
  });

  server.registerTool('gog_drive_mkdir', {
    description: 'Create a new folder in Google Drive.',
    annotations: { destructiveHint: false },
    inputSchema: z.object({
      name: z.string().describe('Folder name'),
      account: accountParam,
    }),
  }, async ({ name, account }) => {
    return runOrDiagnose(['drive', 'mkdir', pos(name)], { account });
  });

  server.registerTool('gog_drive_rename', {
    description: 'Rename a file or folder in Google Drive.',
    annotations: { destructiveHint: false },
    inputSchema: z.object({
      fileId: z.string().describe('File or folder ID'),
      newName: z.string().describe('New name'),
      account: accountParam,
    }),
  }, async ({ fileId, newName, account }) => {
    return runOrDiagnose(['drive', 'rename', pos(fileId), pos(newName)], { account });
  });

  server.registerTool('gog_drive_move', {
    description: 'Move a file to a different folder in Google Drive.',
    annotations: { destructiveHint: false },
    inputSchema: z.object({
      fileId: z.string().describe('File ID to move'),
      parentId: z.string().describe('Destination folder ID'),
      account: accountParam,
    }),
  }, async ({ fileId, parentId, account }) => {
    return runOrDiagnose(['drive', 'move', pos(fileId), `--parent=${parentId}`], { account });
  });

  server.registerTool('gog_drive_delete', {
    description: 'Move a Google Drive file to trash, or permanently delete it with permanent=true (irreversible). A '
      + 'permanent delete reads the file and asks the MCP host to show the user a confirmation prompt naming it first; '
      + 'nothing is deleted unless they accept. Moving to trash is recoverable and does not ask.'
      + CONFIRM_FALLBACK_DESCRIPTION,
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      fileId: z.string().describe('File ID to delete'),
      permanent: z.boolean().optional().describe('Permanently delete instead of moving to trash (irreversible; asks the user first)'),
      account: accountParam,
      confirmToken: confirmTokenParam,
    }),
  }, async ({ fileId, permanent, account, confirmToken }, ctx) => {
    const args: GogArg[] = ['drive', 'delete', pos(fileId)];
    if (permanent) {
      const got = await runOrDiagnose(['drive', 'get', pos(fileId)], { account });
      if (got.isError) return got;
      const target = { file: { id: fileId, ...shareTargetMeta(resultText(got)) }, permanent: true };
      const confirmation = await requireDispatchConfirmation(ctx, {
        action: 'drive.delete-permanent',
        message: 'Review and confirm PERMANENTLY deleting this file — it skips the trash and cannot be recovered:',
        confirmationLabel: 'Confirm that this file should be permanently deleted now.',
        details: target,
        unsupportedNote: 'Move it to the trash instead (permanent=false); the user can empty the trash from Google Drive.',
        fallback: {
          tool: 'gog_drive_delete',
          account,
          confirmToken,
          subject: () => ({ target: fileId, payload: target, preview: target }),
        },
      });
      if (confirmation) return confirmation;
      args.push('--permanent');
    }
    // gog gates drive delete behind a confirmation; the runner injects
    // --no-input, so without --force it refuses at runtime.
    args.push('--force');
    return runOrDiagnose(args, { account });
  });

  server.registerTool('gog_drive_share', {
    description: 'Share a Google Drive file or folder. Granting access is the risk even though no email is sent (gog '
      + 'does not notify by default), so this reads the file and asks the MCP host to show the user a confirmation '
      + 'prompt naming it, who gets access and with what role; nothing is shared unless they accept.'
      + CONFIRM_FALLBACK_DESCRIPTION,
    annotations: { destructiveHint: true },
    inputSchema: z.object({
      fileId: z.string().describe('File or folder ID'),
      to: z.enum(['user', 'anyone', 'domain']).describe('Share target type'),
      email: z.string().optional().describe('User email (required when to=user)'),
      domain: z.string().optional().describe('Domain (required when to=domain)'),
      role: z.enum(['reader', 'writer']).optional().describe('Permission role (default: reader)'),
      account: accountParam,
      confirmToken: confirmTokenParam,
    }),
  }, async ({ fileId, to, email, domain, role, account, confirmToken }, ctx) => {
    // Read first, on every call: a prompt that shows only an opaque id asks the
    // user to approve something they cannot recognise, and on the token
    // fallback's phase 2 this is the re-read the token is checked against.
    const got = await runOrDiagnose(['drive', 'get', pos(fileId)], { account });
    if (got.isError) return got;
    const file = { id: fileId, ...shareTargetMeta(resultText(got)) };
    const grant = {
      file,
      to,
      ...(email ? { email } : {}),
      ...(domain ? { domain } : {}),
      role: role ?? 'reader',
      publicLink: to === 'anyone',
    };
    const confirmation = await requireDispatchConfirmation(ctx, {
      action: 'drive.share',
      message: to === 'anyone'
        ? 'Review and confirm making this file available to ANYONE with the link:'
        : 'Review and confirm this Drive share:',
      confirmationLabel: 'Confirm that this access should be granted now.',
      details: grant,
      unsupportedNote: 'Ask the user to share it themselves from Google Drive.',
      fallback: {
        tool: 'gog_drive_share',
        account,
        confirmToken,
        subject: () => ({ target: fileId, payload: grant, preview: grant }),
      },
    });
    if (confirmation) return confirmation;
    const args: GogArg[] = ['drive', 'share', pos(fileId), `--to=${to}`];
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
    inputSchema: z.object({
      fileId: z.string().describe('Drive file ID (e.g. the id returned by gog_gmail_attachment)'),
      ocrLanguage: z.string().optional().describe(
        'BCP-47 language hint for OCR of scanned/image PDFs (e.g. "en", "fr"). Optional.',
      ),
      offset: z.number().int().nonnegative().optional().describe('Character offset to start from (default: 0)'),
      maxChars: z.number().int().positive().optional().describe('Max characters to return (default: all from offset)'),
      account: accountParam,
    }),
  }, async ({ fileId, ocrLanguage, offset = 0, maxChars, account }) => {
    let tempDocId: string | undefined;
    try {
      const { name, mimeType } = fileMeta(await run(['drive', 'get', pos(fileId)], { account }));

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
        await run(['drive', 'delete', pos(tempDocId), '--permanent', '--force'], { account }).catch(() => {});
      }
    }
  });

  server.registerTool('gog_drive_read_bytes', {
    description:
      'Fetch a Drive file\'s raw bytes and return them base64-encoded as an embedded resource — the ' +
      'generic fallback for callers that want the file itself (to parse locally) rather than extracted ' +
      'text. Files over 8 MiB are refused (checked before downloading). For readable text from a PDF, prefer gog_drive_extract_text.',
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      fileId: z.string().describe('Drive file ID'),
      account: accountParam,
    }),
  }, async ({ fileId, account }): Promise<CallToolResult> => {
    try {
      const { name, mimeType, size } = fileMeta(await run(['drive', 'get', pos(fileId)], { account }));
      // Refuse an oversized file BEFORE fetching it (audit BUG-2): buffering a
      // multi-GB file plus its base64 copy can take down the whole server.
      if (size !== undefined && size > MAX_DRIVE_READ_BYTES) {
        return errorResult(
          `${name ?? fileId} is ${size} bytes, over the 8 MiB this tool returns inline. `
          + 'Use gog_drive_extract_text for its text, or share its webViewLink (gog_drive_get) instead.',
        );
      }
      const params = JSON.stringify({ fileId, alt: 'media' });
      // The cap also bounds the fetch itself, for files Drive reports no size for.
      const blob = await runBinary(
        ['api', 'call', 'drive', 'v3', 'files.get', `--params=${params}`],
        { account, maxOutputBytes: MAX_DRIVE_READ_BYTES },
      );
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

  registerRunTool(server, { service: 'drive', examples: '"copy", "download", "permissions"', vet: vetDriveRun });
}
