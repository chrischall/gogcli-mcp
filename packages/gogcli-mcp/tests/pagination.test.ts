import { describe, it, expect } from 'vitest';
import { rawTextResult, errorResult } from '@chrischall/mcp-utils';
import {
  stripConsumedPageToken,
  annotateTruncatedList,
  truncationWarning,
  hasMorePages,
} from '../src/pagination.js';

describe('stripConsumedPageToken', () => {
  it('removes an exhausted cursor so the key means "another page exists"', () => {
    expect(stripConsumedPageToken('{"threads":[{"id":"a"}],"nextPageToken":""}'))
      .toBe('{"threads":[{"id":"a"}]}');
  });

  it('keeps a live cursor untouched, byte for byte', () => {
    const live = '{"threads":[{"id":"a"}],"nextPageToken":"tok"}';
    expect(stripConsumedPageToken(live)).toBe(live);
  });

  it('preserves --pretty indentation when it has to re-serialize', () => {
    const pretty = '{\n  "threads": [],\n  "nextPageToken": ""\n}';
    expect(stripConsumedPageToken(pretty)).toBe('{\n  "threads": []\n}');
  });

  it('treats a tab indent as two spaces, matching the timestamp seam', () => {
    expect(stripConsumedPageToken('{\n\t"a": 1,\n\t"nextPageToken": ""\n}'))
      .toBe('{\n  "a": 1\n}');
  });

  it('leaves a payload with no cursor field alone', () => {
    const plain = '{"threads":[]}';
    expect(stripConsumedPageToken(plain)).toBe(plain);
  });

  it('only touches the top level — a nested cursor is another resource\'s', () => {
    const nested = '{"thread":{"nextPageToken":""}}';
    expect(stripConsumedPageToken(nested)).toBe(nested);
  });

  it('passes through non-JSON, empty, array and scalar output untouched', () => {
    for (const text of ['No results', '', '   ', '[{"nextPageToken":""}]', '"a string"', '{not json']) {
      expect(stripConsumedPageToken(text)).toBe(text);
    }
  });

  it('passes through a JSON null without dereferencing it', () => {
    expect(stripConsumedPageToken('null')).toBe('null');
  });
});

describe('truncationWarning', () => {
  it('names an exact total when one is known', () => {
    expect(truncationWarning(3, { total: 21 })).toContain('returned 3 of 21 matches');
  });

  it('says "at least" for a lower bound', () => {
    expect(truncationWarning(3, { atLeast: 500 })).toContain('returned 3 of at least 500 matches');
  });

  it('still forbids a negative conclusion when no count is available', () => {
    const w = truncationWarning(3, {});
    expect(w).toContain('returned 3 matches and MORE EXIST beyond this page');
    expect(w).toContain('Do not report an absence of results');
  });
});

describe('hasMorePages', () => {
  it('is true only for a live cursor', () => {
    expect(hasMorePages({ nextPageToken: 'tok' })).toBe(true);
    expect(hasMorePages({ nextPageToken: '' })).toBe(false);
    expect(hasMorePages({})).toBe(false);
    expect(hasMorePages({ nextPageToken: 7 })).toBe(false);
  });
});

describe('annotateTruncatedList', () => {
  it('adds the block when a live cursor remains', () => {
    const out = JSON.parse(annotateTruncatedList(
      rawTextResult('{"events":[{"id":"a"},{"id":"b"}],"nextPageToken":"tok"}'), 'events',
    ).content[0].text as string);
    expect(out.truncated).toBe(true);
    expect(out.returned).toBe(2);
    expect(out.warning).toContain('INCOMPLETE RESULT SET');
  });

  it('returns the result untouched when the set is complete', () => {
    const complete = rawTextResult('{"events":[{"id":"a"}]}');
    expect(annotateTruncatedList(complete, 'events')).toBe(complete);
  });

  it('passes errors, non-JSON, missing arrays and empty content through untouched', () => {
    const err = errorResult('boom');
    expect(annotateTruncatedList(err, 'events')).toBe(err);
    const text = rawTextResult('No results');
    expect(annotateTruncatedList(text, 'events')).toBe(text);
    const other = rawTextResult('{"somethingElse":1,"nextPageToken":"tok"}');
    expect(annotateTruncatedList(other, 'events')).toBe(other);
    const empty = { content: [] } as unknown as Parameters<typeof annotateTruncatedList>[0];
    expect(annotateTruncatedList(empty, 'events')).toBe(empty);
  });
});
