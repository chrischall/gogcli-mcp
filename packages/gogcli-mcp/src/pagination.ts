import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { rawTextResult } from '@chrischall/mcp-utils';

// gog reports an exhausted cursor as `"nextPageToken": ""` rather than omitting
// the field. That empty string is worse than nothing: the natural reading of a
// paginated response is "the cursor key is there, so there is another page",
// and a caller acting on the key's PRESENCE pages forever or, worse, concludes
// the opposite of the truth. Strip it so the field means exactly one thing —
// present iff another page exists.
//
// Deliberately top-level only. A nested `nextPageToken` belongs to some
// embedded resource whose paging semantics are not ours to reinterpret.

// Byte-identical passthrough is the contract when nothing was removed — see
// normalizeTimestamps, which this sits beside on the same seam and whose
// indent-preserving discipline it copies.
function detectIndent(text: string): number {
  const match = /\n(\s+)\S/.exec(text);
  return match ? match[1].replace(/\t/g, '  ').length : 0;
}

export function stripConsumedPageToken(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '' || !trimmed.startsWith('{')) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return text;
  }
  // The `{` guard above means anything that parses here is a plain object —
  // never null, an array, or a scalar — so no further shape check is needed.
  const obj = parsed as Record<string, unknown>;
  if (obj.nextPageToken !== '') return text;
  delete obj.nextPageToken;
  return JSON.stringify(obj, null, detectIndent(text));
}

// ---------------------------------------------------------------------------
// Truncation metadata
// ---------------------------------------------------------------------------

// How many items the query really has, when we were able to find out.
export interface MatchCount {
  /** Exact total — the probe reached the end of the result set. */
  total?: number;
  /** Lower bound — the probe filled its page and more remain. */
  atLeast?: number;
}

// The prose matters more than the boolean. A bare `truncated: true` is exactly
// the kind of structured field a model client skims past — which is how a
// non-empty nextPageToken produced a confident "no such email exists". This
// says, in words, the one conclusion the caller must not draw.
export function truncationWarning(returned: number, count: MatchCount): string {
  const scope = count.total !== undefined
    ? `returned ${returned} of ${count.total} matches`
    : count.atLeast !== undefined
      ? `returned ${returned} of at least ${count.atLeast} matches`
      : `returned ${returned} matches and MORE EXIST beyond this page`;
  return `INCOMPLETE RESULT SET: ${scope}. Do not report an absence of results based on ` +
    'this response. Page with nextPageToken or narrow the query.';
}

// Add the truncation block to a parsed payload, in place.
//
// Only ever called for a genuinely capped set, so the block's PRESENCE is
// itself the signal and a complete response stays clean. By the time this runs
// an exhausted cursor has already been stripped by stripConsumedPageToken, so
// "has a nextPageToken" and "has another page" are the same question.
export function annotateTruncation(
  out: Record<string, unknown>,
  returned: number,
  count: MatchCount,
): void {
  out.truncated = true;
  out.returned = returned;
  if (count.total !== undefined) out.totalMatches = count.total;
  if (count.atLeast !== undefined) out.totalMatchesAtLeast = count.atLeast;
  out.warning = truncationWarning(returned, count);
}

// True when the payload still carries a live cursor.
export function hasMorePages(parsed: Record<string, unknown>): boolean {
  return typeof parsed.nextPageToken === 'string' && parsed.nextPageToken !== '';
}

// Attach the truncation block to a tool result whose payload we cannot cheaply
// count — the fact of truncation without a fabricated total. Anything that is
// not the JSON shape this understands passes through untouched.
export function annotateTruncatedList(
  result: CallToolResult,
  itemsKey: string,
): CallToolResult {
  const first = result.content[0];
  if (result.isError || first?.type !== 'text') return result;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(first.text) as Record<string, unknown>;
  } catch {
    return result;
  }
  const items = parsed[itemsKey];
  if (!Array.isArray(items) || !hasMorePages(parsed)) return result;
  const out: Record<string, unknown> = { ...parsed };
  annotateTruncation(out, items.length, {});
  return rawTextResult(JSON.stringify(out));
}
