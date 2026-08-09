import { describe, it, expect } from 'vitest';
import { diagnose } from '../../src/tools/utils.js';

/**
 * #246: making 401 "look like a status" (#245 follow-up) required a separator
 * between the status word and the number. `\s*[:=]?\s*` cannot cross an opening
 * paren or a JSON quote, so the CANONICAL shape gog emits for a Google auth
 * failure stopped matching entirely:
 *
 *   Google API error (401 authError): Invalid Credentials
 *
 * That shape is hard-coded in connector-runtime.ts as /Google API error \(401\b/
 * and used as the fixture across auth-log and connector-runtime tests. Losing it
 * is strictly worse than the `row 401` false positive that motivated the change:
 * a false positive sends someone on a pointless re-auth, but this leaves a REAL
 * dead credential with no hint at all.
 */
const reauth = async (msg: string) => {
  const r = await diagnose(new Error(msg));
  return /Use gog_auth_add to re-authorize the account/i.test(r.content.map((c: any) => c.text).join('\n'));
};

describe('401 shapes that ARE auth failures', () => {
  it.each([
    ['Google API error (401 authError): Invalid Credentials'],   // the canonical gog shape
    ['Google API error (401): Invalid Credentials'],
    ['{"code": 401, "message": "Invalid Credentials"}'],          // JSON body
    ['{"status":401}'],
    ['googleapi: Error 401: Invalid Credentials, authError'],
    ['HTTP 401 Unauthorized'],
    ['request failed with status 401'],
    ['unexpected status code 401'],
    ['response=401'],
  ])('claims an auth failure for: %s', async (msg) => {
    expect(await reauth(msg)).toBe(true);
  });
});

describe('401 shapes that are NOT auth failures', () => {
  it.each([
    ['row 401 is outside the sheet grid'],
    ['wrote 401 rows'],
    ['A401:B401 exceeds grid limits'],
    ['deleted 401 messages'],
    ['sheet has 401 columns'],
    ['error: could not write row 401'],   // status word present, but far from the number
  ])('stays silent for: %s', async (msg) => {
    expect(await reauth(msg)).toBe(false);
  });
});
