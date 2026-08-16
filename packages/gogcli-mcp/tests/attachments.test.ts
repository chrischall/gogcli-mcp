import { describe, it, expect } from 'vitest';
import {
  inlineFileArg,
  inlineAttachmentArgs,
  inlineAttachmentSchema,
  MAX_INLINE_ATTACHMENT_BYTES,
  MAX_INLINE_ATTACHMENT_TOTAL_BYTES,
  MAX_REQUEST_PAYLOAD_WIRE_BYTES,
  INLINE_ATTACHMENT_LIMITS_TEXT,
} from '../src/attachments.js';
import type { GogFileArg } from '../src/runner.js';

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('inlineFileArg', () => {
  it('turns bytes into a base64 GogFileArg carrying the caller filename', () => {
    const { arg, bytes } = inlineFileArg('attach', {
      filename: 'pendant-layouts.png',
      contentBase64: PNG.toString('base64'),
    });
    expect(arg).toEqual<GogFileArg>({
      kind: 'file',
      flag: 'attach',
      contents: PNG.toString('base64'),
      encoding: 'base64',
      filename: 'pendant-layouts.png',
    });
    expect(bytes).toBe(PNG.length);
  });

  it('marks a positional arg so the path is emitted bare, not as --flag=path', () => {
    const { arg } = inlineFileArg('localPath', { filename: 'notes.md', contentBase64: b64('hi') }, { positional: true });
    expect(arg.positional).toBe(true);
  });

  it('leaves positional unset by default, preserving the --flag=path shape', () => {
    const { arg } = inlineFileArg('attach', { filename: 'a.txt', contentBase64: b64('hi') });
    expect(arg.positional).toBeUndefined();
  });

  // Filenames with spaces and non-ASCII characters are the shapes the original
  // report blamed for the inline-delivery failure. They must pass through here
  // completely untouched — the name is what the recipient sees.
  it.each([
    'Screenshot 2026-06-13 152500.png',
    'Reçu — étude, final (v2).pdf',
    'ファイル 名前.png',
    "quote'and\"double.txt",
  ])('accepts %j verbatim', (filename) => {
    const { arg } = inlineFileArg('attach', { filename, contentBase64: b64('x') });
    expect(arg.filename).toBe(filename);
  });

  it('rejects a filename that is a path rather than a bare name', () => {
    expect(() => inlineFileArg('attach', { filename: '../../etc/passwd', contentBase64: b64('x') }))
      .toThrow(/must be a bare filename, not a path/);
    expect(() => inlineFileArg('attach', { filename: 'dir\\file.txt', contentBase64: b64('x') }))
      .toThrow(/must be a bare filename, not a path/);
  });

  it('rejects a traversal, a control character, and an over-long name', () => {
    expect(() => inlineFileArg('attach', { filename: '..', contentBase64: b64('x') })).toThrow(/not a usable filename/);
    expect(() => inlineFileArg('attach', { filename: 'a\u0000b.txt', contentBase64: b64('x') })).toThrow(/not a usable filename/);
    expect(() => inlineFileArg('attach', { filename: `${'n'.repeat(201)}.txt`, contentBase64: b64('x') })).toThrow(/not a usable filename/);
  });

  it('rejects content that is not valid base64 instead of writing a corrupt file', () => {
    // Buffer.from is lenient and would silently DROP the bad characters, mailing
    // out a truncated file. The round-trip check is what turns that into an error.
    expect(() => inlineFileArg('attach', { filename: 'a.png', contentBase64: 'not!valid!base64!' }))
      .toThrow(/not valid base64/);
  });

  it('names the offending file and the limit when one file is too large', () => {
    const tooBig = Buffer.alloc(MAX_INLINE_ATTACHMENT_BYTES + 1).toString('base64');
    expect(() => inlineFileArg('attach', { filename: 'huge.bin', contentBase64: tooBig }))
      .toThrow(/huge\.bin[\s\S]*exceeds the \d+-byte \(8 MiB\) per-file limit/);
  });

  it('accepts a file exactly at the ceiling', () => {
    const exact = Buffer.alloc(MAX_INLINE_ATTACHMENT_BYTES).toString('base64');
    expect(() => inlineFileArg('attach', { filename: 'exact.bin', contentBase64: exact })).not.toThrow();
  });

  it('uses a caller-supplied label in the error, for tools whose param is not attachInline', () => {
    expect(() => inlineFileArg('localPath', { filename: 'a.png', contentBase64: '!!!' }, { where: 'content' }))
      .toThrow(/^content: contents are not valid base64/);
  });
});

