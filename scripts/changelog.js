#!/usr/bin/env node
// Generates a changelog from conventional commits since the last git tag.
// Usage: node scripts/changelog.js [tag]
// If no tag is given, uses the most recent tag.
// Output goes to stdout (pipe to file or use in CI).
const { execSync } = require('child_process');

const tag = process.argv[2] ||
  execSync('git describe --tags --abbrev=0 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();

const range = tag ? `${tag}..HEAD` : 'HEAD';
const raw = execSync(`git log ${range} --pretty=format:"%s" --no-merges`, { encoding: 'utf8' }).trim();

if (!raw) {
  console.log('No changes since last tag.');
  process.exit(0);
}

const sections = {
  'Breaking Changes': [],
  'Features': [],
  'Bug Fixes': [],
  'Refactors': [],
  'Documentation': [],
  'Other': [],
};

for (const line of raw.split('\n')) {
  // Strip Co-Authored-By trailers that end up in subject
  const msg = line.trim();
  if (!msg || msg.startsWith('Co-Authored-By')) continue;

  // Match conventional commit prefix
  const match = msg.match(/^(\w+)(?:\(.*?\))?(!)?:\s*(.+)/);
  if (match) {
    const [, type, breaking, description] = match;
    if (breaking) {
      sections['Breaking Changes'].push(description);
    } else if (type === 'feat') {
      sections['Features'].push(description);
    } else if (type === 'fix') {
      sections['Bug Fixes'].push(description);
    } else if (type === 'refactor') {
      sections['Refactors'].push(description);
    } else if (type === 'docs') {
      sections['Documentation'].push(description);
    } else if (type !== 'chore') {
      sections['Other'].push(description);
    }
    // Skip chore commits entirely
  } else {
    sections['Other'].push(msg);
  }
}

const parts = [];
for (const [heading, items] of Object.entries(sections)) {
  if (items.length === 0) continue;
  parts.push(`### ${heading}\n`);
  for (const item of items) {
    parts.push(`- ${item}`);
  }
  parts.push('');
}

console.log(parts.join('\n').trim());
