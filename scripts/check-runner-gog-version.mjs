#!/usr/bin/env node
// The Fly runner installs ONE gog binary; the wrapper declares the minimum it
// assumes. Nothing else ties them together — the wrapper's flags are strings in
// an arg array, so a binary that predates a flag fails at RUNTIME, on the hosted
// connector, in front of a user. That is exactly how 2.21.1 shipped
// MIN_GOG_VERSION 0.35.0 while fly-gog-runner/Dockerfile still installed 0.34.1,
// leaving `--clear-reply-context` (and, once #251 releases, five more Gmail
// flags) unknown to the binary they were sent to.
//
// The per-package mint.yaml files pin the same binary for a THIRD audience: an
// mcp-host `--npm` registration installs gog from that pin, so a stale tag
// there fails the same way for a hosted user, on a path neither the Dockerfile
// nor this repo's own tests touch. They were added at v0.37.0 (#284) while a
// MIN_GOG_VERSION bump was already in flight, which is exactly how a pin goes
// stale — so they are checked here too.
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

const runner = readFileSync(new URL('../packages/gogcli-mcp/src/runner.ts', import.meta.url), 'utf8');
const dockerfile = readFileSync(new URL('../fly-gog-runner/Dockerfile', import.meta.url), 'utf8');

const min = runner.match(/MIN_GOG_VERSION\s*=\s*'([^']+)'/)?.[1];
const pinned = dockerfile.match(/^ARG GOG_VERSION=(.+)$/m)?.[1]?.trim();

if (!min) { console.error('could not read MIN_GOG_VERSION from runner.ts'); process.exit(1); }
if (!pinned) { console.error('could not read ARG GOG_VERSION from fly-gog-runner/Dockerfile'); process.exit(1); }

// Every published package that declares a gog dependency in its mint.yaml.
// Missing files are not an error (not every package must ship one); a file that
// declares the dependency with no readable tag IS, because that is a pin this
// check would otherwise silently skip.
const mintRoot = new URL('../packages/', import.meta.url);
const mintPins = globSync('*/mint.yaml', { cwd: mintRoot }).map((rel) => {
  const text = readFileSync(new URL(rel, mintRoot), 'utf8');
  if (!/repo:\s*openclaw\/gogcli/.test(text)) return null;
  const tag = text.match(/^\s*tag:\s*v?(.+)$/m)?.[1]?.trim();
  return { file: `packages/${rel}`, tag };
}).filter(Boolean);

const cmp = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0); }
  return 0;
};

if (cmp(pinned, min) < 0) {
  console.error(
    `fly-gog-runner installs gog ${pinned}, but the wrapper declares MIN_GOG_VERSION ${min}.\n` +
    `The hosted connector would send flags its own binary does not have — a runtime failure a user finds first.\n` +
    `Raise ARG GOG_VERSION in fly-gog-runner/Dockerfile to at least ${min}.`,
  );
  process.exit(1);
}
const staleMints = mintPins.filter(({ tag }) => !tag || cmp(tag, min) < 0);
if (staleMints.length > 0) {
  console.error(
    `MIN_GOG_VERSION is ${min}, but these mint.yaml files pin an older (or unreadable) gog:\n` +
    staleMints.map(({ file, tag }) => `  ${file}: ${tag ?? '<no tag found>'}`).join('\n') + '\n' +
    'An mcp-host --npm registration installs gog from that pin, so it would send flags its binary does not have.\n' +
    `Raise each dependencies[].tag to at least v${min}.`,
  );
  process.exit(1);
}

console.log(`runner gog ${pinned} >= MIN_GOG_VERSION ${min} (and ${mintPins.length} mint.yaml pins)`);
