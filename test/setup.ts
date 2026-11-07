import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  // jsdom has no layout engine. Supply geometry explicitly; CSS visibility is
  // still checked by the production code and geometry edge cases override this.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    new DOMRect(0, 0, 100, 30),
  ] as unknown as DOMRectList);
});

afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
  vi.useRealTimers();
});
