import { z } from 'zod';
import type { GogArg, GogFileArg } from './runner.js';

/**
 * Caller-supplied attachment BYTES, for hosts that share no filesystem with gog.
 *
 * ## Why this exists
 *
 * Every attachment input gog offers is a PATH — `gmail send --attach`,
 * `gmail drafts create --attach`, `drive upload <localPath>` — and those paths
 * resolve wherever gog runs. On the local stdio transport that is the caller's
 * own machine and everything works. On the hosted connector, and on any host
 * that reaches a backend through GOG_RUNNER_URL, gog runs somewhere else
 * entirely: no path the caller can name exists there, so outbound attachments
 * were simply impossible — including via Drive, whose upload takes a path too.
 *
 * The seam that fixes it already existed. `GogFileArg` writes a payload to a
 * private temp file NEXT TO GOG — on the runner for the remote path, in a
 * mkdtemp dir for the local one — and passes the resulting path. It was built
 * for oversized text (a long HTML mail body) that could not fit in argv; all
 * binary attachments need on top of that is a base64 spelling and control of
 * the basename, both of which are now `GogFileArg` fields.
 *
 * So an inline attachment is not a new transport. It is the same temp-file
 * hand-off, carrying bytes instead of prose.
 */

// Ceiling for ONE attachment's decoded bytes.
//
// Pinned to the Fly runner's own MAX_FILE_ARG_BYTES (fly-gog-runner/server.mjs)
// so the two agree. That matters: without a check here the local stdio path
// would accept any size while the remote path refused at 8 MiB, and the caller
// would meet the limit as a transport rejection from a layer they cannot see.
// Checked in the TOOL so the error names the file and the limit instead.
export const MAX_INLINE_ATTACHMENT_BYTES = 8 * 1024 * 1024;

// Ceiling for all inline attachments on one message. Gmail refuses a message
// over 25 MB total, and refuses it AFTER the upload — so catching it here saves
// a slow round trip that always ends in failure.
export const MAX_INLINE_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;

