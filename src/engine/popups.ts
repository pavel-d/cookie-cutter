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

function isUnlabelledImageControl(
  rules: MatcherRules,
  element: HTMLElement,
): boolean {
  const parent = getComposedParent(element);
  const style = window.getComputedStyle(element);
  if (
    !parent ||
    style.position !== "absolute" ||
    style.cursor !== "pointer" ||
    element instanceof HTMLAnchorElement
  )
    return false;
  const images = Array.from(
    element.querySelectorAll(rules.selectors.media),
  ).filter((node) => node instanceof HTMLElement && isVisible(node));
  if (images.length !== 1) return false;
  const image = images[0] as HTMLElement;
  if (
    [
      getElementLabel(image),
      normalizeText(image.getAttribute("alt")),
      normalizeText(image.getAttribute("title")),
    ].some(
      (label) =>
        label &&
        !rules.labels.close.includes(label) &&
        !rules.labels.icons.includes(label),
    )
  )
    return false;
  const bounds = element.getBoundingClientRect();
  const container = parent.getBoundingClientRect();
  const limits = rules.imageClose;
  const smaller = Math.min(bounds.width, bounds.height);
  const larger = Math.max(bounds.width, bounds.height);
  if (
    smaller < limits.minSize ||
    larger > limits.maxSize ||
    larger / smaller > limits.maxAspectRatio ||
    container.width < bounds.width * limits.minContainerScale ||
    container.height < bounds.height * limits.minContainerScale
  )
    return false;
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  // A small, otherwise unlabelled image control at either top corner is only
  // actionable after findPromotionalContainer also establishes safe context.
  return (
    Math.abs(centerY - container.top) <= bounds.height &&
    (Math.abs(centerX - container.left) <= bounds.width ||
      Math.abs(centerX - container.right) <= bounds.width)
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
    ((rules.patterns.closeIdentity.test(getIdentity(element)) &&
      window.getComputedStyle(element).cursor === "pointer") ||
      isUnlabelledImageControl(rules, element))
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
    (rules.patterns.promotionalMedia.test(
      `${identity} ${text} ${normalizeText(imageLabels)}`,
    ) ||
      rules.patterns.discount.test(text))
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
