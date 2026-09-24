import { describe, it, expect } from 'vitest';
import { confirmKeyFromEnv, issueConfirmToken, verifyConfirmToken } from '@chrischall/mcp-utils';
import { confirmSpentStore, resetConfirmTokenState } from '../src/send-confirm-token.js';

// The token mechanism and the MCP_CONFIRM_* env layer live in
// @chrischall/mcp-utils and are tested there. What stays here is this server's
// spent-token store and the seam its tests reset it with.
describe('confirmSpentStore', () => {
  it('is one store for the process, emptied by resetConfirmTokenState', () => {
    const binding = { tool: 'gog_gmail_send', account: 'me@example.com', target: '', payloadHash: 'h' };
    const key = confirmKeyFromEnv({});
    const { token } = issueConfirmToken(key, binding);
    expect(verifyConfirmToken(key, token, binding, { spent: confirmSpentStore() })).toEqual({ ok: true });
    expect(confirmSpentStore()).toBe(confirmSpentStore());
    expect(confirmSpentStore().size).toBe(1);
    expect(verifyConfirmToken(key, token, binding, { spent: confirmSpentStore() })).toEqual({ ok: false, error: 'TOKEN_REUSED' });
    resetConfirmTokenState();
    expect(confirmSpentStore().size).toBe(0);
  });
});