const formatMiB = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MiB`;

/** Human-readable ceilings, for tool descriptions — so the docs cannot drift. */
export const INLINE_ATTACHMENT_LIMITS_TEXT =
  `up to ${formatMiB(MAX_INLINE_ATTACHMENT_BYTES)} per file and ` +
  `${formatMiB(MAX_INLINE_ATTACHMENT_TOTAL_BYTES)} in total`;

/**
 * One attachment supplied as bytes rather than as a path.
 *
 * `mimeType` is deliberately ABSENT. gog derives an attachment's MIME type from
 * the filename extension (`mailmime.PrepareAttachments`) and exposes no flag to
 * override it, so a `mimeType` field here could only ever be accepted and
 * ignored. Naming the file `chart.png` is what sets the type; a parameter that
 * silently does nothing is worse than no parameter. (`gog_drive_upload` DOES
 * take a real `mimeType`, because `drive upload --mime-type` exists.)
 */
export const inlineAttachmentSchema = z.object({
  filename: z.string().min(1).describe(
    'Filename the recipient will see, e.g. "pendant-layouts.png". gog infers the attachment\'s MIME '
    + 'type from this extension, so give it the right one — a .png sent as "layouts" arrives as an '
    + 'untyped blob. Must be a single filename, not a path.',
  ),
  contentBase64: z.string().min(1).describe(
    'The file\'s bytes, base64-encoded (standard alphabet, with padding). This is the whole point of '
    + 'this parameter: the bytes travel with the request, so nothing needs to exist on the gog server\'s '
    + 'filesystem.',
  ),
});

export type InlineAttachmentInput = z.infer<typeof inlineAttachmentSchema>;

/** Reusable tool parameter — the same field on send, drafts create and update. */
export const attachInlineParam = z.array(inlineAttachmentSchema).optional().describe(
  'Attachments supplied as BYTES rather than as server-side paths — use this whenever you hold a file '
  + 'and the gog server does not, which is always the case on the hosted connector and on any remote '
  + `deployment. Each entry is {filename, contentBase64} (${INLINE_ATTACHMENT_LIMITS_TEXT}). `
  + 'Can be combined with `attach`: the two name disjoint files (paths read on the server vs. bytes sent '
  + 'with the call), and both end up as ordinary attachments on the message.',
);

/**
 * Reject a filename that is a path, a traversal, or otherwise not one plain
 * segment. It becomes both the temp file's basename and the name the recipient
 * sees, so the two things it must not do are escape the temp directory and
 * arrive misleading.
 */
function validateFilename(filename: string, where: string): void {
  if (/[/\\]/.test(filename)) {
    throw new Error(
      `${where}: filename ${JSON.stringify(filename)} must be a bare filename, not a path. `
      + 'Pass just the name the recipient should see, e.g. "report.pdf".',
    );
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(filename) || /^\.+$/.test(filename) || filename.length > 200) {
    throw new Error(
      `${where}: filename ${JSON.stringify(filename)} is not a usable filename `
      + '(no control characters, not "."/"..", 200 characters max).',
    );
  }
}

/**
 * Decoded byte length of a base64 string, or null when it is not valid base64.
 *
 * `Buffer.from(…, 'base64')` never throws — it silently DROPS characters it does
 * not recognise — so a truncated or whitespace-mangled payload would otherwise
 * be written to disk as a corrupt file and mailed out as one. The round trip is
 * what turns that into an error the caller can act on, at the boundary where
 * their input arrived rather than in the recipient's inbox.
 */
function decodedLength(contentBase64: string): number | null {
  const buf = Buffer.from(contentBase64, 'base64');
  return buf.toString('base64') === contentBase64 ? buf.length : null;
}

/**
 * Validate ONE caller-supplied file and turn it into a `GogFileArg`, which the
 * executor materializes to a temp file beside gog.
 *
 * Throws with an actionable message on anything invalid. The MCP layer turns a
 * thrown handler error into an `isError` result, so every rejection here reaches
 * the caller as a readable sentence naming the file — rather than as a base64
 * decode producing a silently corrupt upload, or as a transport-layer size
 * rejection from a layer the caller cannot see.
 *
 * `positional` emits the path as a bare argv element instead of `--flag=path`,
 * for subcommands that take the file as a positional argument
 * (`gog drive upload <localPath>`).
 *
 * @returns the arg, and the file's decoded size so callers can total it.
 */
export function inlineFileArg(
  flag: string,
  attachment: InlineAttachmentInput,
  opts: { positional?: boolean; where?: string } = {},
): { arg: GogFileArg; bytes: number } {
  const { filename, contentBase64 } = attachment;
  const where = opts.where ?? `attachInline entry ${JSON.stringify(filename)}`;
  validateFilename(filename, where);
  const bytes = decodedLength(contentBase64);
  if (bytes === null) {
    throw new Error(
      `${where}: contents are not valid base64. Send the standard alphabet with padding and no `
      + 'line breaks — the value must survive a decode/re-encode round trip unchanged.',
    );
  }
  if (bytes > MAX_INLINE_ATTACHMENT_BYTES) {
    throw new Error(
      `${where}: ${bytes} bytes exceeds the ${MAX_INLINE_ATTACHMENT_BYTES}-byte `
      + `(${formatMiB(MAX_INLINE_ATTACHMENT_BYTES)}) per-file limit for inline content. `
      + 'Upload it to Drive and link to it instead, or send it from a local (stdio) deployment '
      + 'using a real server-side path.',
    );
  }
  // `filename` (not `ext`) is what makes the delivered copy carry the caller's
  // name: gog reads an attachment's MIME filename, and Drive's default title,
  // off the path it is handed.
  const arg: GogFileArg = { kind: 'file', flag, contents: contentBase64, encoding: 'base64', filename };
  if (opts.positional) arg.positional = true;
  return { arg, bytes };
}

/**
 * Validate inline attachments and turn them into `GogFileArg`s for `flag`
 * (repeatable — one arg per attachment), enforcing the per-message total on top
 * of each file's own ceiling.
 */
export function inlineAttachmentArgs(
  flag: string,
  attachments: readonly InlineAttachmentInput[] | undefined,
): GogArg[] {
  if (!attachments?.length) return [];
  const args: GogArg[] = [];
  let total = 0;
  for (const attachment of attachments) {
    const { arg, bytes } = inlineFileArg(flag, attachment);
    total += bytes;
    if (total > MAX_INLINE_ATTACHMENT_TOTAL_BYTES) {
      throw new Error(
        `Inline attachments total ${total} bytes, over the ${MAX_INLINE_ATTACHMENT_TOTAL_BYTES}-byte `
        + `(${formatMiB(MAX_INLINE_ATTACHMENT_TOTAL_BYTES)}) limit for one message. Gmail rejects a `
        + 'message this large after the upload, so send fewer files per message or link them from Drive.',
      );
    }
    args.push(arg);
  }
  return args;
}
