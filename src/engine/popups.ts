import type { MatcherRules } from "../rules/ruleset";
import {
  getComposedParent,
  getElementLabel,
  isClickable,
  isEnabled,
  isVisible,
  normalizeText,
} from "./dom";

function getIdentity(element: Element): string {
  return normalizeText(
    `${element.id} ${element.getAttribute("class") ?? ""} ${element.getAttribute("aria-label") ?? ""}`
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " "),
  );
}

export function getCloseLabel(
  rules: MatcherRules,
  element: HTMLElement,
): string | null {
  const label = getElementLabel(element);
  if (rules.labels.close.includes(label)) {
    return label;
  }
  // An explicit accessible label takes precedence over implementation hints.
  if (label && !rules.labels.icons.includes(label)) {
    return null;
  }
  const title = normalizeText(element.getAttribute("title"));
  const alt = normalizeText(element.getAttribute("alt"));
  if (rules.labels.close.includes(title)) {
    return title;
  }
  if (rules.labels.close.includes(alt)) {
    return alt;
  }
  if (
    !title &&
    !alt &&
    rules.patterns.closeIdentity.test(getIdentity(element)) &&
    window.getComputedStyle(element).cursor === "pointer"
  ) {
    return "close";
  }
  return null;
}

export function findVisibleCloseTargets(
  rules: MatcherRules,
  root: ParentNode,
): HTMLElement[] {
  return Array.from(root.querySelectorAll(rules.selectors.closeTargets)).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      getCloseLabel(rules, element) !== null &&
      ((element instanceof HTMLImageElement &&
        rules.labels.close.includes(normalizeText(element.alt))) ||
        isClickable(element) ||
        window.getComputedStyle(element).cursor === "pointer") &&
      isVisible(element) &&
      isEnabled(element),
  );
}

function isPromotionalMediaOverlay(
  rules: MatcherRules,
  container: HTMLElement,
  closeControl: HTMLElement,
): boolean {
  const identity = getIdentity(container);
  const overlay = isOverlay(rules, container);
  const positionedPopup =
    rules.patterns.popupIdentity.test(identity) &&
    (overlay || window.getComputedStyle(container).position === "absolute");
  if (!overlay && !positionedPopup) {
    return false;
  }
  const headings = Array.from(
    container.querySelectorAll(rules.selectors.headings),
  )
    .filter((element) => element instanceof HTMLElement && isVisible(element))
    .map((element) => normalizeText(element.textContent))
    .join(" ");
  if (
    rules.patterns.excludedContext.test(`${identity} ${headings}`) ||
    Array.from(container.querySelectorAll(rules.selectors.formControls)).some(
      (element) => element instanceof HTMLElement && isVisible(element),
    )
  ) {
    return false;
  }
  const images = Array.from(
    container.querySelectorAll(rules.selectors.media),
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
    rules.patterns.promotionalMedia.test(
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

function isOverlay(rules: MatcherRules, element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return (
    element.matches(rules.selectors.overlay) ||
    style.position === "fixed" ||
    style.position === "sticky"
  );
}

function hasConsentText(rules: MatcherRules, element: HTMLElement): boolean {
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
  return rules.labels.consent.some((keyword) => text.includes(keyword));
}

export function findConsentContainer(
  rules: MatcherRules,
  element: HTMLElement,
): HTMLElement | null {
  for (
    let parent = getComposedParent(element);
    parent && parent !== document.body;
    parent = getComposedParent(parent)
  ) {
    const identity = `${parent.id} ${parent.className} ${parent.getAttribute("aria-label") ?? ""}`;
    const isCookieRegion =
      rules.patterns.consentIdentity.test(identity) &&
      (parent.matches(rules.selectors.consentRegion) ||
        rules.patterns.consentRegion.test(identity));
    if (
      (isOverlay(rules, parent) || isCookieRegion) &&
      hasConsentText(rules, parent)
    ) {
      return parent;
    }
  }
  return null;
}

export function canCloseConsentNotice(
  rules: MatcherRules,
  container: HTMLElement,
): boolean {
  const text = normalizeText(container.textContent);
  return (
    rules.patterns.confirmedChoice.test(text) ||
    rules.patterns.necessaryOnly.test(text) ||
    (rules.patterns.strictlyNecessary.test(text) &&
      rules.patterns.noOtherCookies.test(text))
  );
}

export function findPromotionalContainer(
  rules: MatcherRules,
  element: HTMLElement,
): HTMLElement | null {
  const offerClose = rules.labels.offerClose.includes(
    getCloseLabel(rules, element) ?? "",
  );
  for (
    let parent = getComposedParent(element);
    parent && parent !== document.body;
    parent = getComposedParent(parent)
  ) {
    if (isPromotionalMediaOverlay(rules, parent, element)) {
      return parent;
    }
    if (!isOverlay(rules, parent)) {
      continue;
    }
    const text = normalizeText(parent.textContent);
    const signup = rules.patterns.signup.test(text);
    const incentive =
      rules.patterns.incentive.test(text) || rules.patterns.discount.test(text);
    const email = Boolean(parent.querySelector(rules.selectors.email));
    if (
      (signup && (incentive || email)) ||
      (offerClose && incentive) ||
      rules.patterns.rewards.test(text)
    ) {
      return parent;
    }
  }
  return null;
}
