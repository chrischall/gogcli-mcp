import { describe, it, expect } from 'vitest';
import { diagnose } from '../../src/tools/utils.js';

/**
 * `401` is a status code, but it is also just a number, and gog's output is
 * full of numbers that are row indices, ranges and counts. The pattern used to
 * be a bare `\b401\b`, so "row 401 is outside the sheet grid" — a pure Sheets
 * range error — told the caller to re-authorize a healthy Google account.
 *
 * That is the same defect this PR exists to remove, reached from gog's stderr
 * instead of the runner's status line: a caller is sent to do a manual,
 * account-wide re-auth that cannot possibly fix their problem.
 *
 * So a 401 now has to look like a STATUS, not like an integer.
 */
const reauth = async (msg: string) => {
  const r = await diagnose(new Error(msg));
  return /Use gog_auth_add to re-authorize the account/i.test(r.content.map((c: any) => c.text).join('\n'));
};

describe('401 must look like a status, not any integer', () => {
  it.each([
    ['row 401 is outside the sheet grid'],
    ['wrote 401 rows'],
    ['A401:B401 exceeds grid limits'],
    ['deleted 401 messages'],
    ['sheet has 401 columns'],
  ])('does NOT claim an auth failure for: %s', async (msg) => {
    expect(await reauth(msg)).toBe(false);
  });

  it.each([
    ['googleapi: Error 401: Invalid Credentials, authError'],
    ['HTTP 401 Unauthorized'],
    ['request failed with status 401'],
    ['unexpected status code 401'],
    ['401 Unauthorized'],
    ['server responded 401: token rejected'],
  ])('still DOES claim an auth failure for: %s', async (msg) => {
    expect(await reauth(msg)).toBe(true);
  });
});