describe('inlineAttachmentArgs', () => {
  it('returns nothing for undefined or an empty list, so nothing is appended', () => {
    expect(inlineAttachmentArgs('attach', undefined)).toEqual([]);
    expect(inlineAttachmentArgs('attach', [])).toEqual([]);
  });

  it('produces one repeatable arg per attachment, in order', () => {
    const args = inlineAttachmentArgs('attach', [
      { filename: 'a.png', contentBase64: b64('aaa') },
      { filename: 'b.pdf', contentBase64: b64('bbb') },
    ]);
    expect(args).toHaveLength(2);
    expect(args.map((a) => (a as GogFileArg).filename)).toEqual(['a.png', 'b.pdf']);
    expect(args.every((a) => (a as GogFileArg).flag === 'attach')).toBe(true);
  });

  it('allows two attachments with the SAME name (each gets its own temp dir)', () => {
    const args = inlineAttachmentArgs('attach', [
      { filename: 'chart.png', contentBase64: b64('first') },
      { filename: 'chart.png', contentBase64: b64('second') },
    ]);
    expect(args).toHaveLength(2);
    expect((args[0] as GogFileArg).contents).not.toBe((args[1] as GogFileArg).contents);
  });

  it('enforces a per-message total on top of the per-file ceiling', () => {
    // Each file is individually legal; together they are not.
    const chunk = Buffer.alloc(MAX_INLINE_ATTACHMENT_BYTES).toString('base64');
    const four = Array.from({ length: 4 }, (_, i) => ({ filename: `f${i}.bin`, contentBase64: chunk }));
    expect(() => inlineAttachmentArgs('attach', four))
      .toThrow(/This message is too large to send/);
  });

  // The budget belongs to the REQUEST, not to the attachments. `payloadArg`
  // turns any body over 4 KiB into a GogFileArg that rides in the same JSON
  // body at ~1:1, so a near-max attachment set plus a multi-MiB body overruns
  // the runner even though each input is inside its own documented limit. That
  // is the same invisible-transport-rejection failure the ceiling exists to
  // prevent, so the sibling args are measured rather than assumed small.
  it('counts the message body against the same budget as the attachments', () => {
    // Three files just under the 8 MiB per-file cap, summing to just under the
    // per-message total — i.e. every input inside its own documented limit.
    const each = Buffer.alloc(Math.floor((MAX_INLINE_ATTACHMENT_TOTAL_BYTES - 4096) / 3)).toString('base64');
    const attachments = Array.from({ length: 3 }, (_, i) => ({ filename: `big${i}.bin`, contentBase64: each }));

    // Alone: fits.
    expect(() => inlineAttachmentArgs('attach', attachments)).not.toThrow();

    // With a 2 MiB HTML body — itself well under the 8 MiB per-file cap — it
    // does not, and the error says the body is implicated.
    const body: GogFileArg = { kind: 'file', flag: 'body-html-file', contents: 'x'.repeat(2 * 1024 * 1024) };
    expect(() => inlineAttachmentArgs('attach', attachments, ['gmail', 'send', body]))
      .toThrow(/would fit on their own; the rest of the message \(its body, mostly\) spends \d+ bytes/);
  });

  it('blames the files, not the body, when the attachments alone overrun', () => {
    const chunk = Buffer.alloc(MAX_INLINE_ATTACHMENT_BYTES).toString('base64');
    const four = Array.from({ length: 4 }, (_, i) => ({ filename: `f${i}.bin`, contentBase64: chunk }));
    expect(() => inlineAttachmentArgs('attach', four, ['gmail', 'send'])).toThrow(/too large to send/);
    expect(() => inlineAttachmentArgs('attach', four, ['gmail', 'send'])).not.toThrow(/would fit on their own/);
  });

  it('measures a base64 sibling at its wire length, not its decoded length', () => {
    // A sibling that is itself binary costs its base64 spelling, which is what
    // actually travels — counting decoded bytes would under-report by 25%.
    const sibling: GogFileArg = {
      kind: 'file',
      flag: 'attach',
      contents: Buffer.alloc(MAX_INLINE_ATTACHMENT_BYTES).toString('base64'),
      encoding: 'base64',
      filename: 'already-counted.bin',
    };
    const each = Buffer.alloc(Math.floor((MAX_INLINE_ATTACHMENT_TOTAL_BYTES - 4096) / 3)).toString('base64');
    const attachments = Array.from({ length: 3 }, (_, i) => ({ filename: `f${i}.bin`, contentBase64: each }));
    expect(() => inlineAttachmentArgs('attach', attachments, ['gmail', 'send', sibling]))
      .toThrow(/too large to send/);
  });

  it('ignores small sibling args, which the JSON reserve already covers', () => {
    const chunk = Buffer.alloc(Math.floor(MAX_INLINE_ATTACHMENT_TOTAL_BYTES / 4)).toString('base64');
    const two = Array.from({ length: 2 }, (_, i) => ({ filename: `f${i}.bin`, contentBase64: chunk }));
    const flags = ['gmail', 'send', '--to=a@b.com', '--subject=Hi', '--body=short'];
    expect(() => inlineAttachmentArgs('attach', two, flags)).not.toThrow();
  });

  // THE INVARIANT behind the per-message ceiling, asserted rather than trusted.
  //
  // connector-runtime sends every payload base64-encoded inside ONE JSON body,
  // and the Fly runner caps that body at MAX_BODY_BYTES. Base64 inflates by 4/3,
  // so a ceiling expressed in decoded bytes has to be derived from the wire cap
  // or it documents a size that gets rejected as "request body too large" — a
  // transport rejection from a layer the caller cannot see, which is the exact
  // failure the tool-layer check exists to prevent. A 25 MiB total encoded to
  // 34,952,536 chars against a 33,554,432 cap, so the limit was unreachable.
  it('keeps a full message under the Fly runner request-body cap once base64-inflated', () => {
    const RUNNER_MAX_BODY_BYTES = 32 * 1024 * 1024; // fly-gog-runner/server.mjs
    const encodedLength = (decoded: number): number => 4 * Math.ceil(decoded / 3);

    // The payload budget must leave the JSON structure room inside the cap…
    expect(MAX_REQUEST_PAYLOAD_WIRE_BYTES).toBeLessThan(RUNNER_MAX_BODY_BYTES);
    expect(RUNNER_MAX_BODY_BYTES - MAX_REQUEST_PAYLOAD_WIRE_BYTES).toBeGreaterThanOrEqual(128 * 1024);
    // …and a full attachment set must fit inside that budget once inflated.
    expect(encodedLength(MAX_INLINE_ATTACHMENT_TOTAL_BYTES)).toBeLessThanOrEqual(MAX_REQUEST_PAYLOAD_WIRE_BYTES);
    // The advertised number must itself be sendable — floor, not round.
    const advertised = Number(/(\d+) MiB in total/.exec(INLINE_ATTACHMENT_LIMITS_TEXT)![1]) * 1024 * 1024;
    expect(advertised).toBeLessThanOrEqual(MAX_INLINE_ATTACHMENT_TOTAL_BYTES);
  });

  it('reports the ceilings it actually enforces', () => {
    expect(MAX_INLINE_ATTACHMENT_BYTES).toBe(8 * 1024 * 1024);
    expect(MAX_REQUEST_PAYLOAD_WIRE_BYTES).toBe(32 * 1024 * 1024 - 256 * 1024);
    expect(MAX_INLINE_ATTACHMENT_TOTAL_BYTES).toBe(24_969_216); // wire budget × 3/4
    // The documented text is derived from the constants, so it cannot drift.
    expect(INLINE_ATTACHMENT_LIMITS_TEXT).toBe('up to 8 MiB per file and 23 MiB in total');
  });

  it('accepts a message at the advertised total', () => {
    // 23 MiB across three files — the number the tool description publishes.
    const chunk = Buffer.alloc(Math.floor((23 * 1024 * 1024) / 3)).toString('base64');
    const three = Array.from({ length: 3 }, (_, i) => ({ filename: `f${i}.bin`, contentBase64: chunk }));
    expect(() => inlineAttachmentArgs('attach', three)).not.toThrow();
  });
});

describe('inlineAttachmentSchema', () => {
  it('requires both filename and contentBase64', () => {
    expect(inlineAttachmentSchema.safeParse({ filename: 'a.png' }).success).toBe(false);
    expect(inlineAttachmentSchema.safeParse({ contentBase64: b64('x') }).success).toBe(false);
    expect(inlineAttachmentSchema.safeParse({ filename: 'a.png', contentBase64: b64('x') }).success).toBe(true);
  });

  it('rejects empty strings, which would produce a nameless or empty attachment', () => {
    expect(inlineAttachmentSchema.safeParse({ filename: '', contentBase64: b64('x') }).success).toBe(false);
    expect(inlineAttachmentSchema.safeParse({ filename: 'a.png', contentBase64: '' }).success).toBe(false);
  });
});
