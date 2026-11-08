import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElicitRequest, ElicitResult } from '@modelcontextprotocol/server';
import { createTestHarness, type TestHarness } from '@chrischall/mcp-utils/test';
import type { Spawner } from '../../../gogcli-mcp/src/lib.js';
import { resetConfirmTokenState } from '../../../gogcli-mcp/src/send-confirm-token.js';
import { PlacesCache } from '../../src/places-cache.js';
import { driveQuoted, slugify } from '../../src/trip-drive.js';
import { tripTools, type TripToolDeps } from '../../src/tools/trip.js';
import { ARMATURE, command, GEO, mapsAnswer, STADIUM, type GogPlaceJson, type MapsFixtures } from '../support/fake-maps.js';

const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
// A token-shaped secret, to prove a Drive error is redacted on its way out.
const SECRET = 'ya29.a0AfH6SMBxQ9zTqLongEnoughToLookLikeAnAccessToken1234567890';

const DINER: GogPlaceJson = {
  id: 'ChIJ_diner',
  name: 'Old Diner',
  formatted_address: '1 Old Rd, Tampa, FL 33602, USA',
  google_maps_uri: 'https://maps.google.com/?cid=3',
};

const MAPS: MapsFixtures = {
  search: { 'Old Diner': DINER, 'Armature Works': ARMATURE, Cigar: STADIUM, Riverwalk: { id: 'ChIJ_rw', name: 'Tampa Riverwalk' } },
  details: { ChIJ_stadium: STADIUM },
  geocode: {
    ...GEO,
    [DINER.formatted_address!]: [{ place_id: 'ChIJ_diner', geometry: { location: { lat: 27.9, lng: -82.4 } } }],
  },
};

const FOLDER_MIME = 'application/vnd.google-apps.folder';

interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  parent: string;
  webViewLink: string;
}

/** A fake `gog` that keeps a little Drive in memory and records every argv. */
function fakeGog(opts: { fail?: (argv: string[]) => string | undefined; maps?: MapsFixtures } = {}) {
  const items: DriveItem[] = [];
  const argvs: string[][] = [];
  const shares: Array<{ id: string; flags: string[] }> = [];
  let n = 0;
  const flag = (argv: string[], name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const positionals = (argv: string[]) => argv.slice(argv.indexOf('--') + 1);

  function answer(argv: string[]): { code: number; stdout?: string; stderr?: string } {
    const failure = opts.fail?.(argv);
    if (failure) return { code: 1, stderr: failure };
    const maps = mapsAnswer(argv, opts.maps ?? MAPS);
    if (maps) return maps;
    const cmd = command(argv).slice(0, 2).join(' ');
    if (cmd === 'drive ls') {
      const parent = flag(argv, 'parent') ?? 'root';
      const query = flag(argv, 'query') ?? '';
      const wantFolder = query.includes(`mimeType = '${FOLDER_MIME}'`);
      const name = /name = '((?:[^'\\]|\\.)*)'/.exec(query)?.[1]?.replace(/\\(.)/g, '$1');
      const files = items.filter((i) => i.parent === parent
        && (wantFolder ? i.mimeType === FOLDER_MIME : i.mimeType !== FOLDER_MIME)
        && (name === undefined || i.name === name));
      return { code: 0, stdout: JSON.stringify({ files: files.length ? files : null, count: files.length, nextPageToken: '' }) };
    }
    if (cmd === 'drive mkdir') {
      const id = `fold-${++n}`;
      const item = { id, name: positionals(argv)[0]!, mimeType: FOLDER_MIME, parent: flag(argv, 'parent') ?? 'root', webViewLink: `https://drive.google.com/drive/folders/${id}` };
      items.push(item);
      return { code: 0, stdout: JSON.stringify({ folder: { id, name: item.name, webViewLink: item.webViewLink } }) };
    }
    if (cmd === 'drive upload') {
      const replace = flag(argv, 'replace');
      if (replace) {
        const item = items.find((i) => i.id === replace)!;
        return { code: 0, stdout: JSON.stringify({ file: item, replaced: true, preservedFileId: true }) };
      }
      const id = `file-${++n}`;
      const item = { id, name: flag(argv, 'name')!, mimeType: flag(argv, 'mime-type')!, parent: flag(argv, 'parent')!, webViewLink: `https://drive.google.com/file/d/${id}/view` };
      items.push(item);
      return { code: 0, stdout: JSON.stringify({ file: item }) };
    }
    if (cmd === 'drive share') {
      shares.push({ id: positionals(argv)[0]!, flags: argv.filter((a) => a.startsWith('--')) });
      return { code: 0, stdout: JSON.stringify({ permissionId: 'perm-1' }) };
    }
    return { code: 1, stderr: `unexpected gog call: ${argv.join(' ')}` };
  }

  const spawner = ((_cmd: string, argv: string[]) => {
    argvs.push(argv);
    const proc = new EventEmitter() as ReturnType<Spawner>;
    const io = proc as unknown as { stdout: EventEmitter; stderr: EventEmitter };
    io.stdout = new EventEmitter();
    io.stderr = new EventEmitter();
    proc.kill = vi.fn();
    const reply = answer(argv);
    setTimeout(() => {
      if (reply.stdout) io.stdout.emit('data', Buffer.from(reply.stdout));
      if (reply.stderr) io.stderr.emit('data', Buffer.from(reply.stderr));
      proc.emit('close', reply.code);
    }, 0);
    return proc;
  }) as unknown as Spawner;

  const calls = (...words: string[]) => argvs.filter((a) => words.every((w, i) => command(a)[i] === w));
  const mapsCalls = () => argvs.filter((a) => command(a)[0] === 'maps');
  return { spawner, items, argvs, shares, calls, mapsCalls };
}

