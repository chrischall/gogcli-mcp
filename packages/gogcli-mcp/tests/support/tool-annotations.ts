import { describe, it, expect } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { createTestHarness } from '@chrischall/mcp-utils/test';

/**
 * The fleet annotation invariants, asserted against the tools a server
 * actually REGISTERS (listTools over the real registrars), never a hand-kept
 * list. Every package's `tests/tool-annotations.test.ts` calls this with the
 * same registrar list its `src/index.ts` hands to runMcp.
 *
 * Why each check exists:
 *  - `destructiveHint` DEFAULTS TO TRUE whenever readOnlyHint is not true, so a
 *    write that forgets to declare it publishes as destructive and nothing
 *    fails — a considered `false` and a forgotten one look identical. Each
 *    write must CHOOSE.
 *  - A read that claims to be destructive is the cheap direction to get wrong.
 *  - `openWorldHint` defaults to true too; the handful of tools that only touch
 *    gog's local state (keyring/config listing, the static service catalogue,
 *    building a consent URL, the local request-batch store) say so explicitly,
 *    and every other tool says it reaches Google.
 *  - The counts are tripwires counted off the built server: growing the
 *    destructive set, or the surface, should be a decision, not a side effect.
 */
export interface AnnotationExpectations {
  tools: number;
  destructive: number;
  local: string[];
}

type Registrar = (server: McpServer) => void;

interface Ann {
  readOnlyHint?: unknown;
  destructiveHint?: unknown;
  openWorldHint?: unknown;
}

export function describeToolAnnotations(registrars: Registrar[], expected: AnnotationExpectations): void {
  async function annotations(): Promise<Array<[string, Ann | undefined]>> {
    const harness = await createTestHarness((server: McpServer) => {
      for (const register of registrars) register(server);
    });
    try {
      const { tools } = await harness.client.listTools();
      return tools.map((t) => [t.name, t.annotations as Ann | undefined]);
    } finally {
      await harness.close();
    }
  }

  describe('tool annotations', () => {
    it('registers the full surface (guards against a registrar being dropped here)', async () => {
      expect(await annotations()).toHaveLength(expected.tools);
    });

    it('sets an explicit boolean destructiveHint on every write', async () => {
      const undeclared = (await annotations())
        .filter(([, a]) => a?.readOnlyHint !== true && typeof a?.destructiveHint !== 'boolean')
        .map(([name]) => name);
      expect(undeclared).toEqual([]);
    });

    it('never lets a read claim to be destructive', async () => {
      const contradictory = (await annotations())
        .filter(([, a]) => a?.readOnlyHint === true && a?.destructiveHint === true)
        .map(([name]) => name);
      expect(contradictory).toEqual([]);
    });

    it('sets an explicit boolean openWorldHint on every tool, false only for the local-only ones', async () => {
      const all = await annotations();
      expect(all.filter(([, a]) => typeof a?.openWorldHint !== 'boolean').map(([n]) => n)).toEqual([]);
      expect(all.filter(([, a]) => a?.openWorldHint === false).map(([n]) => n).sort()).toEqual([...expected.local].sort());
    });

    it('holds the destructive set at its measured size', async () => {
      const destructive = (await annotations())
        .filter(([, a]) => a?.readOnlyHint !== true && a?.destructiveHint === true);
      expect(destructive).toHaveLength(expected.destructive);
    });
  });
}

/** The auth tools every package registers that never contact Google. */
export const LOCAL_AUTH_TOOLS = ['gog_auth_list', 'gog_auth_status', 'gog_auth_services', 'gog_auth_add_url'];
