#!/usr/bin/env node
// Deploy the Cloudflare connector Worker without hand-editing wrangler.jsonc.
//
// `wrangler.jsonc` commits a placeholder id for the OAUTH_KV binding, because
// the real namespace id should not live in source. Wrangler does NOT interpolate
// environment variables in its config (verified against wrangler 4.112: a
// "${OAUTH_KV_ID}" id is uploaded literally), so the id has to be substituted
// before wrangler ever reads the file. Doing that by hand meant "edit, deploy,
// remember to `git checkout wrangler.jsonc`" — a dance that is easy to forget and
// that risks committing the id.
//
// Instead this writes a gitignored generated config and points wrangler at it.
// The committed file is never touched, so there is nothing to revert and nothing
// to accidentally commit.
//
// The id is resolved from the first source that answers:
//   1. $OAUTH_KV_ID                       — explicit override, no API calls
//   2. `wrangler kv namespace list`       — the documented path; needs the token
//                                           to carry "Workers KV Storage: Edit"
//   3. the deployed Worker's own bindings — works with only "Workers Scripts",
//                                           but obviously requires a Worker that
//                                           is already deployed
//
// Any extra argv is forwarded to `wrangler deploy` (e.g. `--dry-run`).

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_CONFIG = join(ROOT, 'wrangler.jsonc');
const GENERATED_CONFIG = join(ROOT, 'wrangler.generated.jsonc');
const PLACEHOLDER = 'REPLACE_WITH_OAUTH_KV_NAMESPACE_ID';
const KV_TITLE = 'gogcli-connector-oauth';

const die = (msg) => {
  console.error(`\ndeploy-worker: ${msg}\n`);
  process.exit(1);
};

// A namespace id is a 32-char hex string. Validate before substituting so a
// stray error string can never be written into a config as if it were an id.
const isNamespaceId = (v) => typeof v === 'string' && /^[0-9a-f]{32}$/i.test(v.trim());

function fromEnv() {
  const id = process.env.OAUTH_KV_ID;
  if (!id) return null;
  if (!isNamespaceId(id)) die(`OAUTH_KV_ID is set but is not a 32-char hex namespace id: "${id}"`);
  return { id: id.trim(), via: '$OAUTH_KV_ID' };
}

function fromWranglerList() {
  const res = spawnSync(
    'npx',
    ['--no-install', 'wrangler', 'kv', 'namespace', 'list'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (res.status !== 0 || !res.stdout) return null;
  try {
    // Wrangler prints human preamble before the JSON array on some versions.
    const start = res.stdout.indexOf('[');
    if (start === -1) return null;
    const list = JSON.parse(res.stdout.slice(start));
    const hit = list.find((n) => n.title === KV_TITLE || n.title?.endsWith(KV_TITLE));
    return hit && isNamespaceId(hit.id) ? { id: hit.id, via: 'wrangler kv namespace list' } : null;
  } catch {
    return null;
  }
}

async function fromDeployedWorker(workerName) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) return null;
  const auth = { Authorization: `Bearer ${token}` };
  const api = 'https://api.cloudflare.com/client/v4';
  try {
    let accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId) {
      const accounts = await (await fetch(`${api}/accounts`, { headers: auth })).json();
      if (!accounts.success || !accounts.result?.length) return null;
      accountId = accounts.result[0].id;
    }
    const res = await fetch(
      `${api}/accounts/${accountId}/workers/scripts/${workerName}/bindings`,
      { headers: auth },
    );
    const body = await res.json();
    if (!body.success) return null;
    const hit = (body.result ?? []).find((b) => b.name === 'OAUTH_KV' && b.namespace_id);
    return hit && isNamespaceId(hit.namespace_id)
      ? { id: hit.namespace_id, via: `live bindings of the deployed "${workerName}"` }
      : null;
  } catch {
    return null;
  }
}

const source = readFileSync(SOURCE_CONFIG, 'utf8');
const workerName = source.match(/"name"\s*:\s*"([^"]+)"/)?.[1] ?? 'gogcli-connector';

if (!source.includes(PLACEHOLDER)) {
  die(
    `${SOURCE_CONFIG} no longer contains ${PLACEHOLDER}.\n` +
    'It looks like a real id was committed by hand — restore the placeholder ' +
    '(git checkout wrangler.jsonc) and re-run; this script supplies the id at deploy time.',
  );
}

const resolved =
  fromEnv() ?? fromWranglerList() ?? (await fromDeployedWorker(workerName));

if (!resolved) {
  die(
    `could not resolve the OAUTH_KV namespace id for "${workerName}". Try one of:\n` +
    '  • export OAUTH_KV_ID=<32-char hex id>\n' +
    `  • grant the API token "Workers KV Storage: Edit", then: npx wrangler kv namespace list\n` +
    `  • create one for a fresh environment: npx wrangler kv namespace create ${KV_TITLE}\n` +
    'See docs/DEPLOY-CONNECTOR.md.',
  );
}

// Mask the id in logs: it is not a credential, but it is account-identifying and
// this output often ends up pasted into issues and PRs.
const masked = `${resolved.id.slice(0, 4)}…${resolved.id.slice(-4)}`;
console.log(`deploy-worker: OAUTH_KV id ${masked} resolved from ${resolved.via}`);

writeFileSync(
  GENERATED_CONFIG,
  '// GENERATED — do not edit, do not commit. Produced by scripts/deploy-worker.mjs\n' +
  `// from wrangler.jsonc with the OAUTH_KV id substituted. Gitignored.\n` +
  source.replace(PLACEHOLDER, resolved.id),
);

// The generated config sits beside wrangler.jsonc in the repo root, so every
// relative path in it (notably "main") still resolves identically.
const args = ['--no-install', 'wrangler', 'deploy', '--config', GENERATED_CONFIG, ...process.argv.slice(2)];
const run = spawnSync('npx', args, { cwd: ROOT, stdio: 'inherit' });
process.exit(run.status ?? 1);
