import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerDocsTools } from '../../src/tools/docs.js';
import * as runner from '../../src/runner.js';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { pos } from '../../src/argv.js';

vi.mock('../../src/runner.js');

const setupHandlers = () => createTestHarness(registerDocsTools);

beforeEach(() => vi.clearAllMocks());

describe('gog_docs_info', () => {
  it('calls run with correct args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"title":"My Doc","docId":"abc"}');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_docs_info', { docId: 'abc' });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'info', pos('abc')], { account: undefined });
    expect(result.content[0].text).toContain('My Doc');
  });

  it('appends the account list only on an auth failure', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce(new Error('Doc not found'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_docs_info', { docId: 'bad' });
    expect(result.content[0].text).toBe('Error: Doc not found');
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('returns plain error text when auth list also fails', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Doc not found'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_docs_info', { docId: 'bad' });
    expect(result.content[0].text).toBe('Error: Doc not found');
  });

  it('handles non-Error rejection', async () => {
    vi.mocked(runner.run)
      .mockRejectedValueOnce('raw error string');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_docs_info', { docId: 'bad' });
    expect(result.content[0].text).toBe('raw error string');
  });
});

describe('gog_docs_cat', () => {
  it('calls run with correct args', async () => {
    vi.mocked(runner.run).mockResolvedValue('Hello world');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_docs_cat', { docId: 'abc' });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'cat', pos('abc')], { account: undefined });
    expect(result.content[0].text).toBe('Hello world');
  });

  it('forwards account override', async () => {
    vi.mocked(runner.run).mockResolvedValue('text');
    const harness = await setupHandlers();
    await harness.callTool('gog_docs_cat', { docId: 'abc', account: 'other@gmail.com' });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'cat', pos('abc')], { account: 'other@gmail.com' });
  });

  it('appends --chips when requested', async () => {
    vi.mocked(runner.run).mockResolvedValue('Hello @person');
    const harness = await setupHandlers();
    await harness.callTool('gog_docs_cat', { docId: 'abc', chips: true });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'cat', pos('abc'), '--chips'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Not found'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_docs_cat', { docId: 'bad' });
    expect(result.content[0].text).toBe('Error: Not found');
  });
});

describe('gog_docs_create', () => {
  it('calls run with title', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"docId":"newid","title":"Meeting Notes"}');
    const harness = await setupHandlers();
    await harness.callTool('gog_docs_create', { title: 'Meeting Notes' });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'create', pos('Meeting Notes')], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Create failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_docs_create', { title: 'Bad' });
    expect(result.content[0].text).toBe('Error: Create failed');
  });
});

describe('gog_docs_write', () => {
  it('calls run with text flag', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_docs_write', { docId: 'abc', text: 'Hello world' });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'write', pos('abc'), '--text=Hello world'], { account: undefined });
  });

  it('adds --append flag when append is true', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_docs_write', { docId: 'abc', text: 'More text', append: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['docs', 'write', pos('abc'), '--text=More text', '--append'],
      { account: undefined },
    );
  });

  // gog 0.25.0
  it('appends to a persisted batch via --batch', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_docs_write', { docId: 'abc', text: 'T', batch: 'b1' });
    expect(runner.run).toHaveBeenCalledWith(
      ['docs', 'write', pos('abc'), '--text=T', '--batch=b1'],
      { account: undefined },
    );
  });

  // gog 0.24.0
  it('adds --check-orphans when checkOrphans is true', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_docs_write', { docId: 'abc', text: 'Rewrite', checkOrphans: true });
    expect(runner.run).toHaveBeenCalledWith(
      ['docs', 'write', pos('abc'), '--text=Rewrite', '--check-orphans'],
      { account: undefined },
    );
  });

  it('omits --append flag when append is false', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_docs_write', { docId: 'abc', text: 'text', append: false });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'write', pos('abc'), '--text=text'], { account: undefined });
  });

  // gog 0.30.0 paragraph list / indentation / spacing / keep controls
  it('adds bullets, numbering, indentation, spacing and keep flags (keep=true)', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_docs_write', {
      docId: 'abc', text: 'List', bullets: true, bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
      indentStart: 18, indentEnd: 6, indentFirstLine: 36, spaceAbove: 4, spaceBelow: 8,
      keepLinesTogether: true, keepWithNext: true,
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['docs', 'write', pos('abc'), '--text=List', '--bullets', '--bullet-preset=BULLET_DISC_CIRCLE_SQUARE',
        '--indent-start=18', '--indent-end=6', '--indent-first-line=36', '--space-above=4', '--space-below=8',
        '--keep-lines-together', '--keep-with-next'],
      { account: undefined },
    );
  });

  it('uses numbered list and negated keep flags (keep=false)', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_docs_write', {
      docId: 'abc', text: 'Steps', ordered: true, noBullets: true,
      keepLinesTogether: false, keepWithNext: false,
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['docs', 'write', pos('abc'), '--text=Steps', '--ordered', '--no-bullets',
        '--no-keep-lines-together', '--no-keep-with-next'],
      { account: undefined },
    );
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Write failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_docs_write', { docId: 'bad', text: 'x' });
    expect(result.content[0].text).toBe('Error: Write failed');
  });
});

