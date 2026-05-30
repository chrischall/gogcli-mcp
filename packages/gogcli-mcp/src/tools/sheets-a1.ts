// A1-notation helpers for the fail_if_not_empty write guard. Kept separate
// from sheets.ts so the pure range/value math is unit-testable in isolation.

// 1 -> "A", 26 -> "Z", 27 -> "AA" (bijective base-26).
function colToLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// "A" -> 1, "AA" -> 27.
function letterToCol(s: string): number {
  let n = 0;
  for (const ch of s.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

// Given the target `range` of an update and the shape of the values being
// written, return the range the guard should read to cover every written cell.
//
// A bare anchor cell ("Sheet1!A1") is expanded to the full written area
// ("Sheet1!A1:D70"). An explicit range (contains ":") or a named range is
// returned unchanged — the caller asked us to check exactly that span.
export function expandAnchorRange(range: string, rows: number, cols: number): string {
  const bang = range.lastIndexOf('!');
  const sheet = bang >= 0 ? range.slice(0, bang + 1) : '';
  const cell = bang >= 0 ? range.slice(bang + 1) : range;
  const m = /^([A-Za-z]+)([0-9]+)$/.exec(cell);
  if (!m) return range;
  const startCol = letterToCol(m[1]);
  const startRow = parseInt(m[2], 10);
  const endCol = colToLetter(startCol + cols - 1);
  const endRow = startRow + rows - 1;
  return `${sheet}${m[1].toUpperCase()}${startRow}:${endCol}${endRow}`;
}

// Count cells holding data in the JSON output of `gog sheets get`
// ({"values":[[...]]}). Empty strings and whitespace-only cells don't count;
// numbers (including 0) and other primitives do. Returns -1 when the output
// can't be parsed, so the caller can fail safe rather than assume "empty".
export function countNonEmptyCells(getOutput: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(getOutput);
  } catch {
    return -1;
  }
  const values = (parsed as { values?: unknown })?.values;
  if (!Array.isArray(values)) return 0;
  let count = 0;
  for (const row of values) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      if (cell !== null && String(cell).trim() !== '') count++;
    }
  }
  return count;
}
