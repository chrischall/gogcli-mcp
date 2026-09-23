import { describe, it, expect } from 'vitest';
import { forbiddenArgReason, assertSafeForwardedArgs, assertSafeSubcommand } from '../src/arg-guard.js';

describe('forbiddenArgReason', () => {
  // Each of these would let a model-supplied arg override a control the
  // operator (or this wrapper) set: gog takes the LAST value of a repeated flag,
  // so `--readonly=false` after the injected `--readonly` turns writes back on.
  it.each([
    '--readonly',
    '--readonly=false',
    '--readonly=0',
    '--enable-commands=gmail.send',
    '--enable-commands-exact=gmail send',
    '--disable-commands=',
    '--disable-commands',
    '--access-token=ya29.x',
    '--home=/tmp/other',
    '--account=attacker@example.com',
    '--account',
    '--acct=attacker@example.com',
    '--client=other',
    '--gmail-no-send=false',
    '--no-input=false',
    '--non-interactive=false',
    '--noninteractive=false',
    '-a',
    '-aattacker@example.com',
    '-ja',
    '--',
  ])('rejects %j', (arg) => {
    expect(forbiddenArgReason(arg)).toMatch(/not allowed/);
  });

  it.each([
    'msg1',
    '--title=New',
    '--max=5',
    '-y',
    '-5',
    'has:attachment',
    'a--readonly',
    '',
  ])('allows %j', (arg) => {
    expect(forbiddenArgReason(arg)).toBeUndefined();
  });

  it('names the separator specifically for a bare --', () => {
    expect(forbiddenArgReason('--')).toMatch(/"--"/);
  });
});

describe('assertSafeForwardedArgs', () => {
  it('passes a clean list', () => {
    expect(() => assertSafeForwardedArgs(['file1', '--parent=x'])).not.toThrow();
  });

  it('throws naming the first offending arg', () => {
    expect(() => assertSafeForwardedArgs(['x', '--readonly=false'])).toThrow(/--readonly=false/);
  });
});

describe('assertSafeSubcommand', () => {
  it.each(['archive', 'mark-read', 'labels', 'add-tab'])('allows %j', (s) => {
    expect(() => assertSafeSubcommand(s)).not.toThrow();
  });

  it.each(['--readonly=false', '-a', '', 'Send Now', '../x'])('rejects %j', (s) => {
    expect(() => assertSafeSubcommand(s)).toThrow(/subcommand/);
  });
});
