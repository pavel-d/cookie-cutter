import { matcherRules } from "./helpers";
import {
  findBestCandidate,
  runGenericHeuristics,
  scoreCandidate,
} from "../src/engine/heuristics";
import { loadFixture } from "./helpers";

describe("generic heuristics", () => {
  it("scores a direct reject action above the click threshold", () => {
    document.body.innerHTML = loadFixture("simple-banner.html");
    const button = document.querySelector("#reject-all");

    expect(button).toBeInstanceOf(HTMLElement);

    const candidate = scoreCandidate(
      matcherRules,
      button as HTMLElement,
      document.body.textContent?.toLowerCase() ?? "",
    );

    expect(candidate).not.toBeNull();
    expect(candidate?.score).toBeGreaterThanOrEqual(matcherRules.threshold);
  });

  it("ignores accept buttons even inside a consent banner", () => {
    document.body.innerHTML = loadFixture("simple-banner.html");
    const button = document.querySelector("#accept-all");

    expect(button).toBeInstanceOf(HTMLElement);

    const candidate = scoreCandidate(
      matcherRules,
      button as HTMLElement,
      document.body.textContent?.toLowerCase() ?? "",
    );

    expect(candidate).toBeNull();
  });

  it("finds the best reject candidate from a realistic banner", () => {
    document.body.innerHTML = loadFixture("simple-banner.html");

    const candidate = findBestCandidate(matcherRules);

    expect(candidate).not.toBeNull();
    expect(candidate?.label).toContain("reject all");
  });

  it("skips unrelated privacy copy that is not a banner", () => {
    document.body.innerHTML = loadFixture("false-positive.html");

    const candidate = findBestCandidate(matcherRules);

    expect(candidate).toBeNull();
  });

  it.each(["Continue without accepting", "Use necessary cookies only"])(
    "supports the explicit reject label %s",
    (label) => {
      document.body.innerHTML = `<div role="dialog"><p>We use cookies.</p><button>${label}</button></div>`;
      expect(findBestCandidate(matcherRules)?.label).toBe(label.toLowerCase());
    },
  );

  it.each([
    "Accept all",
    "Do not reject",
    "Reject and accept cookies",
    "Reject application",
  ])("does not infer rejection from the label %s", (label) => {
    document.body.innerHTML = `<div role="dialog"><p>We use cookies.</p><button>${label}</button></div>`;
    expect(findBestCandidate(matcherRules)).toBeNull();
  });

  it("ignores reject actions in ordinary page content even with long cookie copy", () => {
    document.body.innerHTML = `<main><p>${"Cookie policy information. ".repeat(20)}</p><button>Reject all</button></main>`;
    expect(findBestCandidate(matcherRules)).toBeNull();
  });

  it("opens preferences within consent UI without treating it as a rejection", () => {
    document.body.innerHTML =
      '<div role="dialog"><p>We use cookies.</p><button>Manage preferences</button></div>';
    expect(findBestCandidate(matcherRules)).toMatchObject({
      label: "manage preferences",
      reason: "open cookie preferences",
    });
    expect(
      scoreCandidate(
        matcherRules,
        document.querySelector("button")!,
        "we use cookies",
      ),
    ).toBeNull();
  });

  it("does not use unrelated page copy as consent context", () => {
    document.body.innerHTML =
      '<main>Cookie policy</main><div role="dialog"><p>Reject this invitation?</p><button>Reject</button></div>';
    expect(findBestCandidate(matcherRules)).toBeNull();
  });

  it("clicks each element once and allows another banner with the same label", () => {
    document.body.innerHTML = loadFixture("simple-banner.html");
    const clicked = new WeakSet<HTMLElement>();
    const first = document.querySelector<HTMLElement>("#reject-all")!;
    const firstClick = vi.fn();
    first.addEventListener("click", firstClick);
    expect(runGenericHeuristics(matcherRules, clicked).clicked).toBe(true);
    expect(runGenericHeuristics(matcherRules, clicked).clicked).toBe(false);
    expect(firstClick).toHaveBeenCalledOnce();

    const second = first.cloneNode(true) as HTMLElement;
    first.after(second);
    const secondClick = vi.fn();
    second.addEventListener("click", secondClick);
    expect(runGenericHeuristics(matcherRules, clicked).clicked).toBe(true);
    expect(secondClick).toHaveBeenCalledOnce();
  });
});
