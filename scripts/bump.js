#!/usr/bin/env node
// Syncs version from root package.json into manifest.json files.
// Run after `npm version patch` to keep manifests in sync.
const fs = require('fs');
const { resolve, join } = require('path');

const root = resolve(__dirname, '..');
const version = require(join(root, 'package.json')).version;

for (const name of fs.readdirSync(join(root, 'packages'))) {
  const manifest = join(root, 'packages', name, 'manifest.json');
  if (!fs.existsSync(manifest)) continue;
  const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  m.version = version;
  fs.writeFileSync(manifest, JSON.stringify(m, null, 2) + '\n');
}
