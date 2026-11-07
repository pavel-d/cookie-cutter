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
  findConsentContainer,
  findPromotionalContainer,
  findVisibleCloseTargets,
  getCloseLabel,
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

  const labels = [...REJECT_LABELS, ...PREFERENCE_LABELS];
  const targets = new Set(
    getDetectionRoots().flatMap((root) => [
      ...findVisibleClickableTargets(root, labels),
      ...findVisibleCloseTargets(root),
    ]),
  );
  for (const element of targets) {
    if (clickedElements.has(element)) {
      continue;
    }
    const closeLabel = getCloseLabel(element);
    const label = closeLabel ?? getElementLabel(element);
    const container = findConsentContainer(element);
    const promotion =
      !container && closeLabel !== null
        ? findPromotionalContainer(element)
        : null;
    let candidate: ClickCandidate | null = null;
    if (container) {
      candidate = scoreCandidate(element, normalizeText(container.textContent));
      if (
        !candidate &&
        closeLabel !== null &&
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
    if (!candidate && !container && closeLabel !== null && promotion) {
      candidate = {
        element,
        label,
        score: DEFAULT_THRESHOLD - 3,
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
    popup: candidate.popup,
  };
}
