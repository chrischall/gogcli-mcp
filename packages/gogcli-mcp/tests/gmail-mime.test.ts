import { describe, it, expect } from 'vitest';
import {
  parseHeaders,
  headerValue,
  decodeTextBytes,
  decodeBase64UrlText,
  decodePartText,
  bestBodyText,
  firstInlineBody,
  htmlToText,
  escapeHtml,
  markdownToHtml,
  stripInlineMarkdown,
  composeBodyParts,
  applyTextPatch,
  readerHeaders,
  attachmentSummaries,
  storedBodyText,
  bodySha256,
  decodedMessageView,
  MAX_QUOTE_DEPTH,
} from '../src/gmail-mime.js';

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

// The decoder tests moved here with the decoders (from gogcli-mcp-gmail's
// draft-fork tests, which still exercise them through the re-export).

describe('parseHeaders / headerValue', () => {
  it('keys case-insensitively', () => {
    const h = parseHeaders({ headers: [{ name: 'Mime-Version', value: '1.0 (1.0)' }] });
    expect(headerValue(h, 'MIME-Version')).toBe('1.0 (1.0)');
  });

  it('keeps every value of a repeated header', () => {
    const h = parseHeaders({ headers: [
      { name: 'Received', value: 'one' },
      { name: 'received', value: 'two' },
      { name: 'RECEIVED' },
    ] });
    expect(h.get('received')).toEqual(['one', 'two', '']);
    expect(headerValue(h, 'Received')).toBe('one');
  });

  it('tolerates a missing payload, a missing headers array, nameless and valueless headers', () => {
    expect(parseHeaders(undefined).size).toBe(0);
    expect(parseHeaders({}).size).toBe(0);
    const h = parseHeaders({ headers: [{ value: 'orphan' }, { name: 'X-Empty' }] });
    expect(h.size).toBe(1);
    expect(headerValue(h, 'x-empty')).toBe('');
  });

  it('returns undefined for a header that is not present', () => {
    expect(headerValue(parseHeaders({ headers: [] }), 'Subject')).toBeUndefined();
  });
});

describe('decodeBase64UrlText', () => {
  it('decodes base64url, including multi-byte UTF-8', () => {
    expect(decodeBase64UrlText(b64url('caf\u00e9 \u2014 ok'))).toBe('caf\u00e9 \u2014 ok');
  });

  it('returns empty string for absent or undecodable data rather than throwing', () => {
    expect(decodeBase64UrlText(undefined)).toBe('');
    expect(decodeBase64UrlText('')).toBe('');
    expect(decodeBase64UrlText('!!!!not base64!!!!')).toBe('');
  });
});

