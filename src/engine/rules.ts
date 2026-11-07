import { debugLog } from "./debug";
import {
  findVisibleClickableTargets,
  getElementLabel,
  isClickable,
  isEnabled,
  isVisible,
  normalizeText,
} from "./dom";
import { STEP_POLL_MS } from "../rules/constants";
import { findConsentContainer, findPromotionalContainer } from "./popups";
import type {
  CookieRule,
  DetectionContext,
  ExecutionResult,
  RuleStep,
} from "../types";

function domainMatches(hostname: string, expectedDomain: string): boolean {
  return hostname === expectedDomain || hostname.endsWith(`.${expectedDomain}`);
}

export function sortRules(rules: CookieRule[]): CookieRule[] {
  return [...rules]
    .filter((rule) => rule.enabled !== false)
    .sort((left, right) => (right.priority ?? 100) - (left.priority ?? 100));
}

export function ruleMatches(
  rule: CookieRule,
  context: DetectionContext,
  started = false,
): boolean {
  const { hostname, pathname } = context.url;

  const domainMatched = rule.match.domains.some((domain) =>
    domainMatches(hostname, domain),
  );

  if (!domainMatched) {
    return false;
  }

  if (rule.match.pathPattern) {
    const pattern = new RegExp(
      rule.match.pathPattern.source,
      rule.match.pathPattern.flags,
    );
    if (!pattern.test(pathname)) {
      return false;
    }
  }

  if (!started && rule.match.selectors?.length) {
    return rule.match.selectors.every((selector) =>
      document.querySelector(selector),
    );
  }

  return true;
}

function textMatches(label: string, texts: string[]): boolean {
  return texts.some((text) => label === normalizeText(text));
}

function resolveStepTargets(step: RuleStep): HTMLElement[] {
  const containers = step.withinSelectors?.length
    ? step.withinSelectors.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector)),
      )
    : [document.documentElement];

  const allTargets = new Set<HTMLElement>();

  for (const container of containers) {
    if (step.target.selectors?.length) {
      for (const selector of step.target.selectors) {
        for (const matched of container.querySelectorAll(selector)) {
          if (
            isClickable(matched) &&
            isVisible(matched) &&
            isEnabled(matched)
          ) {
            allTargets.add(matched);
          }
        }
      }
    }

    if (step.target.texts?.length) {
      for (const candidate of findVisibleClickableTargets(container)) {
        const label = getElementLabel(candidate);
        if (textMatches(label, step.target.texts)) {
          allTargets.add(candidate);
        }
      }
    }
  }

  return Array.from(allTargets);
}

async function waitForStepTarget(
  step: RuleStep,
  signal?: AbortSignal,
): Promise<HTMLElement | undefined> {
  const deadline = Date.now() + (step.maxWaitMs ?? 0);
  while (!signal?.aborted) {
    const target = resolveStepTargets(step)[0];
    if (target) {
      return target;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return undefined;
    }
    await new Promise<void>((resolve) =>
      window.setTimeout(resolve, Math.min(STEP_POLL_MS, remaining)),
    );
  }
  return undefined;
}

export async function runMatchingRule(
  rules: CookieRule[],
  context: DetectionContext,
  progress: Map<CookieRule, number>,
  signal?: AbortSignal,
): Promise<ExecutionResult> {
  for (const rule of sortRules(rules)) {
    if (!ruleMatches(rule, context, progress.has(rule))) {
      continue;
    }

    debugLog("matched site rule", rule.id);

    let clicked = false;
    let popup: HTMLElement | undefined;
    for (
      let index = progress.get(rule) ?? 0;
      index < rule.steps.length;
      index += 1
    ) {
      const step = rule.steps[index];
      const element = await waitForStepTarget(step, signal);

      if (!element) {
        return {
          matched: true,
          clicked,
          reason: `rule ${rule.id} missing step ${step.id}`,
          ruleId: rule.id,
        };
      }

      if (signal?.aborted) {
        return {
          matched: true,
          clicked,
          reason: "rule execution stopped",
          ruleId: rule.id,
        };
      }
      if (index === rule.steps.length - 1)
        popup =
          findConsentContainer(element) ??
          findPromotionalContainer(element) ??
          undefined;
      element.click();
      clicked = true;
      progress.set(rule, index + 1);
    }

    return {
      matched: true,
      clicked,
      reason: "site rule executed",
      ruleId: rule.id,
      popup,
    };
  }

  return {
    matched: false,
    clicked: false,
    reason: "no matching site rule",
  };
}
