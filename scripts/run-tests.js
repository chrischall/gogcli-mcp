#!/usr/bin/env node
// Run every test suite in the repo UNCONDITIONALLY and fail if any of them
// failed.
//
// THE BUG THIS FIXES: the root `test` script used to be
//   npm test --workspaces && npm test --prefix fly-gog-runner
// With `&&`, a single failing workspace assertion short-circuits and the
// fly-gog-runner suite produces ZERO output — it never runs. CI passes
// `test-command: npm test`, so the runner suite got skipped precisely on the
// runs where something was already broken, which is when its signal matters
// most. Every suite runs here; the exit code is the worst of them.
const { spawnSync } = require('child_process');
const { resolve } = require('path');

const root = resolve(__dirname, '..');

// Each suite is a named script in the root package.json, so the actual commands
// stay declared in one place and remain individually runnable
// (`npm run test:runner`) when you want just one.
const suites = [
  { name: 'workspaces', script: 'test:workspaces' },
  { name: 'fly-gog-runner', script: 'test:runner' },
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
