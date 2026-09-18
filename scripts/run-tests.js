#!/usr/bin/env node
// Run every test suite in the repo UNCONDITIONALLY and fail if any of them
// failed. With `&&` chaining, one failing suite would short-circuit the rest and
// they would produce ZERO output — skipped precisely on the runs where something
// was already broken. Every suite runs here; the exit code is the worst of them.
const { spawnSync } = require('child_process');
const { resolve } = require('path');

const root = resolve(__dirname, '..');

// Each suite is a named script in the root package.json, so the actual commands
// stay declared in one place and remain individually runnable.
const suites = [
  { name: 'workspaces', script: 'test:workspaces' },
];

const failed = [];
for (const suite of suites) {
  console.log(`\n=== tests: ${suite.name} ===`);
  // shell:true so `npm` resolves via npm.cmd on Windows as well as PATH on posix.
  const { status } = spawnSync('npm', ['run', suite.script], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (status !== 0) failed.push(suite.name);
}

if (failed.length > 0) {
  console.error(`\nFAILED test suites: ${failed.join(', ')}`);
  process.exit(1);
}