describe('decodePartText — transfer encoding and charset', () => {
  const bytes = (...b: number[]) => Buffer.from(Uint8Array.from(b)).toString('base64url');

  it('decodes a windows-1252 body instead of replacing its smart quote', () => {
    // 0x92 is a RIGHT SINGLE QUOTATION MARK in cp1252 and invalid UTF-8, so a
    // plain UTF-8 decode turns "don’t" into "don�t".
    expect(decodePartText({
      mimeType: 'text/plain',
      headers: [{ name: 'Content-Type', value: 'text/plain; charset=windows-1252' }],
      body: { data: bytes(0x64, 0x6f, 0x6e, 0x92, 0x74) },
    })).toBe('don’t');
  });

  it('decodes a part that really is still quoted-printable, soft breaks included', () => {
    expect(decodePartText({
      mimeType: 'text/plain',
      headers: [{ name: 'Content-Transfer-Encoding', value: 'quoted-printable' }],
      body: { data: b64url('It cost =E2=80=94 a lot=\r\nreally, and 100=3D100=zz=') },
    })).toBe('It cost — a lotreally, and 100=100=zz=');
  });

  it('does NOT re-decode a body Gmail already decoded, even though the header still says quoted-printable', () => {
    // Gmail hands back `body.data` already decoded while leaving the original
    // Content-Transfer-Encoding header in place, so decoding on the header
    // alone would rewrite "2+2=44" to "2+2D".
    expect(decodePartText({
      mimeType: 'text/plain',
      headers: [{ name: 'Content-Transfer-Encoding', value: 'quoted-printable' }],
      body: { data: b64url('2+2=44 and that is that') },
    })).toBe('2+2=44 and that is that');
    // Non-ASCII bytes prove it is decoded already: quoted-printable is 7-bit.
    expect(decodePartText({
      mimeType: 'text/plain',
      headers: [{ name: 'Content-Transfer-Encoding', value: 'quoted-printable' }],
      body: { data: b64url('café =E2=80=94') },
    })).toBe('café =E2=80=94');
  });

  it('does NOT re-decode a base64 part — Gmail already did, and doing it twice destroys the body', () => {
    expect(decodePartText({
      mimeType: 'text/plain',
      headers: [{ name: 'Content-Transfer-Encoding', value: 'base64' }],
      body: { data: b64url('plain words here') },
    })).toBe('plain words here');
  });

  it('falls back to windows-1252 when the part declares no charset at all', () => {
    // No Content-Type header, bytes that are not valid UTF-8: the choice is
    // between mangling the smart quote and reading it. gog would read it.
    expect(decodePartText({ mimeType: 'text/plain', body: { data: bytes(0x64, 0x6f, 0x6e, 0x92, 0x74) } })).toBe('don’t');
  });

  it('falls back to windows-1252 when the declared charset means nothing to this runtime', () => {
    expect(decodePartText({
      mimeType: 'text/plain',
      headers: [{ name: 'Content-Type', value: 'text/plain; charset=x-nonesuch-9000' }],
      body: { data: bytes(0x64, 0x6f, 0x6e, 0x92, 0x74) },
    })).toBe('don’t');
  });

  it('keeps a UTF-8 body that is merely LABELLED windows-1252 — Gmail transcodes and leaves the header', () => {
    expect(decodePartText({
      mimeType: 'text/plain',
      headers: [{ name: 'Content-Type', value: 'text/plain; charset="windows-1252"' }],
      body: { data: b64url('don’t — really') },
    })).toBe('don’t — really');
  });

  it('returns empty string for a part with no data', () => {
    expect(decodePartText({ mimeType: 'text/plain' })).toBe('');
  });
});

