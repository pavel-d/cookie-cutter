import { MAX_HTML_BYTES, type Selection } from "./report";

function selectorInRoot(element: Element, root: Document | ShadowRoot): string {
  const path: string[] = [];
  let current: Element | null = element;
  while (current) {
    if (current.id) {
      const selector = `#${CSS.escape(current.id)}`;
      if (root.querySelectorAll(selector).length === 1) {
        return [selector, ...path].join(" > ");
      }
    }
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children)
      : Array.from(root.children);
    const index =
      siblings
        .filter((sibling) => sibling.localName === current!.localName)
        .indexOf(current) + 1;
    path.unshift(`${CSS.escape(current.localName)}:nth-of-type(${index})`);
    current = current.parentElement;
  }
  return path.join(" > ");
}

export function describeSelection(element: Element): Selection {
  const selectorPath: string[] = [];
  let current = element;
  for (;;) {
    const root = current.getRootNode();
    if (!(root instanceof Document || root instanceof ShadowRoot)) {
      throw new Error("The selected element is no longer on the page.");
    }
    selectorPath.unshift(selectorInRoot(current, root));
    if (root instanceof Document) break;
    current = root.host;
  }
  return { selectorPath, html: element.outerHTML.slice(0, 16000) };
}

export function captureHtml(document: Document): string {
  const clone = document.documentElement.cloneNode(true) as Element;
  // Cloning preserves DOM attributes and markup without running page scripts.
  // Add declarative templates to the clone so open shadow DOM is preserved too.
  function copyShadowRoots(source: Element, target: Element): void {
    for (let index = 0; index < source.children.length; index++) {
      copyShadowRoots(source.children[index], target.children[index]);
    }
    if (source.shadowRoot) {
      const template = document.createElement("template");
      template.setAttribute("shadowrootmode", "open");
      for (const child of source.shadowRoot.childNodes) {
        const childClone = child.cloneNode(true);
        template.content.append(childClone);
        if (child instanceof Element && childClone instanceof Element) {
          copyShadowRoots(child, childClone);
        }
      }
      target.prepend(template);
    }
  }
  copyShadowRoots(document.documentElement, clone);
  const doctype = document.doctype
    ? new XMLSerializer().serializeToString(document.doctype)
    : "<!DOCTYPE html>";
  const html = `${doctype}\n${clone.outerHTML}`;
  if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) {
    throw new Error("This page exceeds the 8 MiB HTML report limit.");
  }
  return html;
}
