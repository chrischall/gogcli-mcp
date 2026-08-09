#!/usr/bin/env node
// The Fly runner installs ONE gog binary; the wrapper declares the minimum it
// assumes. Nothing else ties them together — the wrapper's flags are strings in
// an arg array, so a binary that predates a flag fails at RUNTIME, on the hosted
// connector, in front of a user. That is exactly how 2.21.1 shipped
// MIN_GOG_VERSION 0.35.0 while fly-gog-runner/Dockerfile still installed 0.34.1,
// leaving `--clear-reply-context` (and, once #251 releases, five more Gmail
// flags) unknown to the binary they were sent to.
import { readFileSync } from 'node:fs';

const runner = readFileSync(new URL('../packages/gogcli-mcp/src/runner.ts', import.meta.url), 'utf8');
const dockerfile = readFileSync(new URL('../fly-gog-runner/Dockerfile', import.meta.url), 'utf8');

const min = runner.match(/MIN_GOG_VERSION\s*=\s*'([^']+)'/)?.[1];
const pinned = dockerfile.match(/^ARG GOG_VERSION=(.+)$/m)?.[1]?.trim();

if (!min) { console.error('could not read MIN_GOG_VERSION from runner.ts'); process.exit(1); }
if (!pinned) { console.error('could not read ARG GOG_VERSION from fly-gog-runner/Dockerfile'); process.exit(1); }

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
console.log(`runner gog ${pinned} >= MIN_GOG_VERSION ${min}`);
