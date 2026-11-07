import { DEFAULT_THRESHOLD, REJECT_LABELS } from "../rules/constants";
import { debugLog } from "./debug";
import {
  findVisibleClickableTargets,
  getDetectionRoots,
  getElementLabel,
  normalizeText,
} from "./dom";
import {
  canCloseConsentNotice,
  CLOSE_LABELS,
  findConsentContainer,
  findPromotionalContainer,
  PREFERENCE_LABELS,
} from "./popups";
import type { ClickCandidate, ExecutionResult } from "../types";

export function scoreCandidate(
  element: HTMLElement,
  containerText: string,
): ClickCandidate | null {
  const label = getElementLabel(element);
  if (!REJECT_LABELS.includes(label)) {
    return null;
  }

  const score =
    DEFAULT_THRESHOLD +
    (containerText.includes("non-essential") ||
    containerText.includes("non essential")
      ? 1
      : 0) +
    (element.tagName === "BUTTON" ? 1 : 0);

  return { element, label, score, reason: "explicit reject label" };
}

export function findBestCandidate(
  clickedElements: WeakSet<HTMLElement> = new WeakSet(),
): ClickCandidate | null {
  let best: ClickCandidate | null = null;

  const labels = [...REJECT_LABELS, ...PREFERENCE_LABELS, ...CLOSE_LABELS];
  for (const element of getDetectionRoots().flatMap((root) =>
    findVisibleClickableTargets(root, labels),
  )) {
    if (clickedElements.has(element)) {
      continue;
    }
    const label = getElementLabel(element);
    const container = findConsentContainer(element);
    let candidate: ClickCandidate | null = null;
    if (container) {
      candidate = scoreCandidate(element, normalizeText(container.textContent));
      if (
        !candidate &&
        CLOSE_LABELS.includes(label) &&
        canCloseConsentNotice(container)
      ) {
        candidate = {
          element,
          label,
          score: DEFAULT_THRESHOLD - 1,
          reason: "dismiss cookie notice",
        };
      }
      if (!candidate && PREFERENCE_LABELS.includes(label)) {
        candidate = {
          element,
          label,
          score: DEFAULT_THRESHOLD - 2,
          reason: "open cookie preferences",
        };
      }
    }
    if (
      !candidate &&
      !container &&
      CLOSE_LABELS.includes(label) &&
      findPromotionalContainer(element)
    ) {
      candidate = {
        element,
        label,
        score: DEFAULT_THRESHOLD - 3,
        reason: "dismiss promotional popup",
      };
    }
    if (candidate && (!best || candidate.score > best.score)) {
      best = candidate;
    }
  }
  return best;
}

export function runGenericHeuristics(
  clickedElements: WeakSet<HTMLElement>,
): ExecutionResult {
  const candidate = findBestCandidate(clickedElements);
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
  };
}
