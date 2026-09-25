import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerExtraDocsTools, docTitle } from '../../src/tools/docs-extra.js';
import * as lib from '../../../gogcli-mcp/src/lib.js';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { rawTextResult } from '@chrischall/mcp-utils';
import type { ElicitRequest, ElicitResult } from '@modelcontextprotocol/server';
import { pos } from '../../../gogcli-mcp/src/argv.js';
import { resetConfirmTokenState } from '../../../gogcli-mcp/src/send-confirm-token.js';

vi.mock('../../../gogcli-mcp/src/lib.js', async (importOriginal) => {
  const actual = await importOriginal<typeof lib>();
  return { ...actual, runOrDiagnose: vi.fn() };
});

// Fleet audit 2026-09-24 SEC-6: a Doc comment or reply notifies the owner, the
// thread and everyone it +mentions, so both ask first — naming the Doc.

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MCP_CONFIRM_MODE;
  resetConfirmTokenState();
});
afterEach(() => { process.env = ORIGINAL_ENV; });

const json = (r: { content: Array<{ text?: string }> }) => JSON.parse(r.content[0]!.text as string);
async function prompted(answer: ElicitResult = { action: 'accept', content: { confirmed: true } }) {
  const seen: ElicitRequest[] = [];
  const harness = await createTestHarness(registerExtraDocsTools, { elicitation: async (r) => { seen.push(r); return answer; } });
  const details = () => JSON.parse(seen[0]!.params.message.split('\n').slice(1).join('\n')).details;
  return { harness, seen, details };
}
const unprompted = () => createTestHarness(registerExtraDocsTools);

const INFO = JSON.stringify({ document: { documentId: 'd1', title: 'Q3 plan' } });
const COMMENT = JSON.stringify({ comment: { id: 'k1', content: 'Is this final?', author: { displayName: 'Alice' } } });
function stub(failing?: string, info = INFO) {
  vi.mocked(lib.runOrDiagnose).mockImplementation(async (args) => {
    const key = args.filter((a): a is string => typeof a === 'string' && !a.startsWith('--')).join(' ');
    if (failing && key.startsWith(failing)) return { content: [{ type: 'text', text: 'Error: not found' }], isError: true };
    if (key === 'docs info') return rawTextResult(info);
    if (key === 'docs comments get') return rawTextResult(COMMENT);
    return rawTextResult('{"ok":true}');
  });
}
const callsTo = (...words: string[]) => vi.mocked(lib.runOrDiagnose).mock.calls.filter(([args]) =>
  words.every((w, i) => args[i] === w));

describe('gog_docs_comments_add', () => {
  const ARGS = { docId: 'd1', content: 'Check with @bob@example.com', quoted: 'Revenue' };

  it('reads the Doc and asks with its title, the text, the quote and who is mentioned', async () => {
    stub();
    const { harness, details } = await prompted();
    await harness.callTool('gog_docs_comments_add', ARGS);
    expect(details()).toEqual({ doc: { id: 'd1', title: 'Q3 plan' }, textPreview: ARGS.content, quoted: 'Revenue', mentions: ['bob@example.com'] });
    expect(callsTo('docs', 'comments', 'add')[0]![0]).toEqual(['docs', 'comments', 'add', pos('d1'), pos(ARGS.content), '--quoted=Revenue']);
  });

  it('posts nothing when the user declines or the read fails', async () => {
    stub();
    expect(json(await (await prompted({ action: 'decline' })).harness.callTool('gog_docs_comments_add', ARGS)))
      .toMatchObject({ cancelled: true, action: 'docs.comment-add' });
    stub('docs info');
    expect((await (await prompted()).harness.callTool('gog_docs_comments_add', ARGS)).isError).toBe(true);
    expect(callsTo('docs', 'comments', 'add')).toHaveLength(0);
  });

  it('refuses a client that cannot be prompted', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    stub();
    const r = json(await (await unprompted()).callTool('gog_docs_comments_add', ARGS));
    expect(r).toMatchObject({ reason: 'confirmation-unsupported', action: 'docs.comment-add' });
    expect(r.note).toMatch(/Google Docs/);
  });

  it('token fallback: changed text is DRAFT_CHANGED; the same call posts', async () => {
    process.env.MCP_CONFIRM_MODE = 'ask-user';
    stub(undefined, '{}');
    const harness = await unprompted();
    const args = { docId: 'd1', content: 'Nice' };
    const p1 = json(await harness.callTool('gog_docs_comments_add', args));
    expect(p1.preview).toEqual({ doc: { id: 'd1' }, text: 'Nice', mentions: [] });
    expect(json(await harness.callTool('gog_docs_comments_add', { ...args, content: 'Nicer', confirmToken: p1.confirmToken })))
      .toMatchObject({ error: 'DRAFT_CHANGED' });
    await harness.callTool('gog_docs_comments_add', { ...args, confirmToken: p1.confirmToken });
    expect(callsTo('docs', 'comments', 'add')).toHaveLength(1);
  });
});

describe('gog_docs_comments_reply', () => {
  const ARGS = { docId: 'd1', commentId: 'k1', content: 'Yes.' };

  it('reads the Doc and the comment and asks with both and the reply', async () => {
    stub();
    const { harness, details } = await prompted();
    await harness.callTool('gog_docs_comments_reply', ARGS);
    expect(details()).toEqual({ doc: { id: 'd1', title: 'Q3 plan' }, replyingTo: { author: 'Alice', content: 'Is this final?' }, textPreview: 'Yes.', mentions: [] });
    expect(callsTo('docs', 'comments', 'reply')[0]![0]).toEqual(['docs', 'comments', 'reply', pos('d1'), pos('k1'), pos('Yes.')]);
  });

  it.each(['docs info', 'docs comments get'])('returns a failed read (%s) without asking or replying', async (failing) => {
    stub(failing);
    const { harness, seen } = await prompted();
    expect((await harness.callTool('gog_docs_comments_reply', ARGS)).isError).toBe(true);
    expect(seen).toHaveLength(0);
    expect(callsTo('docs', 'comments', 'reply')).toHaveLength(0);
  });

  it('refuses a client that cannot be prompted', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    stub();
    const r = json(await (await unprompted()).callTool('gog_docs_comments_reply', ARGS));
    expect(r).toMatchObject({ reason: 'confirmation-unsupported', action: 'docs.comment-reply' });
  });

  it('token fallback: previews the thread and posts on phase 2', async () => {
    process.env.MCP_CONFIRM_MODE = 'ask-user';
    stub();
    const harness = await unprompted();
    const p1 = json(await harness.callTool('gog_docs_comments_reply', ARGS));
    expect(p1.preview).toEqual({ doc: { id: 'd1', title: 'Q3 plan' }, replyingTo: { author: 'Alice', content: 'Is this final?' }, text: 'Yes.', mentions: [] });
    await harness.callTool('gog_docs_comments_reply', { ...ARGS, confirmToken: p1.confirmToken });
    expect(callsTo('docs', 'comments', 'reply')).toHaveLength(1);
  });
});

describe('docTitle', () => {
  it('reads a nested or top-level title and tolerates unreadable output', () => {
    expect(docTitle(JSON.stringify({ document: { title: 'A' } }))).toBe('A');
    expect(docTitle(JSON.stringify({ title: 'B' }))).toBe('B');
    expect(docTitle(JSON.stringify({ title: 7 }))).toBeUndefined();
    expect(docTitle('null')).toBeUndefined();
    expect(docTitle('nope')).toBeUndefined();
  });
});