describe('bestBodyText', () => {
  it('returns empty string when there is no payload', () => {
    expect(bestBodyText(undefined)).toBe('');
  });

  it('reads a flat text/plain body', () => {
    expect(bestBodyText({ mimeType: 'text/plain', body: { data: b64url('hello') } })).toBe('hello');
  });

  it('prefers text/plain nested anywhere over text/html', () => {
    expect(bestBodyText({
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/html', body: { data: b64url('<p>rich</p>') } },
        { mimeType: 'multipart/related', parts: [{ mimeType: 'text/plain', body: { data: b64url('plain') } }] },
      ],
    })).toBe('plain');
  });

  it('falls back to text/html when there is no plain part', () => {
    expect(bestBodyText({ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: b64url('<p>rich</p>') } }] }))
      .toBe('<p>rich</p>');
  });

  it('skips attachment parts and keeps the FIRST body of each type', () => {
    expect(bestBodyText({
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', filename: 'notes.txt', body: { data: b64url('ATTACHED, NOT THE BODY') } },
        { mimeType: 'text/plain', body: { data: b64url('first') } },
        { mimeType: 'text/plain', body: { data: b64url('second') } },
      ],
    })).toBe('first');
  });

  it('treats a part with no mimeType as its own (unusable) type', () => {
    // A part with neither a mimeType nor a recognisable one must not be picked
    // up as the body — it is keyed under '' and never matches plain or html.
    expect(bestBodyText({ parts: [{ body: { data: b64url('mystery') } }, { mimeType: 'text/plain', body: { data: b64url('real') } }] }))
      .toBe('real');
  });

  it('finds a part whose mimeType carries parameters (text/plain; charset="UTF-8")', () => {
    expect(bestBodyText({
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/html; charset="UTF-8"', body: { data: b64url('<p>rich</p>') } },
        { mimeType: 'text/plain; charset="UTF-8"', body: { data: b64url('plain') } },
      ],
    })).toBe('plain');
  });

  it('returns empty string when nothing carries a recognised body', () => {
    expect(bestBodyText({ mimeType: 'multipart/mixed', parts: [{ mimeType: 'application/pdf', body: { data: b64url('%PDF') }, filename: 'a.pdf' }] })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// THE DIVERGENCE REPORT. The point of the whole feature: in the observed case
// NEITHER copy was a superset, so recreating from either one alone lost work.
// ---------------------------------------------------------------------------

describe('decodeTextBytes', () => {
  it('decodes in a declared legacy charset the runtime knows, when the bytes are not UTF-8', () => {
    // 0xE9 is "é" in latin-1 / iso-8859-1 and an invalid lone byte in UTF-8.
    expect(decodeTextBytes(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]), '"iso-8859-1"')).toBe('café');
  });

  it('ignores a utf-8 / ascii label once the strict UTF-8 decode has failed', () => {
    expect(decodeTextBytes(Uint8Array.from([0x64, 0x6f, 0x6e, 0x92, 0x74]), 'utf-8')).toBe('don’t');
  });
});

describe('firstInlineBody', () => {
  it('returns the first inline body of a type, skipping attachments, else ""', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/html', filename: 'a.html', body: { data: b64url('<p>attached</p>') } },
        { mimeType: 'text/html', body: { data: b64url('<p>one</p>') } },
        { mimeType: 'text/html', body: { data: b64url('<p>two</p>') } },
      ],
    };
    expect(firstInlineBody(payload, 'text/html')).toBe('<p>one</p>');
    expect(firstInlineBody(payload, 'text/plain')).toBe('');
    expect(firstInlineBody(undefined, 'text/plain')).toBe('');
  });
});

describe('htmlToText', () => {
  it('returns "" for an empty body', () => {
    expect(htmlToText('')).toBe('');
  });

  it('keeps paragraphs, line breaks and list items; drops script, style and comments; decodes entities', () => {
    const html = '<html><head><title>T</title><style>p{color:red}</style></head><body>'
      + '<p>Hi&nbsp;Pat,</p><!-- tracking --><div>line one<br>line   two</div>'
      + '<ol><li>first</li><li>second</li></ol><script>alert(1)</script><p>&lt;b&gt; &amp; done</p></body></html>';
    expect(htmlToText(html)).toBe('Hi Pat,\n\nline one\nline two\n\n- first\n- second\n\n<b> & done');
  });

  it('treats an unclosed tag, comment or script as the end of the markup rather than looping', () => {
    expect(htmlToText('before <b unclosed')).toBe('before <b unclosed');
    expect(htmlToText('before <!-- never closed')).toBe('before');
    expect(htmlToText('before <script>never closed')).toBe('before');
    expect(htmlToText('a<script>x</script')).toBe('a');
    expect(htmlToText('plain text, no tags')).toBe('plain text, no tags');
    expect(htmlToText('<SPAN>Case</SPAN> <DIV>Insensitive</DIV>')).toBe('Case\nInsensitive');
    expect(htmlToText('<>empty tag</>')).toBe('empty tag');
    expect(htmlToText('<p class="x">one<br/>two</p>')).toBe('one\ntwo');
  });
});

describe('escapeHtml', () => {
  it('escapes the four characters that matter in a body', () => {
    expect(escapeHtml('a & b < c > "d"')).toBe('a &amp; b &lt; c &gt; &quot;d&quot;');
  });
});

