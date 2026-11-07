import type { CookieRule, RuleStep } from "../types";

type StepOptions = Pick<RuleStep, "withinSelectors" | "maxWaitMs">;

export function defineRule(rule: CookieRule): CookieRule {
  return {
    priority: 100,
    enabled: true,
    ...rule,
  };
}

export function byDomain(...domains: string[]): string[] {
  return domains;
}

export function clickSelector(
  id: string,
  selectors: string[],
  options: StepOptions = {},
): RuleStep {
  return {
    id,
    target: { selectors },
    ...options,
  };
}

export function clickText(
  id: string,
  texts: string[],
  options: StepOptions = {},
): RuleStep {
  return {
    id,
    target: { texts },
    ...options,
  };
}
