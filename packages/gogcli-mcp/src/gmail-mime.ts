import { createHash } from 'node:crypto';
import { decodeHtmlEntities, redactSecrets } from '@chrischall/mcp-utils';

// ============================================================================
// GMAIL MESSAGE CONTENT — decoding a stored message for a reader, and building
// the parts of one a writer sends.
//
// `gog gmail get --json` and `gog gmail drafts get --json` hand back the RAW
// Gmail payload: every body part is base64url, so a caller that wanted to SHOW
// a draft had to decode MIME in a shell (gog's own text renderer only runs on
// its human output). This module owns that decoding once, for both the base
// `gog_gmail_get` and the gmail package's drafts tools, plus the three things
// built on it: an HTML-to-text fallback for HTML-only mail, a minimal
// markdown-to-HTML renderer so a draft edit never has to hand-write the HTML
// part, and the exact-match patch edits `gog_gmail_drafts_update` applies.
//
// Everything here is PURE: no gog call is made. The callers fetch with their
// own `run` so each package's test mocks see the read (see CLAUDE.md on
// `readCourse`).
//
// Every scan is LINEAR. These run on whole upstream bodies, so the fleet's
// ReDoS rule applies (no `[^>]*` re-run from every opener); the 200 KB timing
// tests are in tests/gmail-mime.test.ts.
// ============================================================================

/** One header of a Gmail message part. */
export type GmailHeader = { name?: string; value?: string };

/**
 * Case-insensitive header index. Apple writes `Mime-Version`, the Gmail API
 * writes `MIME-Version`; a case-sensitive lookup silently misses one of them.
 * Repeated headers (Received, References) keep every value, in order.
 */
export type HeaderMap = ReadonlyMap<string, string[]>;

export function parseHeaders(payload: { headers?: GmailHeader[] } | undefined): HeaderMap {
  const map = new Map<string, string[]>();
  for (const h of payload?.headers ?? []) {
    if (!h.name) continue;
    const key = h.name.toLowerCase();
    const existing = map.get(key);
    if (existing) existing.push(h.value ?? '');
    else map.set(key, [h.value ?? '']);
  }
  return map;
}

export function headerValue(headers: HeaderMap, name: string): string | undefined {
  return headers.get(name.toLowerCase())?.[0];
}

/** One MIME node of a Gmail message payload. */
export type GmailPayloadPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPayloadPart[];
};

/** `draft.message` out of `gog gmail drafts get --json`. */
export type GmailDraftMessage = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  payload?: GmailPayloadPart;
};

/** Gmail encodes part bodies as unpadded base64url. Anything undecodable
 *  yields no bytes rather than throwing: a diff must degrade to "no body
 *  found", never take down the whole call. */
function decodeBase64UrlBytes(data: string | undefined): Uint8Array | undefined {
  if (!data) return undefined;
  try {
    const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

/** Code points for bytes 0x80-0x9F, the only range where windows-1252 differs
 *  from latin-1 — and exactly where Apple Mail and Outlook put curly quotes and
 *  dashes, so it is the range whose loss shows up as `don?t`. Written as
 *  numbers because five of the slots are unassigned control characters. */
const CP1252_HIGH = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

function decodeCp1252(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80]! : b);
  return out;
}

/**
 * Bytes -> text, by SNIFFING rather than by trusting the declared charset.
 *
 * Gmail transcodes part bodies to UTF-8 while leaving the message's original
 * `Content-Type: ...; charset=` in place, so that header describes the bytes
 * the SENDER wrote, not the bytes the API just handed us: decoding on it alone
 * would mangle a UTF-8 body labelled windows-1252. Valid UTF-8 is not produced
 * by accident, so a strict UTF-8 decode is the reliable discriminator. Only
 * when that fails do we fall back — to the declared charset if the runtime
 * knows it, else to windows-1252, a superset of latin-1 that covers what
 * desktop mail clients actually emit.
 */