let dir: string;
let roots: string;
let cache: PlacesCache;
let harness: TestHarness;
const ORIGINAL_ENV = { ...process.env };

async function start(
  gog: ReturnType<typeof fakeGog>,
  opts: { deps?: Partial<TripToolDeps>; elicitation?: (r: ElicitRequest) => ElicitResult } = {},
): Promise<void> {
  await harness?.close();
  harness = await createTestHarness(tripTools({
    spawner: gog.spawner,
    cache: () => cache,
    ...opts.deps,
  }), opts.elicitation ? { elicitation: opts.elicitation } : undefined);
}

type Result = Awaited<ReturnType<TestHarness['callTool']>>;
const texts = (r: Result): string[] => (r.content as Array<{ type: string; text: string }>).map((c) => c.text);
const data = (r: Result): Record<string, any> => JSON.parse(texts(r).at(-1)!);

const STOPS = [
  { day: 2, time: '12:00', name: 'Old Diner', address: 'Tampa, FL', category: 'food' },
  { day: 1, time: '19:30', name: 'Armature Works', address: 'Tampa, FL', category: 'food', note: 'dinner' },
  { day: 1, time: '13:00', name: 'Raymond James Stadium', place_id: 'ChIJ_stadium', category: 'event' },
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trip-tool-test-'));
  roots = join(dir, 'files');
  process.env = { ...ORIGINAL_ENV, GOG_FILE_ROOTS: roots };
  delete process.env.GOG_READONLY;
  delete process.env.GOG_ACCOUNT;
  delete process.env.MCP_CONFIRM_MODE;
  delete process.env.MCP_CONFIRM_ELICITATION;
  resetConfirmTokenState();
  cache = new PlacesCache({ path: join(dir, 'places-cache.json'), now: () => T0, log: () => {} });
});

afterEach(async () => {
  await harness?.close();
  process.env = ORIGINAL_ENV;
  await rm(dir, { recursive: true, force: true });
});

describe('helpers', () => {
  it('slugifies titles into safe file names', () => {
    expect(slugify('Tampa Weekend — Nov 2026!')).toBe('tampa-weekend-nov-2026');
    expect(slugify('Café & Crème')).toBe('cafe-creme');
    expect(slugify('***')).toBe('trip');
    expect(slugify('x'.repeat(100))).toHaveLength(60);
  });

  it('quotes Drive query strings', () => {
    expect(driveQuoted("Bob's \\ trip")).toBe("'Bob\\'s \\\\ trip'");
  });
});

