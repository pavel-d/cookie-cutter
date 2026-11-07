export function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function getComposedParent(element: HTMLElement): HTMLElement | null {
  if (element.parentElement) {
    return element.parentElement;
  }
  const root = element.getRootNode();
  return root instanceof ShadowRoot && root.host instanceof HTMLElement
    ? root.host
    : null;
}

export function getDetectionRoots(
  root: Document | ShadowRoot = document,
): (Document | ShadowRoot)[] {
  const roots: (Document | ShadowRoot)[] = [root];
  for (const element of root.querySelectorAll("*")) {
    if (element.shadowRoot) {
      roots.push(...getDetectionRoots(element.shadowRoot));
    }
  }
  return roots;
}

export function isVisible(element: HTMLElement): boolean {
  if (
    !element.isConnected ||
    !Array.from(element.getClientRects()).some(
      (rect) => rect.width > 0 && rect.height > 0,
    )
  ) {
    return false;
  }
  for (
    let node: HTMLElement | null = element;
    node;
    node = getComposedParent(node)
  ) {
    const style = window.getComputedStyle(node);
    if (
      node.hidden ||
      (node instanceof HTMLDialogElement && !node.open) ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.contentVisibility === "hidden" ||
      Number.parseFloat(style.opacity) === 0
    ) {
      return false;
    }
  }
  return true;
}

export function isEnabled(element: HTMLElement): boolean {
  if (element.matches(":disabled")) {
    return false;
  }
  for (
    let node: HTMLElement | null = element;
    node;
    node = getComposedParent(node)
  ) {
    if (node.matches("[inert], [aria-disabled='true']")) {
      return false;
    }
  }

  return true;
}

export function isClickable(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute("role");

  return (
    ["button", "a", "input"].includes(tag) ||
    role === "button" ||
    typeof element.onclick === "function"
  );
}

export function getElementLabel(element: HTMLElement): string {
  const ariaLabel = normalizeText(element.getAttribute("aria-label"));
  if (ariaLabel) {
    return ariaLabel;
  }

  if (element instanceof HTMLInputElement) {
    const inputValue = normalizeText(element.value);
    if (inputValue) {
      return inputValue;
    }
  }

  return normalizeText(element.textContent);
}

export function findVisibleClickableTargets(
  root: ParentNode = document,
  labels?: readonly string[],
): HTMLElement[] {
  const nodes = Array.from(
    root.querySelectorAll(
      "button, a, input[type='button'], input[type='submit'], [role='button']",
    ),
  );

  return nodes.filter(
    (node): node is HTMLElement =>
      isClickable(node) &&
      (!labels || labels.includes(getElementLabel(node))) &&
      isVisible(node) &&
      isEnabled(node),
  );
}
