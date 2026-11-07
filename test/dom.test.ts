import {
  findVisibleClickableTargets,
  isEnabled,
  isVisible,
} from "../src/engine/dom";

describe("safe click targets", () => {
  it.each([
    "display: none",
    "visibility: hidden",
    "visibility: collapse",
    "opacity: 0",
    "content-visibility: hidden",
  ])("excludes controls inside an ancestor with %s", (style) => {
    document.body.innerHTML = `<div style="${style}"><button>Reject all</button></div>`;
    expect(findVisibleClickableTargets()).toEqual([]);
  });

  it("excludes controls inside hidden ancestors", () => {
    document.body.innerHTML = "<div hidden><button>Reject all</button></div>";
    expect(findVisibleClickableTargets()).toEqual([]);
  });

  it.each([
    "<button disabled>Reject all</button>",
    "<fieldset disabled><button>Reject all</button></fieldset>",
    "<div inert><button>Reject all</button></div>",
    '<div aria-disabled="true"><button>Reject all</button></div>',
  ])("excludes disabled or inert controls: %s", (html) => {
    document.body.innerHTML = html;
    expect(findVisibleClickableTargets()).toEqual([]);
  });

  it("does not treat text or styled dimensions as proof of layout", () => {
    document.body.innerHTML =
      '<button style="width: 100px">Reject all</button>';
    const button = document.querySelector("button")!;
    vi.spyOn(button, "getClientRects").mockReturnValue(
      [] as unknown as DOMRectList,
    );
    expect(isVisible(button)).toBe(false);
  });

  it("excludes detached elements", () => {
    const button = document.createElement("button");
    button.textContent = "Reject all";
    expect(isVisible(button)).toBe(false);
  });

  it("excludes controls whose layout boxes have zero area", () => {
    document.body.innerHTML = "<button>Reject all</button>";
    const button = document.querySelector("button")!;
    vi.spyOn(button, "getClientRects").mockReturnValue([
      new DOMRect(0, 0, 100, 0),
    ] as unknown as DOMRectList);
    expect(isVisible(button)).toBe(false);
  });

  it("keeps visible enabled controls", () => {
    document.body.innerHTML = "<button>Reject all</button>";
    const button = document.querySelector("button")!;
    expect(isVisible(button)).toBe(true);
    expect(isEnabled(button)).toBe(true);
    expect(findVisibleClickableTargets()).toEqual([button]);
  });
});
