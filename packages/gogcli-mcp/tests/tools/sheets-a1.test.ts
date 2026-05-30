import { describe, it, expect } from 'vitest';
import { expandAnchorRange, countNonEmptyCells } from '../../src/tools/sheets-a1.js';

describe('expandAnchorRange', () => {
  it('expands a bare anchor cell to the full written area', () => {
    expect(expandAnchorRange('A1', 3, 2)).toBe('A1:B3');
  });

  it('preserves a sheet-name prefix when expanding', () => {
    expect(expandAnchorRange('Sheet1!A1', 70, 4)).toBe('Sheet1!A1:D70');
  });

  it('generates multi-letter end columns past Z', () => {
    expect(expandAnchorRange('A1', 1, 27)).toBe('A1:AA1');
  });

  it('parses multi-letter start columns', () => {
    expect(expandAnchorRange('AA5', 1, 1)).toBe('AA5:AA5');
  });

  it('uppercases a lowercase anchor column', () => {
    expect(expandAnchorRange('b2', 1, 1)).toBe('B2:B2');
  });

  it('leaves an explicit A1 range (with a colon) unchanged', () => {
    expect(expandAnchorRange('Sheet1!A1:D70', 5, 5)).toBe('Sheet1!A1:D70');
  });

  it('leaves a named range unchanged', () => {
    expect(expandAnchorRange('MyNamedRange', 5, 5)).toBe('MyNamedRange');
  });
});

describe('countNonEmptyCells', () => {
  it('counts cells that hold data across ragged rows', () => {
    expect(countNonEmptyCells('{"values":[["a","b"],["c"]]}')).toBe(3);
  });

  it('treats empty strings as empty', () => {
    expect(countNonEmptyCells('{"values":[["","",""]]}')).toBe(0);
  });

  it('treats whitespace-only cells as empty', () => {
    expect(countNonEmptyCells('{"values":[["   "]]}')).toBe(0);
  });

  it('counts numbers and zero as data, skips nulls', () => {
    expect(countNonEmptyCells('{"values":[[1,0,null,"x"]]}')).toBe(3);
  });

  it('returns 0 when there is no values key', () => {
    expect(countNonEmptyCells('{}')).toBe(0);
  });

  it('returns 0 when values is not an array', () => {
    expect(countNonEmptyCells('{"values":"foo"}')).toBe(0);
  });

  it('returns 0 when the parsed JSON is null', () => {
    expect(countNonEmptyCells('null')).toBe(0);
  });

  it('skips non-array rows', () => {
    expect(countNonEmptyCells('{"values":[null,["a"]]}')).toBe(1);
  });

  it('returns -1 when the output is not valid JSON', () => {
    expect(countNonEmptyCells('not json')).toBe(-1);
  });
});
