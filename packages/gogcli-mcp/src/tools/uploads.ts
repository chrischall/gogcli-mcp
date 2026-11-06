import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { minifiedResult } from '@chrischall/mcp-utils';
import { mintUploadSlot, uploadSlotRequestSchema } from '@chrischall/mcp-utils/export';
import { MAX_BLOB_FILE_BYTES, MAX_UPLOAD_FILES, requireUploadStore, UPLOAD_SLOTS_TOOL } from '../upload-slots.js';

/**
 * The tools that take a file by blobKey. Listed in the slot tool's description
 * so a model that has a file to send finds the route; a package that does not
 * register one of them simply never sees it called.
 */
const BLOB_KEY_TOOLS = [
  'gog_gmail_send', 'gog_gmail_reply', 'gog_gmail_reply_all',
  'gog_gmail_drafts_create', 'gog_gmail_drafts_update', 'gog_gmail_drafts_reply', 'gog_gmail_drafts_reply_all',
  'gog_gmail_import', 'gog_chat_messages_send', 'gog_drive_upload',
  'gog_slides_add_slide', 'gog_slides_insert_image', 'gog_slides_replace_slide',
  'gog_docs_insert_image', 'gog_docs_replace_image',
];

const MIB = MAX_BLOB_FILE_BYTES / (1024 * 1024);

export function registerUploadTools(server: McpServer): void {
  server.registerTool(UPLOAD_SLOTS_TOOL, {
    description:
      'HOSTED DEPLOYMENTS: how to give this server a FILE you hold (a photo, a PDF, an .eml). This server runs remotely '
      + 'and cannot read paths on your machine, so call this first with the files\' names: it returns one signed upload '
      + 'slot per file. PUT each file\'s bytes to its uploadUrl (each slot carries a ready `curl` command — replace the '
      + '<path to …> placeholder; the Content-Type must be exactly the slot\'s mimeType), then pass the slots\' blobKeys '
      + `in the \`blobKeys\` parameter of the tool that takes the file: ${BLOB_KEY_TOOLS.join(', ')}. `
      + `Up to ${MAX_UPLOAD_FILES} files per call, ${MIB} MiB each; the URLs expire after 30 minutes. Each uploaded file is `
      + 'deleted once the call that uses it succeeds, and kept if that call fails. Prefer this over attachInline for '
      + 'anything but a small file — no base64 in the call. Mints URLs only: nothing reaches Google until you use the keys. '
      + 'On a local install this refuses: pass a path, or attachInline.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: z.object({
      files: z.array(uploadSlotRequestSchema).min(1).max(MAX_UPLOAD_FILES).describe(
        'One entry per file: {filename, mimeType?}. The filename is the name the recipient / Drive will show, and its '
        + 'extension is how gog types an attachment — give it the right one.',
      ),
    }),
  }, async ({ files }) => {
    const store = requireUploadStore(UPLOAD_SLOTS_TOOL);
    const slots = files.map((file) => {
      const { expiresAtMs: _expiresAtMs, ...slot } = mintUploadSlot(store, file);
      return slot;
    });
    return minifiedResult({
      slots,
      maxBytesPerFile: MAX_BLOB_FILE_BYTES,
      next: 'PUT each file to its uploadUrl (run each slot\'s curl with the real path), check every PUT succeeded, '
        + 'then pass the blobKeys to the file-taking tool\'s blobKeys parameter.',
    });
  });
}
