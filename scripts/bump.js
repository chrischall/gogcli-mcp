#!/usr/bin/env node
// Bumps patch version in root package.json and syncs to all packages.
const fs = require('fs');
const { resolve } = require('path');

const root = resolve(__dirname, '..');
const packages = ['gogcli-mcp', 'gogcli-mcp-sheets', 'gogcli-mcp-docs'];

// Read and bump root version
const rootPkg = JSON.parse(fs.readFileSync(resolve(root, 'package.json'), 'utf8'));
const [major, minor, patch] = rootPkg.version.split('.').map(Number);
const next = `${major}.${minor}.${patch + 1}`;
rootPkg.version = next;
fs.writeFileSync(resolve(root, 'package.json'), JSON.stringify(rootPkg, null, 2) + '\n');

// Sync to each package
for (const pkg of packages) {
  const pkgDir = resolve(root, 'packages', pkg);

  const pkgJson = resolve(pkgDir, 'package.json');
  if (fs.existsSync(pkgJson)) {
    const p = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
    p.version = next;
    fs.writeFileSync(pkgJson, JSON.stringify(p, null, 2) + '\n');
  }

  const manifest = resolve(pkgDir, 'manifest.json');
  if (fs.existsSync(manifest)) {
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    m.version = next;
    fs.writeFileSync(manifest, JSON.stringify(m, null, 2) + '\n');
  }
}

console.log(`${rootPkg.version.replace(next, major + '.' + minor + '.' + patch)} → ${next}`);
