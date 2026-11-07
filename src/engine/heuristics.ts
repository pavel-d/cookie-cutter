import type { MatcherRules } from "../rules/ruleset";
import { debugLog } from "./debug";
import {
  findVisibleClickableTargets,
  getDetectionRoots,
  getElementLabel,
  normalizeText,
} from "./dom";
import {
  canCloseConsentNotice,
  findConsentContainer,
  findPromotionalContainer,
  findVisibleCloseTargets,
  getCloseLabel,
} from "./popups";
import type { ClickCandidate, ExecutionResult } from "../types";

export function scoreCandidate(
  rules: MatcherRules,
  element: HTMLElement,
  containerText: string,
): ClickCandidate | null {
  const label = getElementLabel(element);
  if (!rules.labels.reject.includes(label)) {
    return null;
  }

  const score =
    rules.threshold +
    (rules.labels.nonEssential.some((label) => containerText.includes(label))
      ? 1
      : 0) +
    (element.tagName === "BUTTON" ? 1 : 0);

  return { element, label, score, reason: "explicit reject label" };
}

export function findBestCandidate(
  rules: MatcherRules,
  clickedElements: WeakSet<HTMLElement> = new WeakSet(),
): ClickCandidate | null {
  let best: ClickCandidate | null = null;

  const labels = [...rules.labels.reject, ...rules.labels.preferences];
  const targets = new Set(
    getDetectionRoots().flatMap((root) => [
      ...findVisibleClickableTargets(root, labels),
      ...findVisibleCloseTargets(rules, root),
    ]),
  );
  for (const element of targets) {
    if (clickedElements.has(element)) {
      continue;
    }
    const closeLabel = getCloseLabel(rules, element);
    const label = closeLabel ?? getElementLabel(element);
    const container = findConsentContainer(rules, element);
    const promotion =
      !container && closeLabel !== null
        ? findPromotionalContainer(rules, element)
        : null;
    let candidate: ClickCandidate | null = null;
    if (container) {
      candidate = scoreCandidate(
        rules,
        element,
        normalizeText(container.textContent),
      );
      if (
        !candidate &&
        closeLabel !== null &&
        canCloseConsentNotice(rules, container)
      ) {
        candidate = {
          element,
          label,
          score: rules.threshold - 1,
          reason: "dismiss cookie notice",
        };
      }
      if (!candidate && rules.labels.preferences.includes(label)) {
        candidate = {
          element,
          label,
          score: rules.threshold - 2,
          reason: "open cookie preferences",
        };
      }
    }
    if (!candidate && !container && closeLabel !== null && promotion) {
      candidate = {
        element,
        label,
        score: rules.threshold - 3,
        reason: "dismiss promotional popup",
      };
    }
    if (candidate && candidate.reason !== "open cookie preferences") {
      candidate.popup = container ?? promotion ?? undefined;
    }
    if (candidate && (!best || candidate.score > best.score)) {
      best = candidate;
    }
  }
  return best;
}

export function runGenericHeuristics(
  rules: MatcherRules,
  clickedElements: WeakSet<HTMLElement>,
): ExecutionResult {
  const candidate = findBestCandidate(rules, clickedElements);
  if (!candidate) {
    return {
      matched: false,
      clicked: false,
      reason: "no high-confidence generic candidate",
    };
  }

  clickedElements.add(candidate.element);
  candidate.element.click();
  debugLog("clicked generic candidate", candidate.label, candidate.reason);
  return {
    matched: true,
    clicked: true,
    reason: "generic candidate clicked",
    label: candidate.label,
    popup: candidate.popup,
  };
}
