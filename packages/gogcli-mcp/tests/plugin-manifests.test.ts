import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Claude Code reads a plugin's MCP config from `mcpServers`. The key `mcp` is
// not part of the plugin schema: `claude plugin validate` reports
// "Unknown field 'mcp'" and the plugin installs with NO MCP server at all.
// Likewise every `skills` entry must name a DIRECTORY holding a SKILL.md:
// validate rejects a path to the SKILL.md file itself ("Path is a file;
// skills entries must be directories containing SKILL.md").
// Every plugin.json in the repo (root and each workspace) is checked here.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function pluginDirs(): string[] {
  const candidates = [repoRoot];
  const pkgs = join(repoRoot, 'packages');
  for (const name of readdirSync(pkgs)) candidates.push(join(pkgs, name));
  return candidates.filter((dir) => existsSync(join(dir, '.claude-plugin', 'plugin.json')));
}

describe('.claude-plugin/plugin.json', () => {
  const dirs = pluginDirs();

  it('finds the plugin manifests', () => {
    expect(dirs.length).toBeGreaterThan(0);
  });

  describe.each(dirs.map((dir) => [dir.slice(repoRoot.length + 1) || '.', dir]))('%s', (_label, dir) => {
    const manifest = JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')) as Record<string, unknown>;

    it('declares its MCP config under mcpServers, not mcp', () => {
      expect(manifest).not.toHaveProperty('mcp');
      expect(typeof manifest.mcpServers).toBe('string');
    });

    it('points mcpServers at a file that exists', () => {
      expect(existsSync(join(dir, manifest.mcpServers as string))).toBe(true);
    });

    it('points every skills entry at a directory containing SKILL.md', () => {
      const skills = manifest.skills;
      if (skills === undefined) return;
      const entries = Array.isArray(skills) ? skills : [skills];
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(typeof entry).toBe('string');
        const skillDir = join(dir, entry as string);
        expect(existsSync(skillDir) && statSync(skillDir).isDirectory(), `${entry} is not a directory`).toBe(true);
        expect(existsSync(join(skillDir, 'SKILL.md')), `${entry} has no SKILL.md`).toBe(true);
      }
    });
  });
});
