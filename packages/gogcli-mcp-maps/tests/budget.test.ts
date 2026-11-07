import { describe, it, expect } from 'vitest';
import {
  ApiBudget,
  API_BUDGET_DEFAULT,
  API_BUDGET_MAX,
  BudgetExceededError,
  PRICE_PER_1000_USD,
} from '../src/budget.js';

describe('ApiBudget', () => {
  it('defaults to 50 and caps at 200', () => {
    expect(API_BUDGET_DEFAULT).toBe(50);
    expect(API_BUDGET_MAX).toBe(200);
    expect(new ApiBudget().remaining).toBe(50);
    expect(new ApiBudget(200).remaining).toBe(200);
    expect(() => new ApiBudget(201)).toThrow(RangeError);
    expect(() => new ApiBudget(-1)).toThrow(RangeError);
    expect(() => new ApiBudget(1.5)).toThrow(RangeError);
  });

  it('allows a zero budget (cache only) and refuses the first billable call', () => {
    const budget = new ApiBudget(0);
    expect(budget.exhausted).toBe(true);
    expect(() => budget.spend('textSearch', 'basic')).toThrow(BudgetExceededError);
    expect(budget.report().textSearch).toBe(0);
  });

  it('stops exactly at the limit and says why', () => {
    const budget = new ApiBudget(2);
    budget.spend('textSearch', 'full');
    budget.spend('details', 'full');
    expect(budget.exhausted).toBe(true);
    let caught: unknown;
    try {
      budget.spend('details', 'basic');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BudgetExceededError);
    expect((caught as BudgetExceededError).reason).toBe('api_budget reached');
    expect((caught as Error).message).toMatch(/api_budget reached \(2 billable Places requests\)/);
    expect(budget.report()).toMatchObject({ textSearch: 1, details: 1, budget: 2, remaining: 0 });
  });

  it('reports no SKU and zero cost when nothing was billed', () => {
    expect(new ApiBudget().report()).toEqual({
      textSearch: 0,
      details: 0,
      sku: 'none',
      estimatedUsd: 0,
      budget: 50,
      remaining: 50,
      note: expect.stringMatching(/estimate.*before free monthly allowances/i),
    });
  });

  it('prices basic calls at the Pro SKU', () => {
    const budget = new ApiBudget();
    budget.spend('textSearch', 'basic');
    budget.spend('details', 'basic');
    const report = budget.report();
    expect(report.sku).toBe('Pro');
    expect(report.estimatedUsd).toBeCloseTo((32 + 17) / 1000, 6);
  });

  it('reports Enterprise once any full call was made, and sums mixed costs', () => {
    const budget = new ApiBudget();
    budget.spend('textSearch', 'basic');
    budget.spend('textSearch', 'full');
    budget.spend('details', 'full');
    const report = budget.report();
    expect(report.sku).toBe('Enterprise');
    expect(report.estimatedUsd).toBeCloseTo((32 + 35 + 20) / 1000, 6);
  });

  it('publishes the first-tier list prices', () => {
    expect(PRICE_PER_1000_USD).toEqual({
      textSearch: { basic: 32, full: 35 },
      details: { basic: 17, full: 20 },
    });
  });
});
