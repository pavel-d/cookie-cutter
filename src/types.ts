export type ElementTarget = {
  selectors?: string[];
  texts?: string[];
};

export type RuleStep = {
  id: string;
  target: ElementTarget;
  withinSelectors?: string[];
  /** Maximum time to wait for this step's visible, enabled target. */
  maxWaitMs?: number;
};

export type RuleMatch = {
  domains: string[];
  pathPattern?: RegExp;
  selectors?: string[];
};

export type CookieRule = {
  id: string;
  name: string;
  match: RuleMatch;
  steps: RuleStep[];
  priority?: number;
  enabled?: boolean;
  notes?: string;
};

export type DetectionContext = {
  url: URL;
};

export type DismissalState = {
  clickedElements: WeakSet<HTMLElement>;
  ruleProgress: Map<CookieRule, number>;
};

export function createDismissalState(): DismissalState {
  return { clickedElements: new WeakSet(), ruleProgress: new Map() };
}

export type ClickCandidate = {
  element: HTMLElement;
  label: string;
  score: number;
  reason: string;
};

export type ExecutionResult =
  | { matched: false; clicked: false; reason: string }
  | {
      matched: true;
      clicked: boolean;
      reason: string;
      ruleId?: string;
      label?: string;
    };
