import { CONSENT_KEYWORDS } from "../rules/constants";
import { getComposedParent, getElementLabel, normalizeText } from "./dom";

export const PREFERENCE_LABELS = [
  "preferences",
  "manage preferences",
  "manage settings",
  "cookie settings",
  "cookie preferences",
  "manage cookies",
  "customize",
  "customise",
  "customize cookies",
  "customise cookies",
  "privacy settings",
];

const OFFER_CLOSE_LABELS = ["close teaser", "close offer", "close promotion"];

export const CLOSE_LABELS = [
  "close",
  "close dialog",
  ...OFFER_CLOSE_LABELS,
  "dismiss",
  "no thanks",
  "not now",
  "hide this message",
];

function isOverlay(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return (
    element.matches("dialog, [role='dialog'], [aria-modal='true']") ||
    style.position === "fixed" ||
    style.position === "sticky"
  );
}

function hasConsentText(element: HTMLElement): boolean {
  const text = normalizeText(element.textContent);
  return CONSENT_KEYWORDS.some((keyword) => text.includes(keyword));
}

export function findConsentContainer(element: HTMLElement): HTMLElement | null {
  for (
    let parent = getComposedParent(element);
    parent && parent !== document.body;
    parent = getComposedParent(parent)
  ) {
    if (!hasConsentText(parent)) {
      continue;
    }
    const identity = `${parent.id} ${parent.className} ${parent.getAttribute("aria-label") ?? ""}`;
    const isCookieRegion =
      /cookie|consent/i.test(identity) &&
      (parent.matches("[role='region'], [role='alert']") ||
        /banner|notice|consent/i.test(identity));
    if (isOverlay(parent) || isCookieRegion) {
      return parent;
    }
  }
  return null;
}

export function canCloseConsentNotice(container: HTMLElement): boolean {
  const text = normalizeText(container.textContent);
  return (
    /you(?: have|'ve) (?:rejected|accepted)\b.*cookies/.test(text) ||
    /(?:we (?:only use|use only) (?:strictly )?(?:necessary|essential) cookies)/.test(
      text,
    ) ||
    (/strictly necessary cookies/.test(text) &&
      /will not use any other cookies/.test(text))
  );
}

export function findPromotionalContainer(
  element: HTMLElement,
): HTMLElement | null {
  const offerClose = OFFER_CLOSE_LABELS.includes(getElementLabel(element));
  for (
    let parent = getComposedParent(element);
    parent && parent !== document.body;
    parent = getComposedParent(parent)
  ) {
    if (!isOverlay(parent)) {
      continue;
    }
    const text = normalizeText(parent.textContent);
    const signup =
      /\b(?:subscribe|newsletter|mailing list|sign up|signing up)\b/.test(text);
    const incentive =
      /\b(?:rewards?|welcome gift|discount|first order|exclusive offers?)\b/.test(
        text,
      ) || /(?:[£$€]\s*\d+(?:[.,]\d+)*|\d+(?:[.,]\d+)*\s*%)\s*off/.test(text);
    const email = Boolean(
      parent.querySelector("input[type='email'], input[autocomplete='email']"),
    );
    if (
      (signup && (incentive || email)) ||
      (offerClose && incentive) ||
      /\b(?:redeem|claim) (?:your )?rewards?\b/.test(text)
    ) {
      return parent;
    }
  }
  return null;
}