describe('markdownToHtml', () => {
  it('renders paragraphs, bullet and numbered lists, bold, italic and blockquotes', () => {
    const md = 'Hi Pat,\nsecond line\n\n- one\n- **two**\n\n1. first\n2) *second*\n\n> quoted\n> - inside\n>\n> again';
    expect(markdownToHtml(md)).toBe([
      '<p>Hi Pat,<br>second line</p>',
      '<ul><li>one</li><li><strong>two</strong></li></ul>',
      '<ol><li>first</li><li><em>second</em></li></ol>',
      '<blockquote style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex"><p>quoted</p>\n<ul><li>inside</li></ul>\n<p>again</p></blockquote>',
    ].join('\n'));
  });

  it('escapes raw HTML and leaves arithmetic asterisks alone', () => {
    expect(markdownToHtml('<script>x</script> 5 * 3 * 2')).toBe('<p>&lt;script&gt;x&lt;/script&gt; 5 * 3 * 2</p>');
    expect(markdownToHtml('a*b*c and **unclosed')).toBe('<p>a*b*c and **unclosed</p>');
  });

  it('normalizes CRLF and stops nesting quotes at MAX_QUOTE_DEPTH', () => {
    expect(markdownToHtml('a\r\nb')).toBe('<p>a<br>b</p>');
    const deep = markdownToHtml('>'.repeat(MAX_QUOTE_DEPTH + 3) + ' x');
    expect(deep.match(/<blockquote/g)).toHaveLength(MAX_QUOTE_DEPTH);
    expect(deep).toContain('&gt;&gt;&gt; x');
  });
});

describe('stripInlineMarkdown / composeBodyParts', () => {
  it('drops emphasis markers but keeps lists and quotes', () => {
    expect(stripInlineMarkdown('**Bold** and *it* - and 5 * 3')).toBe('Bold and it - and 5 * 3');
  });

  it('text keeps the plain part verbatim; markdown strips its markers; both render the HTML', () => {
    expect(composeBodyParts('**hi**')).toEqual({ text: '**hi**', html: '<p><strong>hi</strong></p>' });
    expect(composeBodyParts('**hi**', 'markdown')).toEqual({ text: 'hi', html: '<p><strong>hi</strong></p>' });
  });
});

describe('applyTextPatch', () => {
  const text = 'Hi Pat,\n\nPickup is at 5.\n\nThanks';

  it('applies replacements in order, then prepend and append with blank lines', () => {
    expect(applyTextPatch(text, {
      replace: [{ old: 'at 5', new: 'at 6' }, { old: 'at 6.', new: 'at 6:30.' }],
      prepend: 'DRAFT',
      append: 'Chris',
    })).toEqual({ ok: true, text: 'DRAFT\n\nHi Pat,\n\nPickup is at 6:30.\n\nThanks\n\nChris' });
  });

  it('does not add a separator where a newline already is, or to an empty body', () => {
    expect(applyTextPatch('body\n', { append: 'x', prepend: 'p\n' })).toEqual({ ok: true, text: 'p\nbody\nx' });
    expect(applyTextPatch('body', { append: '\nx' })).toEqual({ ok: true, text: 'body\nx' });
    expect(applyTextPatch('', { append: 'a', prepend: 'p' })).toEqual({ ok: true, text: 'p\n\na' });
    expect(applyTextPatch('same', {})).toEqual({ ok: true, text: 'same' });
  });

  it('refuses an old that matches zero or several times, or is empty, naming the edit', () => {
    expect(applyTextPatch(text, { replace: [{ old: 'nowhere', new: 'x' }] }))
      .toEqual({ ok: false, reason: "replace[0].old does not occur in the draft's current text", index: 0, occurrences: 0 });
    expect(applyTextPatch(text, { replace: [{ old: 'Pickup', new: 'P' }, { old: '\n\n', new: ' ' }] }))
      .toMatchObject({ ok: false, index: 1, occurrences: 2, reason: expect.stringContaining('more than once in the draft\'s current text (after the earlier replacements)') });
    expect(applyTextPatch(text, { replace: [{ old: '', new: 'x' }] })).toMatchObject({ ok: false, reason: 'replace[0].old is empty' });
  });
});

