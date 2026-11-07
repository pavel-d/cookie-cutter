import { CONSENT_KEYWORDS } from "../rules/constants";
import {
  getComposedParent,
  getElementLabel,
  isClickable,
  isEnabled,
  isVisible,
  normalizeText,
} from "./dom";

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

function getIdentity(element: Element): string {
  return normalizeText(
    `${element.id} ${element.getAttribute("class") ?? ""} ${element.getAttribute("aria-label") ?? ""}`
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " "),
  );
}

export function getCloseLabel(element: HTMLElement): string | null {
  const label = getElementLabel(element);
  if (CLOSE_LABELS.includes(label)) {
    return label;
  }
  // An explicit accessible label takes precedence over implementation hints.
  if (label && !["x", "×", "✕", "✖"].includes(label)) {
    return null;
  }
  const title = normalizeText(element.getAttribute("title"));
  const alt = normalizeText(element.getAttribute("alt"));
  if (CLOSE_LABELS.includes(title)) {
    return title;
  }
  if (CLOSE_LABELS.includes(alt)) {
    return alt;
  }
  if (
    !title &&
    !alt &&
    /\b(?:close|dismiss)\b/.test(getIdentity(element)) &&
    window.getComputedStyle(element).cursor === "pointer"
  ) {
    return "close";
  }
  return null;
}

export function findVisibleCloseTargets(root: ParentNode): HTMLElement[] {
  return Array.from(
    root.querySelectorAll(
      "button, a, input[type='button'], input[type='submit'], [role='button'], [class], [id], [title], img[alt]",
    ),
  ).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      getCloseLabel(element) !== null &&
      ((element instanceof HTMLImageElement &&
        CLOSE_LABELS.includes(normalizeText(element.alt))) ||
        isClickable(element) ||
        window.getComputedStyle(element).cursor === "pointer") &&
      isVisible(element) &&
      isEnabled(element),
  );
}

function isPromotionalMediaOverlay(
  container: HTMLElement,
  closeControl: HTMLElement,
): boolean {
  const identity = getIdentity(container);
  const overlay = isOverlay(container);
  const positionedPopup =
    /\b(?:popup|pop up|poplayer|pop layer|modal|teaser)\b/.test(identity) &&
    (overlay || window.getComputedStyle(container).position === "absolute");
  if (!overlay && !positionedPopup) {
    return false;
  }
  const headings = Array.from(
    container.querySelectorAll("h1, h2, h3, [role='heading']"),
  )
    .filter((element) => element instanceof HTMLElement && isVisible(element))
    .map((element) => normalizeText(element.textContent))
    .join(" ");
  if (
    /\b(?:cart|basket|checkout|account|login|sign in|chat|support|help|search|gallery|lightbox|zoom|viewer|carousel)\b/.test(
      `${identity} ${headings}`,
    ) ||
    Array.from(container.querySelectorAll("input, select, textarea")).some(
      (element) => element instanceof HTMLElement && isVisible(element),
    )
  ) {
    return false;
  }
  const images = Array.from(
    container.querySelectorAll("img, [role='img']"),
  ).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      !closeControl.contains(element) &&
      isVisible(element),
  );
  if (images.length === 0) {
    return false;
  }
  const imageLabels = images
    .map(
      (image) =>
        `${image.getAttribute("alt") ?? ""} ${image.getAttribute("aria-label") ?? ""} ${image.getAttribute("title") ?? ""}`,
    )
    .join(" ");
  const text = normalizeText(container.innerText ?? container.textContent);
  if (
    overlay &&
    /\b(?:newsletter|subscription|subscribe|promotions?|promotional|promo|coupons?|discounts?|sale|offers?|rewards?|bestsellers?|best sellers)\b/.test(
      `${identity} ${text} ${normalizeText(imageLabels)}`,
    )
  ) {
    return true;
  }
  // Some promotional widgets put every word in artwork with a generic alt.
  // Require popup metadata and only one artwork plus the explicit close control;
  // other visible text, content or controls make this fallback ambiguous.
  return (
    positionedPopup &&
    images.length === 1 &&
    text ===
      normalizeText(closeControl.innerText ?? closeControl.textContent) &&
    Array.from(container.querySelectorAll("*")).every(
      (element) =>
        (element instanceof HTMLElement && !isVisible(element)) ||
        element === images[0] ||
        element.contains(images[0]) ||
        closeControl.contains(element) ||
        element.contains(closeControl),
    )
  );
}

function isOverlay(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return (
    element.matches("dialog, [role='dialog'], [aria-modal='true']") ||
    style.position === "fixed" ||
    style.position === "sticky"
  );
}

function hasConsentText(element: HTMLElement): boolean {
  // Hidden signup panels can contain marketing consent inside a visible teaser.
  // Only rendered text should classify that teaser as a cookie/consent region.
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
  );
  const visibleText: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (
      node.textContent?.trim() &&
      parent instanceof HTMLElement &&
      isVisible(parent)
    ) {
      visibleText.push(node.textContent);
    }
  }
  const text = normalizeText(visibleText.join(" "));
  return CONSENT_KEYWORDS.some((keyword) => text.includes(keyword));
}

export function findConsentContainer(element: HTMLElement): HTMLElement | null {
  for (
    let parent = getComposedParent(element);
    parent && parent !== document.body;
    parent = getComposedParent(parent)
  ) {
    const identity = `${parent.id} ${parent.className} ${parent.getAttribute("aria-label") ?? ""}`;
    const isCookieRegion =
      /cookie|consent/i.test(identity) &&
      (parent.matches("[role='region'], [role='alert']") ||
        /banner|notice|consent/i.test(identity));
    if ((isOverlay(parent) || isCookieRegion) && hasConsentText(parent)) {
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
  const offerClose = OFFER_CLOSE_LABELS.includes(getCloseLabel(element) ?? "");
  for (
    let parent = getComposedParent(element);
    parent && parent !== document.body;
    parent = getComposedParent(parent)
  ) {
    if (isPromotionalMediaOverlay(parent, element)) {
      return parent;
    }
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
