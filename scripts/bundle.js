#!/usr/bin/env node
// Shared esbuild bundler that injects GOGCLI_VERSION from root package.json.
// Usage: node scripts/bundle.js <entry> <outfile>
const { execSync } = require('child_process');
const { resolve } = require('path');

const [entry, outfile] = process.argv.slice(2);
if (!entry || !outfile) {
  console.error('Usage: node scripts/bundle.js <entry> <outfile>');
  process.exit(1);
}

const root = resolve(__dirname, '..');
const { version } = require(resolve(root, 'package.json'));

execSync(
  `esbuild ${entry} --bundle --platform=node --format=esm --outfile=${outfile} --define:GOGCLI_VERSION=\\"${version}\\"`,
  { stdio: 'inherit' },
);
