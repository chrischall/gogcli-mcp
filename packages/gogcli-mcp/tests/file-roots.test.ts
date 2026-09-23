import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { confinePath, confinePaths, confineAtFile, defaultFileRoot, fileRoots, FILE_ROOTS_ENV } from '../src/file-roots.js';
import { ATTACHMENT_DOWNLOAD_ROOT } from '../src/attachment-root.js';

let scratch: string;
let saved: string | undefined;
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'gog-roots-test-'));
  saved = process.env[FILE_ROOTS_ENV];
  process.env[FILE_ROOTS_ENV] = scratch;
});
afterEach(async () => {
  if (saved === undefined) delete process.env[FILE_ROOTS_ENV];
  else process.env[FILE_ROOTS_ENV] = saved;
  await rm(scratch, { recursive: true, force: true });
});

describe('fileRoots', () => {
  it('reads a path-delimited list from GOG_FILE_ROOTS, ignoring blanks', () => {
    process.env[FILE_ROOTS_ENV] = `/a${delimiter} ${delimiter}/b`;
    expect(fileRoots()).toEqual(['/a', '/b']);
  });

  it('defaults to a dedicated directory under the home directory', () => {
    delete process.env[FILE_ROOTS_ENV];
    expect(defaultFileRoot()).toBe(join(homedir(), 'gogcli-mcp-files'));
    expect(fileRoots()).toEqual([defaultFileRoot()]);
  });

  it('treats an unresolved .mcpb placeholder as unset', () => {
    process.env[FILE_ROOTS_ENV] = '${user_config.gog_file_roots}';
    expect(fileRoots()).toEqual([defaultFileRoot()]);
  });
});

// SEC-3/SEC-4: every model-supplied server path — attach, localPath, out,
// outDir — is a read or write primitive on the host. ~/.ssh, gog's keyring,
// /proc/<pid>/environ and ~/Library/LaunchAgents are all one argument away.
describe('confinePath', () => {
  it('accepts a path inside a root and returns it unchanged', () => {
    const p = join(scratch, 'report.pdf');
    expect(confinePath(p, 'attach')).toBe(p);
  });

  it('accepts a not-yet-existing output path inside a root', () => {
    expect(confinePath(join(scratch, 'new', 'out.csv'), 'out')).toBe(join(scratch, 'new', 'out.csv'));
  });

  it('accepts the private attachment download directory', () => {
    const p = join(ATTACHMENT_DOWNLOAD_ROOT, 'm1', 'a.pdf');
    expect(confinePath(p, 'attach')).toBe(p);
  });

  it.each([
    ['/etc/passwd'],
    [join(homedir(), '.ssh', 'id_rsa')],
    ['/proc/self/environ'],
  ])('refuses %s, naming the parameter and GOG_FILE_ROOTS', (p) => {
    expect(() => confinePath(p, 'attach')).toThrow(/attach .* is outside the directories .* GOG_FILE_ROOTS/);
  });

  it('refuses a .. walk out of the root', () => {
    expect(() => confinePath(join(scratch, '..', 'x'), 'out')).toThrow(/outside/);
  });

  it('refuses a symlink inside the root that points outside it', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'gog-roots-outside-'));
    try {
      await writeFile(join(outside, 'secret'), 's');
      await mkdir(join(scratch, 'd'));
      await symlink(join(outside, 'secret'), join(scratch, 'd', 'link'));
      expect(() => confinePath(join(scratch, 'd', 'link'), 'localPath')).toThrow(/outside/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('refuses gog\'s "-" (stdin) unless the parameter allows stdout', () => {
    expect(() => confinePath('-', 'file')).toThrow(/outside/);
    expect(confinePath('-', 'out', { allowDash: true })).toBe('-');
  });
});

describe('confinePaths', () => {
  it('checks every path and tolerates undefined', () => {
    expect(() => confinePaths(undefined, 'attach')).not.toThrow();
    expect(() => confinePaths([join(scratch, 'a'), '/etc/hosts'], 'attach')).toThrow(/\/etc\/hosts/);
  });
});

describe('confineAtFile', () => {
  it('confines the path of an @file value and passes inline JSON through', () => {
    expect(confineAtFile('[{"a":1}]', 'cellsJson')).toBe('[{"a":1}]');
    expect(confineAtFile(`@${join(scratch, 'c.json')}`, 'cellsJson')).toBe(`@${join(scratch, 'c.json')}`);
    expect(() => confineAtFile('@/etc/passwd', 'cellsJson')).toThrow(/cellsJson/);
    expect(() => confineAtFile('@-', 'cellsJson')).toThrow(/outside/);
  });
});
