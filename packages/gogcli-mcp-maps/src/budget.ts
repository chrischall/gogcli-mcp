/**
 * Per-tool-call ceiling on BILLABLE Places requests, plus a cost estimate.
 *
 * Cache hits never touch this — only a request that is about to leave for
 * places.googleapis.com spends. When the budget is spent the next request is
 * refused BEFORE it is sent (BudgetExceededError), so the caller can return the
 * remaining items unresolved instead of running up a bill.
 */

/** Which field mask a request carries: BASIC bills at Pro, FULL at Enterprise. */
export type PlacesFieldSet = 'basic' | 'full';
export type PlacesRequestKind = 'textSearch' | 'details';

export const API_BUDGET_DEFAULT = 50;
export const API_BUDGET_MAX = 200;

/**
 * Published first-tier list prices, USD per 1,000 requests (checked
 * 2026-11-07, developers.google.com/maps/billing-and-pricing/pricing). Text
 * Search Pro/Enterprise and Place Details Pro/Enterprise.
 */
export const PRICE_PER_1000_USD = {
  textSearch: { basic: 32, full: 35 },
  details: { basic: 17, full: 20 },
} as const;

const SKU_NAME: Record<PlacesFieldSet, 'Pro' | 'Enterprise'> = { basic: 'Pro', full: 'Enterprise' };

export interface ApiCallsReport {
  textSearch: number;
  details: number;
  /** The highest SKU any request in this call billed at. */
  sku: 'none' | 'Pro' | 'Enterprise';
  estimatedUsd: number;
  budget: number;
  remaining: number;
  note: string;
}

export class BudgetExceededError extends Error {
  readonly reason = 'api_budget reached';
  constructor(limit: number) {
    super(`api_budget reached (${limit} billable Places requests); remaining items were not looked up`);
    this.name = 'BudgetExceededError';
  }
}

export class ApiBudget {
  private readonly counts = { textSearch: 0, details: 0 };
  private usd = 0;
  private enterprise = false;

  constructor(readonly limit: number = API_BUDGET_DEFAULT) {
    if (!Number.isInteger(limit) || limit < 0 || limit > API_BUDGET_MAX) {
      throw new RangeError(`api_budget must be an integer from 0 to ${API_BUDGET_MAX}`);
    }
  }

  get remaining(): number {
    return this.limit - this.counts.textSearch - this.counts.details;
  }

  get exhausted(): boolean {
    return this.remaining <= 0;
  }

  /** Record one billable request, or throw if the budget is already spent. */
  spend(kind: PlacesRequestKind, fields: PlacesFieldSet): void {
    if (this.exhausted) throw new BudgetExceededError(this.limit);
    this.counts[kind] += 1;
    this.usd += PRICE_PER_1000_USD[kind][fields] / 1000;
    if (fields === 'full') this.enterprise = true;
  }

  report(): ApiCallsReport {
    const billed = this.counts.textSearch + this.counts.details;
    return {
      textSearch: this.counts.textSearch,
      details: this.counts.details,
      sku: billed === 0 ? 'none' : SKU_NAME[this.enterprise ? 'full' : 'basic'],
      estimatedUsd: Math.round(this.usd * 10_000) / 10_000,
      budget: this.limit,
      remaining: this.remaining,
      note: 'Estimate at first-tier list prices, before free monthly allowances; cache hits are free.',
    };
  }
}
