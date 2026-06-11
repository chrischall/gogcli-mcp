#!/usr/bin/env node
// Shared esbuild bundler that injects GOGCLI_VERSION from root package.json.
// Usage: node scripts/bundle.js <entry> <outfile>
const { execSync } = require('child_process');
const { resolve } = require('path');
const { copyFileSync } = require('fs');

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

// Stage the root LICENSE into the package being built so npm includes the
// license text in the published tarball (npm only auto-bundles a LICENSE that
// lives inside the package directory). The copies are gitignored build output.
const pkgDir = process.cwd();
if (pkgDir !== root) {
  copyFileSync(resolve(root, 'LICENSE'), resolve(pkgDir, 'LICENSE'));
}
