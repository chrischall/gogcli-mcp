import { createSpentTokenStore, type SpentTokenStore } from '@chrischall/mcp-utils';

// ============================================================================
// THE TOKEN FALLBACK's gogcli-mcp half, which is now only its spent-token store.
// Everything else is the fleet's shared layer in @chrischall/mcp-utils
// (`confirmationFromEnv` + `requireConfirmationWithFallback`), configured by the
// same three variables as every other fleet server:
//
//   MCP_CONFIRM_MODE         ask-user (default) | auto | refuse
//   MCP_CONFIRM_TTL_SECONDS  token lifetime, default 600
//   MCP_CONFIRM_SECRET       HMAC key; default random per process
//
// WHAT THIS DOES AND DOES NOT PROVE: see mcp-utils' confirm-token module. The
// approval is a tool argument, so under ask-user the gate is the model honouring
// "show this to the user and wait"; the token guarantees what happens matches
// what was previewed, once, for one tool, account and target.
// ============================================================================

const spent = createSpentTokenStore();

/** This server's spent-token store (one per process). */
export function confirmSpentStore(): SpentTokenStore {
  return spent;
}

/** Test seam: forget every spent token. */
export function resetConfirmTokenState(): void {
  spent.clear();
}
