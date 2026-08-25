import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { rawTextResult } from '@chrischall/mcp-utils';
import { run } from './runner.js';
import { annotateTruncation, hasMorePages } from './pagination.js';
import type { MatchCount } from './pagination.js';

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
// gog CAN now supply this itself — `--count` on `gmail search` / `gmail
// messages search` (gog >= 0.36.0, openclaw/gogcli#985) is this same probe,
// upstreamed, down to the page size and the exact/lower-bound split. The probe
// stays here anyway, for two differences that both matter at this seam:
//
//   * It is spent ONLY on a result set already known to be truncated. --count
//     is decided before the search runs, so adopting it would cost every
//     search an extra Gmail request to answer a question most of them never
//     raise.
//   * It is best-effort. gog returns the count probe's error from the whole
//     command, so a failed count would turn a search that DID succeed into an
//     error — trading a missing warning for a missing answer.
//
// Keep the two in step: a change to what "exact" means on either side should
// be made on both.
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
  if (hasMorePages(parsed)) {
    const count = queryIsExact ? await countMatches(method, itemsKey, query, account) : {};
    annotateTruncation(out, sorted.length, count);
  }

  return rawTextResult(JSON.stringify(out));
}

// Walk up to `maxPages` pages and merge them into one payload.
//
// The point is the existence question — "is there any mail matching X?" — which
// a single page cannot answer and which is exactly where a truncated response
// gets misread as a negative. gog has `--all`, but that is unbounded: on a
// broad query it walks the entire mailbox. This is the bounded form, so a
// caller can say "look at up to 5 pages" and get either a real answer or an
// honestly-still-truncated one.
//
// The merged payload keeps a nextPageToken only if pages remain when the cap is
// hit, so finalizeGmailSearch still marks it truncated — running out of budget
// is not the same as reaching the end, and must not read like it.
//
// A REPEATED CURSOR ENDS THE WALK TOO. Google can hand back a nextPageToken it
// has already issued, and gog 0.38.0 fixed exactly that for its own `--all`
// (openclaw/gogcli#1004) — but this walk is not gog's: it makes N separate
// single-page calls, so a repeated cursor arrives here untouched. Following it
// re-fetches a page already merged, so the caller gets the same threads twice
// over, presented as more results and looking perfectly well-formed. The token
// is KEPT when that happens, for the same reason the cap keeps it: the walk
// never established an end, and a set that reads complete is precisely how mail
// that exists gets reported as missing.
export async function fetchGmailPages(
  runPage: (token: string | undefined) => Promise<CallToolResult>,
  itemsKey: 'threads' | 'messages',
  maxPages: number,
  startToken: string | undefined,
): Promise<CallToolResult> {
  const merged: unknown[] = [];
  let base: Record<string, unknown> | undefined;
  let token = startToken;
  // Every cursor this walk has already fetched with, so one Google repeats is
  // recognised rather than followed. Seeded with the caller's own cursor: a
  // response echoing that back would re-fetch the page just merged.
  const fetched = new Set<string>(startToken === undefined ? [] : [startToken]);

  for (let pages = 0; pages < maxPages; pages++) {
    const result = await runPage(token);
    const parsed = parsePage(result, itemsKey);
    // An error, or output this does not understand, part-way through the walk.
    // Nothing collected yet means the caller should just see that result; once
    // pages ARE collected, return them WITH the cursor that was about to be
    // consumed, so the set still reads as truncated rather than complete.
    if (parsed === undefined) {
      return base === undefined ? result : finish(base, itemsKey, merged, token);
    }
    base = parsed;
    merged.push(...(parsed[itemsKey] as unknown[]));
    const next = typeof parsed.nextPageToken === 'string' && parsed.nextPageToken !== ''
      ? parsed.nextPageToken
      : undefined;
    if (next === undefined) {
      token = undefined;
      break;
    }
    // Checked BEFORE the next fetch, so the duplicate page is never requested
    // and never merged. `token` keeps the repeated cursor so the result still
    // reads as truncated — it is the honest answer, and handing it back lets a
    // caller retry later rather than concluding there is nothing more.
    if (fetched.has(next)) {
      token = next;
      break;
    }
    fetched.add(next);
    token = next;
  }

  return finish(base as Record<string, unknown>, itemsKey, merged, token);
}

// A page's payload, or undefined if it is not a usable list response.
function parsePage(
  result: CallToolResult,
  itemsKey: string,
): Record<string, unknown> | undefined {
  const first = result.content[0];
  if (result.isError || first?.type !== 'text') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(first.text);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object') return undefined;
  const obj = parsed as Record<string, unknown>;
  return Array.isArray(obj[itemsKey]) ? obj : undefined;
}

function finish(
  base: Record<string, unknown>,
  itemsKey: string,
  merged: unknown[],
  token: string | undefined,
): CallToolResult {
  const out: Record<string, unknown> = { ...base, [itemsKey]: merged };
  if (token === undefined) delete out.nextPageToken;
  else out.nextPageToken = token;
  return rawTextResult(JSON.stringify(out));
}