describe('gog_docs_find_replace', () => {
  it('calls run with find and replace args', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"occurrencesChanged":2}');
    const harness = await setupHandlers();
    await harness.callTool('gog_docs_find_replace', { docId: 'abc', find: 'foo', replace: 'bar' });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'find-replace', pos('abc'), pos('foo'), pos('bar')], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Replace failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_docs_find_replace', { docId: 'bad', find: 'x', replace: 'y' });
    expect(result.content[0].text).toBe('Error: Replace failed');
  });
});

describe('gog_docs_structure', () => {
  it('calls run with correct args', async () => {
    vi.mocked(runner.run).mockResolvedValue('[1] Heading\n[2] Paragraph');
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_docs_structure', { docId: 'abc' });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'structure', pos('abc')], { account: undefined });
    expect(result.content[0].text).toContain('Heading');
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Structure failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_docs_structure', { docId: 'bad' });
    expect(result.content[0].text).toBe('Error: Structure failed');
  });
});

// SEC-3/SEC-4 through the escape hatch: `export --out=~/.zshrc` writes
// attacker-shaped bytes over a shell profile. GOG_FILE_ROOTS binds it too.
describe('gog_docs_run path confinement', () => {
  // The suite runs with GOG_FILE_ROOTS='/'; narrow it so confinement bites.
  let prevRoots: string | undefined;
  beforeEach(() => { prevRoots = process.env.GOG_FILE_ROOTS; process.env.GOG_FILE_ROOTS = '/nonexistent-gog-file-root'; });
  afterEach(() => { process.env.GOG_FILE_ROOTS = prevRoots; });

  it.each([
    ['export', ['d1', '--out=~/.zshrc']],
    ['export', ['d1', '--output', '~/.zshrc']],
    ['insert', ['d1', '--file=/etc/passwd']],
  ])('refuses docs %s %j', async (subcommand, args) => {
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_docs_run', { subcommand, args });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/outside the directories/);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('refuses the -f short form, which would hide the path', async () => {
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_docs_run', { subcommand: 'insert', args: ['d1', '-f', '/etc/passwd'] });
    expect(result.isError).toBe(true);
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe('gog_docs_run', () => {
  it('passes raw subcommand and args to runner', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_docs_run', { subcommand: 'copy', args: ['abc', 'My Copy'] });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'copy', 'abc', 'My Copy'], { account: undefined });
  });

  it('works with empty args array', async () => {
    vi.mocked(runner.run).mockResolvedValue('{}');
    const harness = await setupHandlers();
    await harness.callTool('gog_docs_run', { subcommand: 'clear', args: [] });
    expect(runner.run).toHaveBeenCalledWith(['docs', 'clear'], { account: undefined });
  });

  it('returns error text on failure', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('Run failed'));
    const harness = await setupHandlers();
    const result = await harness.callTool('gog_docs_run', { subcommand: 'clear', args: [] });
    expect(result.content[0].text).toBe('Error: Run failed');
  });
});
