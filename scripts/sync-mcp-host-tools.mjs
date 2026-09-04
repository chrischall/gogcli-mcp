#!/usr/bin/env node
// Keep each hosted gogcli-mcp registration's `enabledTools` allowlist in step
// with the tools its child actually serves.
//
// WHY THIS EXISTS. Every gog registration on mcp-host carries an allowlist
// whose only job is to withhold the two `*_run` escape hatches — arbitrary
// `gog` subcommand execution is not something a hosted connector should offer.
// But mcp-host stores that as an ALLOWLIST of every other name, so the policy
// "hide two tools" is written as "show these 53", and the inverted form is what
// rots: ship a new tool and it is absent from a list nobody edited, so it is
// silently unreachable over the connector while working fine on stdio.
//
// mcp-host will not catch this for us, by design. `--follow` moves the version
// pin and carries `enabledTools` across untouched (auto-update.ts), and the
// daily mint-manifest check lists `tools.enable` among its DELIBERATE silences:
// "A NARROWING. A registration that ignores it serves more, not less." That is
// the right default for a host reading an unverified file out of a tarball, and
// it is the exact blind spot our policy sits in — we narrow on purpose, so only
// we can tell a deliberate narrowing from a stale one.
//
// The list is DERIVED, never authored: GET /registrations/{id}/tools returns
// what the running child offers, unnarrowed by the allowlist, so the desired
// value is that set minus the `*_run` names. Nothing here reads the repo, which
// is what lets it run against whatever version each registration has actually
// followed to rather than whatever this checkout happens to be.
//
//   node scripts/sync-mcp-host-tools.mjs                   # report drift, exit 1 if any
//   node scripts/sync-mcp-host-tools.mjs --apply           # PUT the corrected lists
//   node scripts/sync-mcp-host-tools.mjs --if-configured   # the same check, but skip when
//                                                          # there is no token (rides `npm test`)
//
// Needs MCP_HOST_URL and MCP_HOST_ADMIN_TOKEN. `--if-configured` is what makes
// it safe on the `npm test` line: this is the only check in the repo that talks
// to a live deployment, so in CI — and on any checkout without the admin token —
// it must be a no-op rather than a red build. The strict form stays the one you
// type, and it is the one that is authoritative.

const BASE = process.env.MCP_HOST_URL?.replace(/\/$/, '');
const TOKEN = process.env.MCP_HOST_ADMIN_TOKEN;
const APPLY = process.argv.includes('--apply');
const IF_CONFIGURED = process.argv.includes('--if-configured');

/**
 * Reachability failures are fatal when a human typed the command and advisory
 * when `npm test` did. An idle machine, a cold child or a dropped connection is
 * not evidence about the allowlist either way, and a guard that reddened the
 * suite for it would be muted within a week — taking the run that mattered with
 * it. What is NEVER downgraded is a check that completed and found drift.
 */
function unavailable(message) {
  if (IF_CONFIGURED) {
    console.log(`sync-mcp-host-tools: skipped — ${message}`);
    process.exit(0);
  }
  console.error(message);
  process.exit(2);
}

if (!BASE || !TOKEN) unavailable('MCP_HOST_URL and MCP_HOST_ADMIN_TOKEN must both be set');

/**
 * The escape hatches, and the whole of the policy this script enforces. A tool
 * matches on the `_run` SUFFIX so a future service's hatch is covered the day
 * it is registered rather than the day someone remembers this file.
 */
const WITHHELD = /_run$/;

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

let registrations;
try {
  ({ registrations } = await api('GET', '/api/v1/registrations'));
} catch (error) {
  unavailable(`could not reach ${BASE} — ${error.message}`);
}
const ours = registrations.filter((r) => r.source?.type === 'npm' && r.source.pkg?.startsWith('gogcli-mcp'));

if (ours.length === 0) {
  unavailable('no gogcli-mcp registrations found — is MCP_HOST_URL the right deployment?');
}

let drifted = 0;
let failed = 0;

for (const reg of ours) {
  let served;
  try {
    // The child has to be up to answer this. A registration that cannot be
    // reached is reported and skipped, never treated as "serves nothing" —
    // that mistake would PUT an empty allowlist and take the connector down.
    ({ tools: served } = await api('GET', `/api/v1/registrations/${reg.id}/tools`));
  } catch (error) {
    console.error(`${reg.slug}: could not read served tools — ${error.message}`);
    failed++;
    continue;
  }

  const all = served.map((t) => t.name);
  const desired = all.filter((n) => !WITHHELD.test(n));
  const current = reg.enabledTools ?? [];

  const missing = desired.filter((n) => !current.includes(n));
  const stale = current.filter((n) => !desired.includes(n));

  if (missing.length === 0 && stale.length === 0) {
    console.log(`${reg.slug}: ok (${desired.length} tools, ${all.length - desired.length} withheld)`);
    continue;
  }

  drifted++;
  console.log(`${reg.slug}: DRIFT — serves ${all.length}, allowlist has ${current.length}`);
  if (missing.length) console.log(`  unreachable over the connector: ${missing.join(', ')}`);
  if (stale.length) console.log(`  allowlisted but not served: ${stale.join(', ')}`);

  if (APPLY) {
    await api('PUT', `/api/v1/registrations/${reg.id}`, { enabledTools: desired });
    console.log(`  -> updated to ${desired.length} tools`);
  }
}

// A registration we could not read is not a registration we can vouch for, so
// the strict form reports it as a failure rather than as a clean run.
if (failed && !IF_CONFIGURED) process.exit(2);
if (drifted && !APPLY) {
  console.log(`\n${drifted} registration(s) drifted. Re-run with --apply to fix.`);
  process.exit(1);
}
