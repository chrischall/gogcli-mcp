import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerExtraDriveTools } from '../../src/tools/drive-extra.js';
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

// Fleet audit 2026-09-24 SEC-6: a Drive comment or reply notifies the owner, the
// thread and everyone it +mentions, so both ask first — naming the file.

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
  const harness = await createTestHarness(registerExtraDriveTools, { elicitation: async (r) => { seen.push(r); return answer; } });
  const details = () => JSON.parse(seen[0]!.params.message.split('\n').slice(1).join('\n')).details;
  return { harness, seen, details };
}
const unprompted = () => createTestHarness(registerExtraDriveTools);

const FILE = JSON.stringify({ file: { id: 'f1', name: 'Q3 plan', mimeType: 'application/vnd.google-apps.document' } });
const COMMENT = JSON.stringify({ comment: { id: 'k1', content: 'Is this final?', author: { displayName: 'Alice', emailAddress: 'alice@example.com' }, resolved: false } });
function stub(failing?: string, file = FILE) {
  vi.mocked(lib.runOrDiagnose).mockImplementation(async (args) => {
    const key = args.filter((a): a is string => typeof a === 'string' && !a.startsWith('--')).join(' ');
    if (failing && key.startsWith(failing)) return { content: [{ type: 'text', text: 'Error: not found' }], isError: true };
    if (key === 'drive get') return rawTextResult(file);
    if (key === 'drive comments get') return rawTextResult(COMMENT);
    return rawTextResult('{"ok":true}');
  });
}
const callsTo = (...words: string[]) => vi.mocked(lib.runOrDiagnose).mock.calls.filter(([args]) =>
  words.every((w, i) => args[i] === w));

describe('gog_drive_comments_add', () => {
  const ARGS = { fileId: 'f1', content: 'Looks good +bob@example.com' };

  it('reads the file and asks with its name, the text and who is mentioned', async () => {
    stub();
    const { harness, details } = await prompted();
    await harness.callTool('gog_drive_comments_add', ARGS);
    expect(details()).toEqual({ file: { id: 'f1', name: 'Q3 plan' }, textPreview: 'Looks good +bob@example.com', mentions: ['bob@example.com'] });
    expect(callsTo('drive', 'comments', 'create')[0]![0]).toEqual(['drive', 'comments', 'create', pos('f1'), pos(ARGS.content)]);
  });

  it('names only the id when the file read carries no name', async () => {
    stub(undefined, '{}');
    const { harness, details } = await prompted({ action: 'decline' });
    await harness.callTool('gog_drive_comments_add', ARGS);
    expect(details().file).toEqual({ id: 'f1' });
  });

  it('posts nothing when the user declines or the read fails', async () => {
    stub();
    expect(json(await (await prompted({ action: 'decline' })).harness.callTool('gog_drive_comments_add', ARGS)))
      .toMatchObject({ cancelled: true, action: 'drive.comment-add' });
    stub('drive get');
    expect((await (await prompted()).harness.callTool('gog_drive_comments_add', ARGS)).isError).toBe(true);
    expect(callsTo('drive', 'comments', 'create')).toHaveLength(0);
  });

  it('refuses a client that cannot be prompted', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    stub();
    const r = json(await (await unprompted()).callTool('gog_drive_comments_add', ARGS));
    expect(r).toMatchObject({ reason: 'confirmation-unsupported', action: 'drive.comment-add' });
    expect(r.note).toMatch(/Google Drive/);
  });

  it('token fallback: changed text is DRAFT_CHANGED; the same call posts', async () => {
    process.env.MCP_CONFIRM_MODE = 'ask-user';
    stub();
    const harness = await unprompted();
    const p1 = json(await harness.callTool('gog_drive_comments_add', ARGS));
    expect(p1.preview).toEqual({ file: { id: 'f1', name: 'Q3 plan' }, text: ARGS.content, mentions: ['bob@example.com'] });
    expect(json(await harness.callTool('gog_drive_comments_add', { ...ARGS, content: 'Nope', confirmToken: p1.confirmToken })))
      .toMatchObject({ error: 'DRAFT_CHANGED' });
    await harness.callTool('gog_drive_comments_add', { ...ARGS, confirmToken: p1.confirmToken });
    expect(callsTo('drive', 'comments', 'create')).toHaveLength(1);
  });
});

describe('gog_drive_comments_reply', () => {
  const ARGS = { fileId: 'f1', commentId: 'k1', content: 'Yes, final.', action: 'resolve' as const };

  it('reads the file and the comment and asks with both and the reply', async () => {
    stub();
    const { harness, details } = await prompted();
    await harness.callTool('gog_drive_comments_reply', ARGS);
    expect(details()).toEqual({
      file: { id: 'f1', name: 'Q3 plan' },
      replyingTo: { author: 'Alice <alice@example.com>', content: 'Is this final?', resolved: false },
      textPreview: 'Yes, final.', mentions: [], action: 'resolve',
    });
    expect(callsTo('drive', 'comments', 'reply')[0]![0]).toEqual(
      ['drive', 'comments', 'reply', pos('f1'), pos('k1'), pos('Yes, final.'), '--action=resolve']);
  });

  it.each(['drive get', 'drive comments get'])('returns a failed read (%s) without asking or replying', async (failing) => {
    stub(failing);
    const { harness, seen } = await prompted();
    expect((await harness.callTool('gog_drive_comments_reply', ARGS)).isError).toBe(true);
    expect(seen).toHaveLength(0);
    expect(callsTo('drive', 'comments', 'reply')).toHaveLength(0);
  });

  it('refuses a client that cannot be prompted', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    stub();
    const r = json(await (await unprompted()).callTool('gog_drive_comments_reply', ARGS));
    expect(r).toMatchObject({ reason: 'confirmation-unsupported', action: 'drive.comment-reply' });
  });

  it('token fallback: the thread action is part of what was approved', async () => {
    process.env.MCP_CONFIRM_MODE = 'ask-user';
    stub();
    const harness = await unprompted();
    const p1 = json(await harness.callTool('gog_drive_comments_reply', ARGS));
    expect(p1.preview.action).toBe('resolve');
    expect(json(await harness.callTool('gog_drive_comments_reply', { ...ARGS, action: 'reopen', confirmToken: p1.confirmToken })))
      .toMatchObject({ error: 'DRAFT_CHANGED' });
    expect(callsTo('drive', 'comments', 'reply')).toHaveLength(0);
  });

  it('token fallback: previews the thread; a reply with no action posts on phase 2', async () => {
    process.env.MCP_CONFIRM_MODE = 'ask-user';
    stub();
    const harness = await unprompted();
    const args = { fileId: 'f1', commentId: 'k1', content: 'Yes.' };
    const p1 = json(await harness.callTool('gog_drive_comments_reply', args));
    expect(p1.preview).toEqual({
      file: { id: 'f1', name: 'Q3 plan' },
      replyingTo: { author: 'Alice <alice@example.com>', content: 'Is this final?', resolved: false },
      text: 'Yes.', mentions: [],
    });
    await harness.callTool('gog_drive_comments_reply', { ...args, confirmToken: p1.confirmToken });
    expect(callsTo('drive', 'comments', 'reply')).toHaveLength(1);
  });
});