describe('gog_trip_map', () => {
  it('resolves, warns closed and not-open stops first, writes KML/CSV and uploads them into Trips/<title>', async () => {
    const gog = fakeGog();
    await start(gog);
    const r = await harness.callTool('gog_trip_map', {
      title: 'Tampa Weekend',
      start_date: '2026-11-21',
      stops: [...STOPS, { day: 2, time: '10:00', name: 'Armature Works', address: 'Tampa, FL' }],
    });
    expect(r.isError).toBeFalsy();
    const [loud] = texts(r);
    expect(loud.split('\n')).toEqual([expect.stringMatching(/^Approximate: Raymond James Stadium/)]);

    const out = data(r);
    expect(out.title).toBe('Tampa Weekend');
    expect(out.days.map((d: { day: string }) => d.day)).toEqual(['Day 1 — Sat 21 Nov', 'Day 2 — Sun 22 Nov']);
    expect(out.days[0].stops).toEqual([
      {
        time: '13:00', name: 'Raymond James Stadium', status: 'approximate', pin: 'https://maps.google.com/?cid=2',
        warnings: [expect.stringMatching(/^Approximate/)],
      },
      { time: '19:30', name: 'Armature Works', status: 'ok', pin: 'https://maps.google.com/?cid=1' },
    ]);
    expect(out.days[1].stops.map((x: { status: string }) => x.status)).toEqual(['ok', 'ok']);
    expect(out.unresolved).toBeUndefined();
    // Armature Works twice is one lookup: the second is a cache hit.
    expect(out.gogCalls).toEqual({ search: 2, details: 1, geocode: 3 });
    expect(out.places).toBeUndefined();

    // Local files under GOG_FILE_ROOTS, in a fresh dir.
    expect(out.files.kml.path.startsWith(join(roots, 'trips'))).toBe(true);
    expect(out.files.kml.name).toBe('tampa-weekend.kml');
    const kml = readFileSync(out.files.kml.path, 'utf8');
    expect(kml).toContain('<name>Tampa Weekend</name>');
    expect(kml).toContain('-82.4637,27.9606,0');
    expect(readFileSync(out.files.csv.path, 'utf8')).toContain('Armature Works');
    expect(out.files.kml.content).toBeUndefined();

    // Drive: Trips (root) → Tampa Weekend, both files uploaded into it.
    const [trips, folder] = gog.items.filter((i) => i.mimeType === FOLDER_MIME);
    expect(trips).toMatchObject({ name: 'Trips', parent: 'root' });
    expect(folder).toMatchObject({ name: 'Tampa Weekend', parent: trips!.id });
    expect(gog.calls('drive', 'mkdir')[0]).not.toContain('--parent=root');
    const uploads = gog.calls('drive', 'upload');
    expect(uploads).toHaveLength(2);
    expect(uploads[0]).toEqual(expect.arrayContaining([
      '--name=tampa-weekend.kml', '--mime-type=application/vnd.google-earth.kml+xml', `--parent=${folder!.id}`, out.files.kml.path,
    ]));
    expect(uploads[1]).toEqual(expect.arrayContaining(['--name=tampa-weekend.csv', '--mime-type=text/csv']));
    expect(out.folder).toEqual({ id: folder!.id, path: 'Trips/Tampa Weekend', link: folder!.webViewLink, created: true });
    expect(out.files.kml.driveLink).toMatch(/^https:\/\/drive\.google\.com\/file\/d\//);
    expect(out.importIntoMyMaps).toEqual([
      '1. Open https://www.google.com/maps/d/ and click "Create a new map".',
      '2. In "Untitled layer" click "Import", choose "Google Drive", pick tampa-weekend.kml in Trips/Tampa Weekend.',
      '3. Name the map Tampa Weekend; Share → add the same people (My Maps sharing is separate from the folder\'s).',
    ]);
    expect(out.share).toBeUndefined();
    expect(gog.shares).toEqual([]);
  });

  it('reuses the folders and replaces same-named files on a re-run, at no Places cost', async () => {
    const gog = fakeGog();
    await start(gog);
    const args = { title: 'Tampa Weekend', stops: STOPS };
    const first = data(await harness.callTool('gog_trip_map', args));
    const before = gog.mapsCalls().length;
    const again = data(await harness.callTool('gog_trip_map', args));
    expect(gog.mapsCalls().length).toBe(before);
    expect(again.gogCalls).toEqual({ search: 0, details: 0, geocode: 0 });
    expect(gog.calls('drive', 'mkdir')).toHaveLength(2);
    expect(again.folder).toEqual({ ...first.folder, created: false });
    expect(gog.items.filter((i) => i.mimeType !== FOLDER_MIME)).toHaveLength(2);
    const replaced = gog.calls('drive', 'upload').slice(2);
    expect(replaced[0]).toContain(`--replace=${first.files.kml.driveId}`);
    expect(replaced[0]!.some((a) => a.startsWith('--parent='))).toBe(false);
    expect(again.files.kml.driveLink).toBe(first.files.kml.driveLink);
    // No start_date with numbered days: a note says they stay numbered.
    expect(again.notes[0]).toMatch(/No start_date/);
  });

  it('puts Trips under drive_parent when given', async () => {
    const gog = fakeGog();
    await start(gog);
    await harness.callTool('gog_trip_map', { title: 'T', stops: STOPS, drive_parent: 'parent-9' });
    expect(gog.items[0]).toMatchObject({ name: 'Trips', parent: 'parent-9' });
    expect(gog.calls('drive', 'ls')[0]).toContain('--parent=parent-9');
  });

  it('GOG_READONLY: no Drive call at all, files inline and on disk, sharing skipped', async () => {
    process.env.GOG_READONLY = '1';
    const gog = fakeGog();
    await start(gog);
    const out = data(await harness.callTool('gog_trip_map', {
      title: 'T', stops: STOPS, share_with: ['a@example.com'], confirm_share: true,
    }));
    expect(gog.calls('drive')).toEqual([]);
    expect(out.drive).toEqual({ skipped: true, reason: expect.stringMatching(/GOG_READONLY/) });
    expect(out.share).toEqual({ shared: false, reason: expect.stringMatching(/GOG_READONLY/) });
    expect(out.files.kml.content).toContain('<kml');
    expect(out.files.csv.content).toContain('Day,Time,Name');
    expect(out.importIntoMyMaps[1]).toMatch(/choose "Upload", pick t\.kml \(at .*t\.kml\)/);
  });

  it('upload: false skips Drive and sharing', async () => {
    const gog = fakeGog();
    await start(gog);
    const out = data(await harness.callTool('gog_trip_map', {
      title: 'T', stops: STOPS, upload: false, share_with: ['a@example.com'], confirm_share: true,
    }));
    expect(gog.calls('drive')).toEqual([]);
    expect(out.drive.reason).toMatch(/upload: false/);
    expect(out.share.reason).toMatch(/upload: false/);
  });

  it('share_with without confirm_share shares nothing and says so', async () => {
    const gog = fakeGog();
    await start(gog);
    const out = data(await harness.callTool('gog_trip_map', { title: 'T', stops: STOPS, share_with: ['a@example.com'] }));
    expect(gog.shares).toEqual([]);
    expect(out.share).toEqual({ shared: false, reason: expect.stringMatching(/confirm_share/) });
    expect(gog.calls('drive', 'upload')).toHaveLength(2);
  });

  it('shares the FOLDER as reader with each email, only after the user confirms the prompt', async () => {
    const seen: ElicitRequest[] = [];
    const gog = fakeGog();
    await start(gog, { elicitation: (r) => { seen.push(r); return { action: 'accept', content: { confirmed: true } }; } });
    const r = await harness.callTool('gog_trip_map', {
      title: 'T', stops: STOPS, share_with: ['A@example.com', 'b@example.com', 'a@example.com'], confirm_share: true,
    });
    expect(seen).toHaveLength(1);
    const details = JSON.parse(seen[0]!.params.message.split('\n').slice(1).join('\n')).details;
    expect(details).toEqual({ folder: 'Trips/T', emails: ['a@example.com', 'b@example.com'], role: 'reader' });
    const folder = gog.items.find((i) => i.name === 'T')!;
    expect(gog.shares).toEqual([
      { id: folder.id, flags: expect.arrayContaining(['--to=user', '--email=a@example.com', '--role=reader']) },
      { id: folder.id, flags: expect.arrayContaining(['--to=user', '--email=b@example.com', '--role=reader']) },
    ]);
    for (const s of gog.shares) expect(s.flags.join(' ')).not.toMatch(/anyone|domain|discoverable/);
    expect(data(r).share).toEqual({ shared: true, folder: 'Trips/T', sharedWith: ['a@example.com', 'b@example.com'], role: 'reader' });
  });

  it('a declined prompt still builds and uploads the map, but shares nothing', async () => {
    const gog = fakeGog();
    await start(gog, { elicitation: () => ({ action: 'decline' }) });
    const out = data(await harness.callTool('gog_trip_map', { title: 'T', stops: STOPS, share_with: ['a@example.com'], confirm_share: true }));
    expect(gog.shares).toEqual([]);
    expect(gog.calls('drive', 'upload')).toHaveLength(2);
    expect(out.share).toMatchObject({ shared: false, reason: expect.stringMatching(/not confirmed/), confirmation: { cancelled: true } });
  });

  it('token fallback: phase 1 does nothing and previews; phase 2 with the token shares', async () => {
    const gog = fakeGog();
    await start(gog);
    const args = { title: 'T', stops: STOPS, share_with: ['a@example.com'], confirm_share: true, drive_parent: 'parent-9' };
    const phase1 = data(await harness.callTool('gog_trip_map', args));
    expect(phase1.status).toBe('confirmation-required');
    expect(JSON.stringify(phase1)).toContain('parent-9');
    expect(gog.argvs).toEqual([]);
    const phase2 = data(await harness.callTool('gog_trip_map', { ...args, confirmToken: phase1.confirmToken }));
    expect(phase2.share.shared).toBe(true);
    expect(gog.shares).toHaveLength(1);
  });

  it('MCP_CONFIRM_MODE=refuse: builds the map and reports the share as refused', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    const gog = fakeGog();
    await start(gog);
    const out = data(await harness.callTool('gog_trip_map', { title: 'T', stops: STOPS, share_with: ['a@example.com'], confirm_share: true }));
    expect(gog.shares).toEqual([]);
    expect(out.share.shared).toBe(false);
    expect(gog.calls('drive', 'upload')).toHaveLength(2);
  });

  it('refuses anything but plain emails in share_with', async () => {
    const gog = fakeGog();
    await start(gog);
    for (const bad of ['anyone', 'example.com']) {
      const r = await harness.callTool('gog_trip_map', { title: 'T', stops: STOPS, share_with: [bad], confirm_share: true });
      expect(r.isError).toBe(true);
    }
    expect(gog.argvs).toEqual([]);
  });

  it('a Drive failure keeps the local files, reports the error redacted, and reports a partial share', async () => {
    const gog = fakeGog({ fail: (argv) => (argv.includes('--email=b@example.com') ? `share failed ${SECRET}` : undefined) });
    await start(gog, { elicitation: () => ({ action: 'accept', content: { confirmed: true } }) });
    const r = await harness.callTool('gog_trip_map', {
      title: 'T', stops: STOPS, share_with: ['a@example.com', 'b@example.com'], confirm_share: true,
    });
    expect(r.isError).toBeFalsy();
    const out = data(r);
    expect(out.drive.error).toMatch(/share failed/);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(out.share).toMatchObject({ shared: false, sharedWith: ['a@example.com'], reason: expect.stringMatching(/Drive step failed/) });
    // The uploads landed before the share failed, so the files are in Drive.
    expect(out.files.kml.driveLink).toBeDefined();
    expect(out.files.kml.content).toBeUndefined();
    expect(readFileSync(out.files.kml.path, 'utf8')).toContain('<kml');
  });

  it('reports a mkdir that returns no folder id', async () => {
    const gog = fakeGog();
    const odd = ((cmd: string, argv: string[], o: { env: NodeJS.ProcessEnv }) => {
      if (argv.includes('mkdir')) return fakeGog({ fail: () => undefined }).spawner('gog', ['drive', 'share', '--', 'x'], o);
      return gog.spawner(cmd, argv, o);
    }) as unknown as Spawner;
    await start(gog, { deps: { spawner: odd } });
    const out = data(await harness.callTool('gog_trip_map', { title: 'T', stops: STOPS }));
    expect(out.drive.error).toMatch(/no folder id/);
    expect(out.folder).toBeUndefined();
    expect(out.files.kml.content).toContain('<kml');
    expect(out.importIntoMyMaps[1]).toMatch(/choose "Upload"/);
  });

  it('lists a place the geocoder cannot place as unresolved (and leaves it off the KML)', async () => {
    const gog = fakeGog();
    await start(gog);
    const out = data(await harness.callTool('gog_trip_map', { title: 'T', stops: [{ day: 1, name: 'Tampa Riverwalk' }], upload: false }));
    expect(out.unresolved).toEqual([{ day: 'Day 1', name: 'Tampa Riverwalk', status: 'approximate', reason: 'no coordinates for this place' }]);
    expect(out.files.kml.content).not.toContain('Tampa Riverwalk');
  });

  it('a stop not found is unresolved, keeps a search pin, and view: full returns each lookup', async () => {
    const gog = fakeGog();
    await start(gog);
    const r = await harness.callTool('gog_trip_map', {
      title: 'T', start_date: '2026-11-21', stops: [...STOPS, { day: 1, name: 'Nowhere Cafe', address: 'Tampa, FL' }], view: 'full', upload: false,
    });
    const out = data(r);
    expect(out.unresolved).toEqual([{ day: 'Day 1 — Sat 21 Nov', name: 'Nowhere Cafe', status: 'not_found', reason: 'no match found' }]);
    expect(texts(r)[0]).toContain('Not found: Nowhere Cafe');
    expect(out.files.kml.content).not.toContain('Nowhere Cafe');
    expect(out.places).toHaveLength(4);
    expect(out.places[0]).toMatchObject({ placeId: 'ChIJ_stadium', status: 'approximate', cached: false });
    expect(out.days[0].stops[2].pin).toContain('/maps/search/?api=1&query=Nowhere%20Cafe%2C%20Tampa%2C%20FL');
  });

  it('stop coordinates become the pin with no geocode; half a pair is refused before anything runs', async () => {
    const gog = fakeGog();
    await start(gog);
    const out = data(await harness.callTool('gog_trip_map', {
      title: 'T', stops: [{ day: 1, name: 'Armature Works', lat: 27.5, lng: -82.5 }], upload: false,
    }));
    expect(out.days[0].stops[0].status).toBe('ok');
    expect(out.files.kml.content).toContain('-82.5,27.5,0');
    expect(gog.calls('maps', 'geocode')).toEqual([]);
    const before = gog.argvs.length;
    const bad = await harness.callTool('gog_trip_map', { title: 'T', stops: [{ day: 1, name: 'X', lng: 2 }] });
    expect(bad.isError).toBe(true);
    expect(texts(bad)[0]).toMatch(/stop 1: give both lat and lng, or neither/);
    expect(gog.argvs.length).toBe(before);
  });

  it('flags an ambiguous match', async () => {
    const gog = fakeGog();
    await start(gog);
    const r = await harness.callTool('gog_trip_map', {
      title: 'T', start_date: '2026-11-21', stops: [{ day: 1, time: '03:00', name: 'Cigar City Brewing' }],
    });
    expect(texts(r)[0]!.split('\n')[0]).toBe('Ambiguous: asked for "Cigar City Brewing", the top match is "Raymond James Stadium"');
  });

  it('never uses route URLs', async () => {
    const gog = fakeGog();
    await start(gog);
    const r = await harness.callTool('gog_trip_map', { title: 'T', stops: STOPS });
    expect(JSON.stringify(r)).not.toContain('/maps/dir/');
  });

  it('rejects bad stops before spending anything', async () => {
    const gog = fakeGog();
    await start(gog);
    const r = await harness.callTool('gog_trip_map', { title: 'T', stops: [{ day: 1, time: '25:00', name: 'X' }] });
    expect(r.isError).toBe(true);
    expect(texts(r)[0]).toMatch(/time "25:00"/);
    expect(gog.argvs).toEqual([]);
  });

  it('fails cleanly when the file root cannot be written', async () => {
    writeFileSync(roots, 'not a dir');
    const gog = fakeGog();
    await start(gog);
    const r = await harness.callTool('gog_trip_map', { title: 'T', stops: STOPS });
    expect(r.isError).toBe(true);
    expect(gog.calls('drive')).toEqual([]);
  });

  it('uses the default per-process cache when none is injected', async () => {
    const gog = fakeGog();
    process.env.HOME = dir;
    await start(gog, { deps: { cache: undefined } });
    const r = await harness.callTool('gog_trip_map', { title: 'T', stops: STOPS, upload: false });
    expect(r.isError).toBeFalsy();
  });
});
