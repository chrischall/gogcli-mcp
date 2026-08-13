import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { rawTextResult } from '@chrischall/mcp-utils';
import { run } from './runner.js';

// Post-processing for Gmail search output, on the seam between gog's JSON and
// the model client. Two guarantees live here, both of which exist because a
// client read a search response and confidently reported that a message did not
// exist when it did:
//
//   1. A capped result set SAYS SO, in prose. gog reports a nextPageToken and
//      nothing else; a token is easy to skim past, and skipping it turns a
//      partial answer into a false negative.
//   2. Results are newest-first by internalDate. Gmail's own thread ordering
//      keys on the thread, so a message that arrived today can rank below
//      older ones and fall off the end of a capped page.

type GmailListItem = Record<string, unknown> & {
  date?: string;
  internalDateIso?: string;
};

// Sort key for newest-first. internalDateIso is Gmail's own internalDate and is
// what a parser should read; `date` parses the sender-written Date header and
// can be skewed, malformed, or in another zone, so it is only a fallback.
// Anything unparseable sorts LAST rather than being silently treated as the
// epoch — which would rank it as the oldest result, the exact failure this
// guarantee exists to remove.
function sortKey(item: GmailListItem): number {
  for (const raw of [item.internalDateIso, item.date]) {
    if (typeof raw !== 'string' || !raw) continue;
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return t;
  }
  return Number.NEGATIVE_INFINITY;
}

// Array.prototype.sort is stable per spec, so equal keys — and the whole
// undated tail, which shares NEGATIVE_INFINITY — keep their original order.
function sortNewestFirst(items: GmailListItem[]): GmailListItem[] {
  return [...items].sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    // Compare before subtracting: (-Infinity) - (-Infinity) is NaN, which would
    // make the comparator incoherent for every undated pair.
    return ka === kb ? 0 : kb - ka;
  });
}

// How many matches the query really has, when we were able to find out.
interface MatchCount {
  /** Exact total — the probe reached the end of the result set. */
  total?: number;
  /** Lower bound — the probe filled its page and more remain. */
  atLeast?: number;
}

// The prose matters more than the boolean. A bare `truncated: true` is exactly
// the kind of structured field a model client skims past — which is how a
// non-empty nextPageToken produced a confident "no such email exists". This
// says, in words, the one conclusion the caller must not draw.
function truncationWarning(returned: number, count: MatchCount): string {
  const scope = count.total !== undefined
    ? `returned ${returned} of ${count.total} matches`
    : count.atLeast !== undefined
      ? `returned ${returned} of at least ${count.atLeast} matches`
      : `returned ${returned} matches and MORE EXIST beyond this page`;
  return `INCOMPLETE RESULT SET: ${scope}. Do not report an absence of results based on ` +
    'this response. Page with nextPageToken or narrow the query.';
}

export type GmailListMethod = 'users.threads.list' | 'users.messages.list';

// The largest page Gmail's list endpoints will serve. One page at this size is
// enough to count the whole match set for all but the broadest queries.
const COUNT_PROBE_PAGE_SIZE = 500;

// Count how many matches the query REALLY has.
//
// Deliberately NOT Gmail's own resultSizeEstimate, which is the obvious source
// and is worthless: measured against a live mailbox on 2026-08-12 it returned
// exactly 201 for every non-empty query tried — `from:freshbooks.com` (21 real
// matches), `from:housecallpro.com` (6), `from:thumbtack.com newer_than:30d`
// (3) — and 0 for a query with no matches. It saturates, so it is a
// has-results boolean wearing a number's clothes. Reporting "3 of ~201" when
// the truth is 3 of 6 would invent a figure, which is a worse failure than the
// missing count this whole block exists to supply.
//
// So: ask for one maximal page of bare ids and count them. `fields` keeps the
// response to ids alone, and the count is EXACT whenever the result set fits in
// a page — which is the common case, and always the case for the narrow queries
// a caller is most likely to draw a false negative from. A full page with more
// behind it yields an honest lower bound instead.
//
// gog cannot supply this itself: `gmail search` and `gmail messages search`
// build their JSON by hand from the items plus nextPageToken, so a direct
// Discovery call is the only route. It is only ever spent on a result set
// already known to be truncated.
//
// Best-effort by construction: any failure must degrade the warning, never the
// search.
async function countMatches(
  method: GmailListMethod,
  itemsKey: 'threads' | 'messages',
  query: string,
  account: string | undefined,
): Promise<MatchCount> {
  try {
    const params = JSON.stringify({
      userId: 'me',
      q: query,
      maxResults: COUNT_PROBE_PAGE_SIZE,
      fields: `${itemsKey}/id,nextPageToken`,
    });
    const raw = await run(['api', 'call', 'gmail', 'v1', method, `--params=${params}`], { account });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const items = parsed[itemsKey];
    if (!Array.isArray(items)) return {};
    const more = typeof parsed.nextPageToken === 'string' && parsed.nextPageToken !== '';
    return more ? { atLeast: items.length } : { total: items.length };
  } catch {
    return {};
  }
}

export interface FinalizeOptions {
  /** Which array in gog's payload holds the results. */
  itemsKey: 'threads' | 'messages';
  /** The Discovery method whose resultSizeEstimate matches that array. */
  method: GmailListMethod;
  /** The query as the caller wrote it. */
  query: string;
  account?: string;
  /**
   * False when gog rewrote the query server-side (--from-contact resolves a
   * contact through the People API to addresses we cannot reproduce). An
   * estimate for a DIFFERENT query is worse than none, so the field is skipped
   * rather than guessed.
   */
  queryIsExact?: boolean;
}

// The single seam every Gmail search result passes through: guarantee the
// ordering, and make a capped result set say so out loud. Any output that is
// not the JSON shape this understands — an error, a plain "No results" — is
// returned untouched.
export async function finalizeGmailSearch(
  result: CallToolResult,
  options: FinalizeOptions,
): Promise<CallToolResult> {
  const { itemsKey, method, query, account, queryIsExact = true } = options;
  const first = result.content[0];
  if (result.isError || first?.type !== 'text') return result;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(first.text) as Record<string, unknown>;
  } catch {
    return result;
  }
  const items = parsed[itemsKey];
  if (!Array.isArray(items)) return result;

  const sorted = sortNewestFirst(items as GmailListItem[]);
  const out: Record<string, unknown> = { ...parsed, [itemsKey]: sorted };

  // The presence of the block is itself the signal, so it is added ONLY for a
  // genuinely capped set. gog leaves nextPageToken empty when --all exhausted
  // the pages, which is why --all needs no special case here.
  if (typeof parsed.nextPageToken === 'string' && parsed.nextPageToken !== '') {
    const count = queryIsExact ? await countMatches(method, itemsKey, query, account) : {};
    out.truncated = true;
    out.returned = sorted.length;
    if (count.total !== undefined) out.totalMatches = count.total;
    if (count.atLeast !== undefined) out.totalMatchesAtLeast = count.atLeast;
    out.warning = truncationWarning(sorted.length, count);
  }

  return rawTextResult(JSON.stringify(out));
}
