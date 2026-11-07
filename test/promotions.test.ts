import {
  findBestCandidate,
  runGenericHeuristics,
} from "../src/engine/heuristics";

describe("floating promotional offers", () => {
  it.each([
    ["Get £50 off", "Close teaser"],
    ["Get $20 off", "Close offer"],
    ["Save €100.50 off", "Close promotion"],
    ["Get 25% off", "Close teaser"],
    ["Claim your reward", "Close offer"],
  ])(
    "dismisses %s through %s without opening the offer",
    (offer, closeLabel) => {
      document.body.innerHTML = `<aside style="position: fixed"><span role="button">${offer}</span><button aria-label="${closeLabel}"></button></aside>`;
      const open = vi.fn();
      const close = vi.fn();
      document
        .querySelector("[role='button']")!
        .addEventListener("click", open);
      document.querySelector("button")!.addEventListener("click", close);

      expect(runGenericHeuristics(new WeakSet()).clicked).toBe(true);
      expect(close).toHaveBeenCalledOnce();
      expect(open).not.toHaveBeenCalled();
    },
  );

  it("preserves an ordinary inline offer", () => {
    document.body.innerHTML =
      '<section><span role="button">Get £50 off</span><button aria-label="Close teaser"></button></section>';
    expect(findBestCandidate()).toBeNull();
  });

  it("requires promotional context for a floating teaser close control", () => {
    document.body.innerHTML =
      '<aside style="position: fixed"><p>Help with your order</p><button aria-label="Close teaser"></button></aside>';
    expect(findBestCandidate()).toBeNull();
  });
});