export function decodeTextBytes(bytes: Uint8Array, declaredCharset?: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Not UTF-8. Fall through to the legacy decoders.
  }
  const charset = (declaredCharset ?? '').trim().toLowerCase().replace(/^["']|["']$/g, '');
  if (charset !== '' && !/^(utf-?8|us-ascii|ascii)$/.test(charset)) {
    try {
      return new TextDecoder(charset, { fatal: true }).decode(bytes);
    } catch {
      // Unknown to this runtime, or the bytes are not valid in it either.
    }
  }
  return decodeCp1252(bytes);
}

/** A soft line break, a high-byte escape, or an escaped `=`. Requiring one of
 *  these — rather than any `=XX` — is what keeps an already-decoded body such
 *  as `2+2=44` from being "decoded" into `2+2D`. */
const QUOTED_PRINTABLE_MARKER = /=(?:\r?\n|[89a-f][0-9a-f]|3d)/i;

function decodeQuotedPrintableBytes(bytes: Uint8Array): Uint8Array {
  const src = decodeCp1252(bytes); // 1:1 for the 7-bit input QP is by definition
  const out: number[] = [];
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] !== '=') { out.push(src.charCodeAt(i)); continue; }
    const rest = src.slice(i, i + 3);
    const soft = /^=\r?\n/.exec(rest);
    if (soft) { i += soft[0]!.length - 1; continue; }
    const hex = /^=([0-9A-Fa-f]{2})/.exec(rest);
    if (hex) { out.push(parseInt(hex[1]!, 16)); i += 2; continue; }
    out.push(0x3d); // a lone `=`: keep it exactly as the encoder left it
  }
  return Uint8Array.from(out);
}

/** `text/plain; charset="UTF-8"` -> `text/plain`. Gmail returns the full media
 *  type with its parameters, so keying on the raw string silently misses the
 *  body (gog normalizes with mime.ParseMediaType for the same reason). */
export function partMimeType(part: GmailPayloadPart): string {
  return (part.mimeType ?? '').split(';')[0]!.trim().toLowerCase();
}

/**
 * One part's body as text, honouring what the part says about itself.
 *
 * Transfer encoding is applied CONDITIONALLY, not on the header alone: Gmail
 * has already decoded `body.data` while keeping the original
 * Content-Transfer-Encoding header, so decoding unconditionally would destroy
 * every base64 body (double-decode) and rewrite `2+2=44` in every text one. The
 * quoted-printable decoder therefore runs only when the bytes still LOOK
 * quoted-printable: 7-bit throughout (QP is 7-bit by definition, so any high
 * byte proves it is already decoded) and carrying a real QP marker. base64 is
 * never re-applied — a false positive there is unrecoverable.
 */
export function decodePartText(part: GmailPayloadPart): string {
  let bytes = decodeBase64UrlBytes(part.body?.data);
  if (bytes === undefined) return '';
  const headers = parseHeaders(part);
  const encoding = headerValue(headers, 'Content-Transfer-Encoding')?.trim().toLowerCase();
  if (encoding === 'quoted-printable'
      && bytes.every((b) => b < 0x80)
      && QUOTED_PRINTABLE_MARKER.test(decodeCp1252(bytes))) {
    bytes = decodeQuotedPrintableBytes(bytes);
  }
  const charset = /charset\s*=\s*([^;]+)/i.exec(headerValue(headers, 'Content-Type') ?? '')?.[1];
  return decodeTextBytes(bytes, charset);
}

/** For the callers that hold raw base64url and no part metadata. */
export function decodeBase64UrlText(data: string | undefined): string {
  const bytes = decodeBase64UrlBytes(data);
  return bytes === undefined ? '' : decodeTextBytes(bytes);
}

/**
 * The best plain-text rendering of a message payload: the FIRST inline
 * text/plain part found anywhere in the tree, else the first inline text/html,
 * else ''. Parts carrying a `filename` are attachments and are skipped — an
 * attached .txt is not the body.
 */
