import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rawTextResult, errorResult } from '@chrischall/mcp-utils';
import * as runner from '../src/runner.js';
import { finalizeGmailSearch, fetchGmailPages } from '../src/gmail-results.js';

vi.mock('../src/runner.js');

beforeEach(() => vi.clearAllMocks());

const THREADS = (nextPageToken: string) => JSON.stringify({
  threads: [
    { id: 'a', internalDateIso: '2026-08-01T09:00:00-04:00' },
    { id: 'b', internalDateIso: '2026-08-12T12:36:00-04:00' },
    { id: 'c', internalDateIso: '2026-08-05T09:00:00-04:00' },
  ],
  nextPageToken,
});

const THREAD_OPTS = { itemsKey: 'threads', method: 'users.threads.list', query: 'x' } as const;

const parse = (r: { content: { type: string; text?: string }[] }) =>
  JSON.parse(r.content[0].text as string);

describe('finalizeGmailSearch — ordering', () => {
  it('sorts newest-first by internalDateIso', async () => {
    const out = parse(await finalizeGmailSearch(rawTextResult(THREADS('')), THREAD_OPTS));
    expect(out.threads.map((t: { id: string }) => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('falls back to date when internalDateIso is absent', async () => {
    const raw = JSON.stringify({
      threads: [
        { id: 'a', date: '2026-08-01T09:00:00-04:00' },
        { id: 'b', date: '2026-08-09T09:00:00-04:00' },
      ],
      nextPageToken: '',
    });
    const out = parse(await finalizeGmailSearch(rawTextResult(raw), THREAD_OPTS));
    expect(out.threads.map((t: { id: string }) => t.id)).toEqual(['b', 'a']);
  });

  it('puts undated and unparseable items last, in their original order', async () => {
    const raw = JSON.stringify({
      threads: [
        { id: 'nodate' },
        { id: 'empty', internalDateIso: '' },
        { id: 'bad', internalDateIso: 'not-a-date' },
        { id: 'dated', internalDateIso: '2026-08-05T09:00:00-04:00' },
      ],
      nextPageToken: '',
    });
    const out = parse(await finalizeGmailSearch(rawTextResult(raw), THREAD_OPTS));
    expect(out.threads.map((t: { id: string }) => t.id)).toEqual(['dated', 'nodate', 'empty', 'bad']);
  });

  it('ignores a non-string date field', async () => {
    const raw = JSON.stringify({
      threads: [
        { id: 'weird', internalDateIso: 12345 },
        { id: 'dated', internalDateIso: '2026-08-05T09:00:00-04:00' },
      ],
      nextPageToken: '',
    });
    const out = parse(await finalizeGmailSearch(rawTextResult(raw), THREAD_OPTS));
    expect(out.threads.map((t: { id: string }) => t.id)).toEqual(['dated', 'weird']);
  });

  it('keeps equal timestamps in their original relative order', async () => {
    const raw = JSON.stringify({
      threads: [
        { id: 'first', internalDateIso: '2026-08-05T09:00:00-04:00' },
        { id: 'second', internalDateIso: '2026-08-05T09:00:00-04:00' },
      ],
      nextPageToken: '',
    });
    const out = parse(await finalizeGmailSearch(rawTextResult(raw), THREAD_OPTS));
    expect(out.threads.map((t: { id: string }) => t.id)).toEqual(['first', 'second']);
  });

  it('sorts the messages key too', async () => {
    const raw = JSON.stringify({
      messages: [
        { id: 'a', internalDateIso: '2026-08-01T09:00:00-04:00' },
        { id: 'b', internalDateIso: '2026-08-12T09:00:00-04:00' },
      ],
      nextPageToken: '',
    });
    const out = parse(await finalizeGmailSearch(rawTextResult(raw), {
      itemsKey: 'messages', method: 'users.messages.list', query: 'x',
    }));
    expect(out.messages.map((t: { id: string }) => t.id)).toEqual(['b', 'a']);
  });
});

describe('finalizeGmailSearch — truncation metadata', () => {
  const countReply = (ids: number, more: boolean) => JSON.stringify({
    threads: Array.from({ length: ids }, (_, i) => ({ id: `t${i}` })),
    ...(more ? { nextPageToken: 'more' } : {}),
  });

  it('omits every truncation field when the result set is complete', async () => {
    const out = parse(await finalizeGmailSearch(rawTextResult(THREADS('')), THREAD_OPTS));
    expect(out).not.toHaveProperty('truncated');
    expect(out).not.toHaveProperty('returned');
    expect(out).not.toHaveProperty('totalMatches');
    expect(out).not.toHaveProperty('warning');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('omits them when gog reports no nextPageToken field at all', async () => {
    const out = parse(await finalizeGmailSearch(rawTextResult('{"threads":[{"id":"a"}]}'), THREAD_OPTS));
    expect(out).not.toHaveProperty('truncated');
  });

  it('reports an EXACT total when the count probe reaches the end', async () => {
    vi.mocked(runner.run).mockResolvedValue(countReply(21, false));
    const out = parse(await finalizeGmailSearch(rawTextResult(THREADS('tok')), {
      itemsKey: 'threads', method: 'users.threads.list', query: 'invoice', account: 'me@x.com',
    }));
    expect(out.truncated).toBe(true);
    expect(out.returned).toBe(3);
    expect(out.totalMatches).toBe(21);
    expect(out).not.toHaveProperty('totalMatchesAtLeast');
    expect(out.warning).toBe(
      'INCOMPLETE RESULT SET: returned 3 of 21 matches. Do not report an absence of results ' +
      'based on this response. Page with nextPageToken or narrow the query.',
    );
  });

  it('reports a LOWER BOUND when the count probe fills its page', async () => {
    vi.mocked(runner.run).mockResolvedValue(countReply(500, true));
    const out = parse(await finalizeGmailSearch(rawTextResult(THREADS('tok')), THREAD_OPTS));
    expect(out.totalMatchesAtLeast).toBe(500);
    expect(out).not.toHaveProperty('totalMatches');
    expect(out.warning).toBe(
      'INCOMPLETE RESULT SET: returned 3 of at least 500 matches. Do not report an absence of ' +
      'results based on this response. Page with nextPageToken or narrow the query.',
    );
  });

  it('counts bare ids for one maximal page, scoped to the matching items key', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"messages":[{"id":"a"}]}');
    const raw = JSON.stringify({ messages: [{ id: 'a' }], nextPageToken: 'tok' });
    await finalizeGmailSearch(rawTextResult(raw), {
      itemsKey: 'messages', method: 'users.messages.list', query: 'invoice', account: 'me@x.com',
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['api', 'call', 'gmail', 'v1', 'users.messages.list',
        `--params=${JSON.stringify({ userId: 'me', q: 'invoice', maxResults: 500, fields: 'messages/id,nextPageToken' })}`],
      { account: 'me@x.com' },
    );
  });

  it('still warns, without a count, when the count probe fails', async () => {
    vi.mocked(runner.run).mockRejectedValue(new Error('nope'));
    const out = parse(await finalizeGmailSearch(rawTextResult(THREADS('tok')), THREAD_OPTS));
    expect(out.truncated).toBe(true);
    expect(out.returned).toBe(3);
    expect(out).not.toHaveProperty('totalMatches');
    expect(out).not.toHaveProperty('totalMatchesAtLeast');
    expect(out.warning).toBe(
      'INCOMPLETE RESULT SET: returned 3 matches and MORE EXIST beyond this page. Do not report ' +
      'an absence of results based on this response. Page with nextPageToken or narrow the query.',
    );
  });

  it('omits the count when the probe output is not JSON', async () => {
    vi.mocked(runner.run).mockResolvedValue('not json');
    const out = parse(await finalizeGmailSearch(rawTextResult(THREADS('tok')), THREAD_OPTS));
    expect(out).not.toHaveProperty('totalMatches');
  });

  it('omits the count when the probe returns no items array', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"nextPageToken":"x"}');
    const out = parse(await finalizeGmailSearch(rawTextResult(THREADS('tok')), THREAD_OPTS));
    expect(out).not.toHaveProperty('totalMatches');
    expect(out).not.toHaveProperty('totalMatchesAtLeast');
  });

  it('treats an empty nextPageToken on the probe as the end of the set', async () => {
    vi.mocked(runner.run).mockResolvedValue('{"threads":[{"id":"a"}],"nextPageToken":""}');
    const out = parse(await finalizeGmailSearch(rawTextResult(THREADS('tok')), THREAD_OPTS));
    expect(out.totalMatches).toBe(1);
  });

  it('skips the count probe when the query gog ran cannot be reproduced', async () => {
    const out = parse(await finalizeGmailSearch(rawTextResult(THREADS('tok')), {
      ...THREAD_OPTS, queryIsExact: false,
    }));
    expect(runner.run).not.toHaveBeenCalled();
    expect(out.truncated).toBe(true);
    expect(out).not.toHaveProperty('totalMatches');
  });
});

describe('finalizeGmailSearch — pass-through', () => {
  it('passes an error result through untouched', async () => {
    const err = errorResult('Error: boom');
    expect(await finalizeGmailSearch(err, THREAD_OPTS)).toBe(err);
  });

  it('passes non-JSON output through untouched', async () => {
    const text = rawTextResult('No results');
    expect(await finalizeGmailSearch(text, THREAD_OPTS)).toBe(text);
  });

  it('passes JSON without the expected items array through untouched', async () => {
    const text = rawTextResult('{"somethingElse":1}');
    expect(await finalizeGmailSearch(text, THREAD_OPTS)).toBe(text);
  });

  it('passes a result with no text content through untouched', async () => {
    const empty = { content: [] } as unknown as Parameters<typeof finalizeGmailSearch>[0];
    expect(await finalizeGmailSearch(empty, THREAD_OPTS)).toBe(empty);
  });

  it('handles an empty result set without adding truncation fields', async () => {
    const out = parse(await finalizeGmailSearch(rawTextResult('{"threads":[],"nextPageToken":""}'), THREAD_OPTS));
    expect(out.threads).toEqual([]);
    expect(out).not.toHaveProperty('truncated');
  });
});

describe('fetchGmailPages', () => {
  const page = (ids: string[], token?: string) => rawTextResult(JSON.stringify({
    threads: ids.map((id) => ({ id })),
    ...(token === undefined ? {} : { nextPageToken: token }),
  }));

  it('merges pages and drops the cursor when it reaches the end', async () => {
    const runPage = vi.fn()
      .mockResolvedValueOnce(page(['a'], 'T1'))
      .mockResolvedValueOnce(page(['b'], 'T2'))
      .mockResolvedValueOnce(page(['c']));
    const out = JSON.parse((await fetchGmailPages(runPage, 'threads', 5, undefined)).content[0].text as string);
    expect(out.threads.map((t: { id: string }) => t.id)).toEqual(['a', 'b', 'c']);
    expect(out).not.toHaveProperty('nextPageToken');
    expect(runPage.mock.calls.map((c) => c[0])).toEqual([undefined, 'T1', 'T2']);
  });

  it('treats an empty-string cursor as the end', async () => {
    const runPage = vi.fn().mockResolvedValueOnce(page(['a'], ''));
    const out = JSON.parse((await fetchGmailPages(runPage, 'threads', 5, undefined)).content[0].text as string);
    expect(out).not.toHaveProperty('nextPageToken');
    expect(runPage).toHaveBeenCalledTimes(1);
  });

  it('keeps the cursor when the page cap is reached first', async () => {
    const runPage = vi.fn()
      .mockResolvedValueOnce(page(['a'], 'T1'))
      .mockResolvedValueOnce(page(['b'], 'T2'));
    const out = JSON.parse((await fetchGmailPages(runPage, 'threads', 2, undefined)).content[0].text as string);
    expect(out.threads).toHaveLength(2);
    expect(out.nextPageToken).toBe('T2');
    expect(runPage).toHaveBeenCalledTimes(2);
  });

  // A REPEATED CURSOR IS A STALL, and gog 0.38.0 fixed the same class on its own
  // side (openclaw/gogcli#1004) — but that fix covers gog's `--all`, and this
  // walk is our own: it makes N separate single-page gog calls, so a cursor
  // Google repeats comes straight back to this loop. Without a guard the walk
  // re-fetches the same page and merges its items again on every remaining
  // iteration, so the caller gets DUPLICATES presented as more results, which is
  // worse than a short answer because nothing about the payload looks wrong.
  it('stops when Google repeats a cursor, instead of re-fetching the same page', async () => {
    const runPage = vi.fn()
      .mockResolvedValueOnce(page(['a'], 'T1'))
      .mockResolvedValueOnce(page(['b'], 'T1'));
    const out = JSON.parse((await fetchGmailPages(runPage, 'threads', 10, undefined)).content[0].text as string);
    expect(out.threads.map((t: { id: string }) => t.id)).toEqual(['a', 'b']);
    // Stopped after the repeat was seen — NOT after burning all 10 pages.
    expect(runPage).toHaveBeenCalledTimes(2);
  });

  it('still reads as truncated after a repeated cursor', async () => {
    const runPage = vi.fn()
      .mockResolvedValueOnce(page(['a'], 'T1'))
      .mockResolvedValueOnce(page(['b'], 'T1'));
    const out = JSON.parse((await fetchGmailPages(runPage, 'threads', 10, undefined)).content[0].text as string);
    // The walk could not reach the end, so the cursor STAYS. Dropping it would
    // claim completeness we never established, and a set that reads complete is
    // exactly how "that email doesn't exist" gets reported about mail that does.
    expect(out.nextPageToken).toBe('T1');
  });

  it('detects a cursor that repeats the caller-supplied one', async () => {
    const runPage = vi.fn().mockResolvedValueOnce(page(['a'], 'START'));
    const out = JSON.parse((await fetchGmailPages(runPage, 'threads', 10, 'START')).content[0].text as string);
    expect(out.threads.map((t: { id: string }) => t.id)).toEqual(['a']);
    expect(out.nextPageToken).toBe('START');
    expect(runPage).toHaveBeenCalledTimes(1);
  });

  it('detects a cursor that repeats a token from earlier in the walk, not just the previous one', async () => {
    const runPage = vi.fn()
      .mockResolvedValueOnce(page(['a'], 'T1'))
      .mockResolvedValueOnce(page(['b'], 'T2'))
      .mockResolvedValueOnce(page(['c'], 'T1'));
    const out = JSON.parse((await fetchGmailPages(runPage, 'threads', 10, undefined)).content[0].text as string);
    expect(out.threads.map((t: { id: string }) => t.id)).toEqual(['a', 'b', 'c']);
    expect(out.nextPageToken).toBe('T1');
    expect(runPage).toHaveBeenCalledTimes(3);
  });

  it('starts from a caller-supplied cursor', async () => {
    const runPage = vi.fn().mockResolvedValue(page(['a']));
    await fetchGmailPages(runPage, 'threads', 3, 'START');
    expect(runPage).toHaveBeenCalledWith('START');
  });

  it('surfaces a failure on the FIRST page as-is', async () => {
    const err = errorResult('Error: boom');
    const runPage = vi.fn().mockResolvedValue(err);
    expect(await fetchGmailPages(runPage, 'threads', 3, undefined)).toBe(err);
  });

  it('keeps pages already collected when a LATER page fails, still marked truncated', async () => {
    const runPage = vi.fn()
      .mockResolvedValueOnce(page(['a'], 'T1'))
      .mockResolvedValueOnce(errorResult('Error: boom'));
    const out = JSON.parse((await fetchGmailPages(runPage, 'threads', 3, undefined)).content[0].text as string);
    expect(out.threads.map((t: { id: string }) => t.id)).toEqual(['a']);
    expect(out.nextPageToken).toBe('T1');
  });

  it('bails on output it cannot parse or that has no items array', async () => {
    for (const bad of [rawTextResult('not json'), rawTextResult('"scalar"'), rawTextResult('{"other":1}')]) {
      const runPage = vi.fn().mockResolvedValue(bad);
      expect(await fetchGmailPages(runPage, 'threads', 3, undefined)).toBe(bad);
    }
  });
});