describe('readerHeaders / attachmentSummaries / storedBodyText / bodySha256', () => {
  it('picks the headers a reader needs and omits empty ones', () => {
    expect(readerHeaders({ headers: [{ name: 'subject', value: 'S' }, { name: 'To', value: '' }, { name: 'Reply-To', value: 'r@x.com' }] }))
      .toEqual({ subject: 'S', replyTo: 'r@x.com' });
    expect(readerHeaders(undefined)).toEqual({});
  });

  it('lists every named part, with a null size when Gmail gave none', () => {
    expect(attachmentSummaries({ parts: [{ filename: 'a.txt', mimeType: 'text/plain' }, { mimeType: 'text/plain' }] }))
      .toEqual([{ filename: 'a.txt', mimeType: 'text/plain', size: null }]);
    expect(attachmentSummaries(undefined)).toEqual([]);
  });

  it('reads the plain part, else the converted HTML part, else nothing', () => {
    expect(storedBodyText({ mimeType: 'text/plain', body: { data: b64url('p') } })).toEqual({ text: 'p', source: 'text/plain' });
    expect(storedBodyText({ mimeType: 'text/html', body: { data: b64url('<p>h</p>') } })).toEqual({ text: 'h', source: 'text/html' });
    expect(storedBodyText({ mimeType: 'multipart/mixed' })).toEqual({ text: '', source: 'none' });
  });

  it('hashes the body as SHA-256 hex', () => {
    expect(bodySha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('decodedMessageView', () => {
  it('reports source none and omits optional fields for an empty message', () => {
    expect(decodedMessageView({}, 'both')).toEqual({
      id: undefined, threadId: undefined, headers: {}, isReply: false, format: 'both',
      text: '', textSource: 'none', html: null, bodyLength: 0, attachments: [],
    });
  });

  it('carries internalDate when gog gave one', () => {
    expect(decodedMessageView({ internalDate: '1700000000000' }, 'text')).toMatchObject({ internalDate: '1700000000000' });
  });
});

// The fleet's ReDoS rule (CLAUDE.md, fleet-audit#1197): these run on whole
// upstream bodies, so each must stay linear on adversarial input.
describe('linear on 200 KB adversarial bodies', () => {
  const N = 200_000;
  const cases: Array<[string, () => unknown]> = [
    ['htmlToText: unclosed openers', () => htmlToText('<'.repeat(N))],
    ['htmlToText: many tags', () => htmlToText('<a>'.repeat(N / 3))],
    ['htmlToText: script openers', () => htmlToText('<script>'.repeat(N / 8))],
    ['markdownToHtml: unclosed bold', () => markdownToHtml('**a'.repeat(N / 3))],
    ['markdownToHtml: stars and spaces', () => markdownToHtml('* '.repeat(N / 2))],
    ['markdownToHtml: lone stars', () => markdownToHtml(' *a'.repeat(N / 3))],
    ['markdownToHtml: deep quotes', () => markdownToHtml('>'.repeat(N))],
    ['markdownToHtml: many lines', () => markdownToHtml('- x\n'.repeat(N / 4))],
    ['stripInlineMarkdown', () => stripInlineMarkdown('*a '.repeat(N / 3))],
    ['applyTextPatch', () => applyTextPatch('a'.repeat(N), { replace: [{ old: 'a'.repeat(1000) + 'b', new: '' }] })],
  ];
  it.each(cases)('%s', (_name, fn) => {
    const started = performance.now();
    fn();
    expect(performance.now() - started).toBeLessThan(250);
  });
});