export function bestBodyText(payload: GmailPayloadPart | undefined): string {
  const firstOfType = new Map<string, string>();
  const walk = (part: GmailPayloadPart | undefined): void => {
    if (!part) return;
    const mime = partMimeType(part);
    if (part.body?.data && !part.filename && !firstOfType.has(mime)) {
      firstOfType.set(mime, decodePartText(part));
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return firstOfType.get('text/plain') ?? firstOfType.get('text/html') ?? '';
}

/** The first inline (non-attachment) body of one MIME type, decoded; '' if none. */
export function firstInlineBody(payload: GmailPayloadPart | undefined, mime: string): string {
  let found: string | undefined;
  const walk = (part: GmailPayloadPart | undefined): void => {
    if (!part || found !== undefined) return;
    if (part.body?.data && !part.filename && partMimeType(part) === mime) found = decodePartText(part);
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return found ?? '';
}



// ---------------------------------------------------------------------------
// HTML -> TEXT, for the HTML-only message.
// ---------------------------------------------------------------------------

/** Tags whose CONTENT is never text a reader sees. */
const SKIPPED_CONTENT_TAGS = new Set(['script', 'style', 'head', 'title']);

/** Tags that start a new line of text. */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table',
  'tbody', 'thead', 'tfoot', 'tr', 'ul',
]);

/** Paragraph-level blocks, which leave a blank line behind them. */
const PARAGRAPH_TAGS = new Set(['p', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'pre']);

/** ASCII-only lowercase: length-preserving, so indexes into it are indexes into the source. */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

/** `<p class=x>` -> `p`, `</DIV>` -> `div`, `<br/>` -> `br`. */
function tagName(inner: string): { name: string; closing: boolean } {
  let i = 0;
  const closing = inner[0] === '/';
  if (closing) i = 1;
  let name = '';
  for (; i < inner.length; i += 1) {
    const c = inner[i]!;
    if (!/[A-Za-z0-9]/.test(c)) break;
    name += c;
  }
  return { name: name.toLowerCase(), closing };
}

/**
 * The readable text of an HTML body: paragraphs and line breaks kept, list
 * items as `- ` lines, script/style content dropped, entities decoded.
 *
 * A single forward pass: every `<` is matched to the next `>` by indexOf, and a
 * `<` with no `>` after it ends the markup (no later `<` can have one either),
 * so the whole scan is linear in the input.
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  const lower = asciiLower(html);
  let out = '';
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { out += html.slice(i).replace(/\s+/g, ' '); break; }
    out += html.slice(i, lt).replace(/\s+/g, ' ');
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    const gt = html.indexOf('>', lt + 1);
    if (gt === -1) { out += html.slice(lt).replace(/\s+/g, ' '); break; }
    const { name, closing } = tagName(html.slice(lt + 1, gt));
    i = gt + 1;
    if (!closing && SKIPPED_CONTENT_TAGS.has(name)) {
      const end = lower.indexOf(`</${name}`, i);
      if (end === -1) break;
      const close = html.indexOf('>', end);
      i = close === -1 ? html.length : close + 1;
      continue;
    }
    if (name === 'br') out += '\n';
    else if (name === 'li' && !closing) out += '\n- ';
    else if (PARAGRAPH_TAGS.has(name)) out += '\n\n';
    else if (BLOCK_TAGS.has(name)) out += '\n';
  }
  return decodeHtmlEntities(out)
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// TEXT / MARKDOWN -> HTML, so an edit never leaves the HTML part to the caller.
// ---------------------------------------------------------------------------

/** Escape text for an HTML body. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * `**bold**` and `*italic*` on ALREADY-ESCAPED text. Both classes exclude `*`,
 * so each attempt stops at the next asterisk: linear overall. An asterisk with
 * whitespace inside it (`5 * 3 * 2`) is arithmetic, not emphasis, and is left alone.
 */
function renderInline(escaped: string): string {
  return escaped
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?![*\w])/g, '$1<em>$2</em>');
}

/** `**bold**` / `*italic*` markers removed, for the plain part of a markdown body. */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(^|[^*\w])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?![*\w])/g, '$1$2');
}

type MdBlock = { kind: 'p' | 'ul' | 'ol' | 'quote'; lines: string[] };

const UL_ITEM = /^\s{0,3}[-*+]\s+(.*)$/;
const OL_ITEM = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/;
const QUOTE_LINE = /^\s{0,3}>\s?(.*)$/;

/** How deep `> > >` nests before further `>` are shown as text. */
export const MAX_QUOTE_DEPTH = 8;

const BLOCKQUOTE_STYLE = 'margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex';

