import { describe, it, expect } from 'vitest';
import {
  inlineFileArg,
  inlineAttachmentArgs,
  inlineAttachmentSchema,
  MAX_INLINE_ATTACHMENT_BYTES,
  MAX_INLINE_ATTACHMENT_TOTAL_BYTES,
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
      .toThrow(/total \d+ bytes, over the \d+-byte \(25 MiB\) limit for one message/);
  });

  it('reports the total ceiling as 25 MiB and the per-file ceiling as 8 MiB', () => {
    expect(MAX_INLINE_ATTACHMENT_BYTES).toBe(8 * 1024 * 1024);
    expect(MAX_INLINE_ATTACHMENT_TOTAL_BYTES).toBe(25 * 1024 * 1024);
    // The documented text is derived from the constants, so it cannot drift.
    expect(INLINE_ATTACHMENT_LIMITS_TEXT).toBe('up to 8 MiB per file and 25 MiB in total');
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
