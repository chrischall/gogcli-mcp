#!/usr/bin/env node
// Usage: node scripts/bump.js [major|minor|patch]
// Bumps version in root + all workspaces, then syncs manifest.json files.
const { execSync } = require('child_process');
const fs = require('fs');
const { resolve, join } = require('path');

const level = process.argv[2] || 'patch';
if (!['major', 'minor', 'patch'].includes(level)) {
  console.error(`Usage: npm run bump [major|minor|patch] (got "${level}")`);
  process.exit(1);
}

const root = resolve(__dirname, '..');
const opts = { cwd: root, stdio: 'inherit' };

execSync(`npm version ${level} --no-git-tag-version`, opts);
execSync(`npm version ${level} --no-git-tag-version --workspaces`, opts);

// Sync manifest.json files to match the new version
const version = require(join(root, 'package.json')).version;
for (const name of fs.readdirSync(join(root, 'packages'))) {
  const manifest = join(root, 'packages', name, 'manifest.json');
  if (!fs.existsSync(manifest)) continue;
  const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  m.version = version;
  fs.writeFileSync(manifest, JSON.stringify(m, null, 2) + '\n');
}