/**
 * Minimal markdown to HTML: paragraphs (lines joined by `<br>`), `- ` and
 * `1. ` lists, `> ` blockquotes (rendered recursively, so a quoted list is a
 * list), `**bold**` and `*italic*`. Everything else is escaped text — this is
 * an email body renderer, not a markdown implementation, and raw HTML in the
 * source is shown, never interpreted. Quotes nest at most
 * {@link MAX_QUOTE_DEPTH} deep (a deeper `>` is text), so the recursion is
 * bounded whatever the body holds.
 */
export function markdownToHtml(markdown: string, depth = 0): string {
  const blocks: MdBlock[] = [];
  let current: MdBlock | undefined;
  const push = (kind: MdBlock['kind'], line: string): void => {
    if (current?.kind !== kind) {
      current = { kind, lines: [] };
      blocks.push(current);
    }
    current.lines.push(line);
  };
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '') { current = undefined; continue; }
    const quote = depth < MAX_QUOTE_DEPTH ? QUOTE_LINE.exec(line) : null;
    if (quote) { push('quote', quote[1]!); continue; }
    const ul = UL_ITEM.exec(line);
    if (ul) { push('ul', ul[1]!); continue; }
    const ol = OL_ITEM.exec(line);
    if (ol) { push('ol', ol[1]!); continue; }
    push('p', line.trim());
  }
  return blocks.map((b) => {
    if (b.kind === 'quote') return `<blockquote style="${BLOCKQUOTE_STYLE}">${markdownToHtml(b.lines.join('\n'), depth + 1)}</blockquote>`;
    const inline = b.lines.map((l) => renderInline(escapeHtml(l)));
    if (b.kind === 'p') return `<p>${inline.join('<br>')}</p>`;
    const tag = b.kind;
    return `<${tag}>${inline.map((l) => `<li>${l}</li>`).join('')}</${tag}>`;
  }).join('\n');
}

/**
 * The two parts of a body written as `format`: `text` keeps the plain part
 * exactly as given and renders its minimal markdown into the HTML part;
 * `markdown` also drops the `**`/`*` markers from the plain part, so the
 * plain-text reader sees words, not syntax.
 */
export function composeBodyParts(body: string, format: 'text' | 'markdown' = 'text'): { text: string; html: string } {
  return {
    text: format === 'markdown' ? stripInlineMarkdown(body) : body,
    html: markdownToHtml(body),
  };
}

// ---------------------------------------------------------------------------
// PATCH EDITS — exact-match replace, append, prepend.
// ---------------------------------------------------------------------------

/** One exact-match replacement. */
export type TextReplacement = { old: string; new: string };

export type TextPatch = { replace?: readonly TextReplacement[]; append?: string; prepend?: string };

export type TextPatchOutcome =
  | { ok: true; text: string }
  | { ok: false; reason: string; index: number; occurrences: number };

/** Non-overlapping occurrences of `needle`, stopping at 2 (all a caller needs). */
function countUpToTwo(haystack: string, needle: string): number {
  const first = haystack.indexOf(needle);
  if (first === -1) return 0;
  return haystack.indexOf(needle, first + needle.length) === -1 ? 1 : 2;
}

/**
 * Apply `replace` in order, each against the text as it stands when it is
 * applied, then `prepend` and `append`. Every `old` must occur EXACTLY once —
 * zero or several is a refusal naming the edit, never a guess — and nothing is
 * applied unless all of them do. `prepend`/`append` join with a blank line
 * unless they already end/start with a newline.
 */
export function applyTextPatch(text: string, patch: TextPatch): TextPatchOutcome {
  let out = text;
  const edits = patch.replace ?? [];
  for (let i = 0; i < edits.length; i += 1) {
    const edit = edits[i]!;
    if (edit.old === '') return { ok: false, reason: `replace[${i}].old is empty`, index: i, occurrences: 0 };
    const occurrences = countUpToTwo(out, edit.old);
    if (occurrences !== 1) {
      const why = occurrences === 0 ? 'does not occur' : 'occurs more than once';
      return { ok: false, reason: `replace[${i}].old ${why} in the draft's current text${i > 0 ? ' (after the earlier replacements)' : ''}`, index: i, occurrences };
    }
    const at = out.indexOf(edit.old);
    out = out.slice(0, at) + edit.new + out.slice(at + edit.old.length);
  }
  if (patch.prepend) out = patch.prepend + (patch.prepend.endsWith('\n') || out === '' ? '' : '\n\n') + out;
  if (patch.append) out = out + (out === '' || out.endsWith('\n') || patch.append.startsWith('\n') ? '' : '\n\n') + patch.append;
  return { ok: true, text: out };
}

