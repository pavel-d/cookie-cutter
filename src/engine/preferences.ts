import type { MatcherRules } from "../rules/ruleset";
import type { ClickCandidate } from "../types";
import {
  findVisibleClickableTargets,
  getDetectionRoots,
  getElementLabel,
  isEnabled,
  isVisible,
  normalizeText,
} from "./dom";

const saveLabels = ["save my cookie settings", "save cookie settings"];
const allowLabel = "use these cookies";
const denyLabel = "do not use these cookies";

function visibleLabel(input: HTMLInputElement): HTMLLabelElement | undefined {
  // Accessible radio controls may be transparent while their labels are visible.
  // Click the native label so the page's form controller receives the change.
  const style = window.getComputedStyle(input);
  if (
    input.hidden ||
    style.display === "none" ||
    style.visibility !== "visible" ||
    !Array.from(input.getClientRects()).some(
      (rect) => rect.width > 0 && rect.height > 0,
    )
  )
    return undefined;
  return Array.from(input.labels ?? []).find(
    (label) => isVisible(label) && isEnabled(label),
  );
}

function isCookieFieldset(fieldset: HTMLFieldSetElement): boolean {
  const root = fieldset.getRootNode() as Document | ShadowRoot;
  const heading = fieldset
    .getAttribute("aria-labelledby")
    ?.split(/\s+/)
    .map((id) => root.getElementById(id))
    .filter((element) => element instanceof HTMLElement && isVisible(element))
    .map((element) => element!.textContent)
    .join(" ");
  const legend = fieldset.querySelector("legend");
  const label = normalizeText(
    fieldset.getAttribute("aria-label") ||
      heading ||
      (legend && isVisible(legend) ? legend.textContent : ""),
  );
  return /\bcookies?\b/.test(label);
}

export function findCookiePreferenceCandidate(
  rules: MatcherRules,
  clickedElements: WeakSet<HTMLElement>,
): ClickCandidate | null {
  for (const root of getDetectionRoots()) {
    for (const save of findVisibleClickableTargets(root, saveLabels)) {
      if (clickedElements.has(save)) continue;
      if (save instanceof HTMLAnchorElement) {
        const url = new URL(save.href, document.baseURI);
        if (
          url.origin !== window.location.origin ||
          !["http:", "https:"].includes(url.protocol) ||
          (save.target && save.target !== "_self")
        )
          continue;
      }
      const form = save.closest("form");
      if (!form || !isEnabled(form)) continue;
      // Only handle a complete, explicit binary cookie choice. Unknown controls
      // could opt into another category or submit an unrelated form.
      const controls = Array.from(form.elements).filter(
        (element) =>
          !element.matches(
            "fieldset, button, input[type='hidden'], input[type='submit'], input[type='button']",
          ),
      );
      if (
        controls.length !== 2 ||
        !controls.every(
          (element): element is HTMLInputElement =>
            element instanceof HTMLInputElement &&
            element.type === "radio" &&
            isEnabled(element),
        )
      )
        continue;
      const radios = controls as HTMLInputElement[];
      const labels = radios.map(visibleLabel);
      if (labels.some((label) => !label)) continue;
      const denyIndex = labels.findIndex(
        (label) => getElementLabel(label!) === denyLabel,
      );
      const allowIndex = labels.findIndex(
        (label) => getElementLabel(label!) === allowLabel,
      );
      if (denyIndex < 0 || allowIndex < 0) continue;
      const deny = radios[denyIndex]!;
      const allow = radios[allowIndex]!;
      const fieldset = deny.closest("fieldset");
      if (
        !fieldset ||
        fieldset.closest("form") !== form ||
        allow.closest("fieldset") !== fieldset ||
        !isVisible(fieldset) ||
        !isCookieFieldset(fieldset)
      )
        continue;
      if (!deny.checked) {
        const label = labels[denyIndex]!;
        if (clickedElements.has(label)) continue;
        return {
          element: label,
          label: denyLabel,
          score: rules.threshold,
          reason: "disable optional cookies",
        };
      }
      // Attribute defaults can be stale in framework-managed forms. Never save
      // until the live properties confirm rejection and no acceptance selection.
      if (allow.checked) continue;
      return {
        element: save,
        label: getElementLabel(save),
        score: rules.threshold,
        reason: "save rejected cookie preferences",
        popup: form,
      };
    }
  }
  return null;
}