// ---------------------------------------------------------------------------
// THE DECODED VIEW of a stored message.
// ---------------------------------------------------------------------------

/** What a Gmail message looks like in gog's JSON (only the fields read here). */
export type GmailStoredMessage = {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  internalDate?: string;
  snippet?: string;
  payload?: GmailPayloadPart;
};

export type ContentFormat = 'text' | 'html' | 'both';

/** The headers a reader of a message — or of a draft about to go out — actually needs. */
export function readerHeaders(payload: GmailPayloadPart | undefined): Record<string, string> {
  const h = parseHeaders(payload);
  const out: Record<string, string> = {};
  const pick: Array<[string, string]> = [
    ['from', 'From'], ['to', 'To'], ['cc', 'Cc'], ['bcc', 'Bcc'], ['replyTo', 'Reply-To'], ['subject', 'Subject'],
    ['date', 'Date'], ['messageId', 'Message-ID'], ['inReplyTo', 'In-Reply-To'], ['references', 'References'],
  ];
  for (const [key, name] of pick) {
    const v = headerValue(h, name);
    if (v !== undefined && v !== '') out[key] = v;
  }
  return out;
}

export type AttachmentSummary = { filename: string; mimeType: string; size: number | null; attachmentId?: string };

/** Every attachment (a part carrying a filename) by name, type, size and — when gog reported one — the id gog_gmail_attachment takes. */
export function attachmentSummaries(payload: GmailPayloadPart | undefined): AttachmentSummary[] {
  const out: AttachmentSummary[] = [];
  const walk = (part: GmailPayloadPart | undefined): void => {
    if (!part) return;
    if (part.filename) {
      out.push({
        filename: part.filename,
        mimeType: partMimeType(part),
        size: part.body?.size ?? null,
        ...(part.body?.attachmentId ? { attachmentId: part.body.attachmentId } : {}),
      });
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return out;
}

/**
 * The stored body as a writer edits it: the text/plain part, else the HTML
 * part converted to text. `source` says which, so an edit can say what it
 * started from. NOT redacted — this is the read half of a read-modify-write,
 * and writing redacted text back would destroy the draft. Redact before showing.
 */
export function storedBodyText(payload: GmailPayloadPart | undefined): { text: string; source: 'text/plain' | 'text/html' | 'none' } {
  const plain = firstInlineBody(payload, 'text/plain');
  if (plain) return { text: plain, source: 'text/plain' };
  const html = firstInlineBody(payload, 'text/html');
  if (html) return { text: htmlToText(html), source: 'text/html' };
  return { text: '', source: 'none' };
}

/** SHA-256 of a body, hex — what a preview prints instead of the whole text. */
export function bodySha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * A stored message as a reader wants it: the headers that matter, the body
 * DECODED (plain text by default; an HTML-only message is converted), and the
 * attachments by name. Body text is redacted exactly as gog's own output is,
 * because it reaches the caller.
 */
export function decodedMessageView(message: GmailStoredMessage, format: ContentFormat): Record<string, unknown> {
  const headers = readerHeaders(message.payload);
  const body = storedBodyText(message.payload);
  const html = firstInlineBody(message.payload, 'text/html');
  const view: Record<string, unknown> = {
    id: message.id,
    threadId: message.threadId,
    ...(message.labelIds ? { labelIds: message.labelIds } : {}),
    ...(message.internalDate !== undefined ? { internalDate: message.internalDate } : {}),
    headers,
    isReply: headers.inReplyTo !== undefined,
    format,
  };
  if (format !== 'html') {
    view.text = redactSecrets(body.text);
    view.textSource = body.source === 'text/html' ? 'converted-from-html' : body.source;
  }
  if (format !== 'text') view.html = html ? redactSecrets(html) : null;
  view.bodyLength = body.text.length;
  view.attachments = attachmentSummaries(message.payload);
  return view;
}
