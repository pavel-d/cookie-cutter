import { executeDismissal } from "../src/engine";
import { ruleMatches, sortRules } from "../src/engine/rules";
import {
  byDomain,
  clickSelector,
  clickText,
  defineRule,
} from "../src/rules/helpers";
import {
  createDismissalState,
  type CookieRule,
  type RuleStep,
} from "../src/types";
import { loadFixture } from "./helpers";

function makeRule(steps: RuleStep[]): CookieRule {
  return defineRule({
    id: "demo",
    name: "Demo",
    match: { domains: byDomain("demo.test"), selectors: ["#banner"] },
    steps,
  });
}

describe("rule execution", () => {
  it("chooses a visible enabled selector match after hidden and disabled matches", async () => {
    document.body.innerHTML =
      '<div id="banner"><button hidden class="reject">Reject all</button><button disabled class="reject">Reject all</button><button class="reject" id="visible">Reject all</button></div>';
    const clicked = vi.fn();
    document.querySelector("#visible")!.addEventListener("click", clicked);
    const rule = makeRule([clickSelector("reject", [".reject"])]);
    expect(
      (await executeDismissal([rule], createDismissalState())).clicked,
    ).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it.each(["hidden", "disabled", "inert"])(
    "does not click %s selector targets",
    async (attribute) => {
      document.body.innerHTML = `<div id="banner"><button ${attribute} id="reject">Reject all</button></div>`;
      const click = vi.spyOn(
        document.querySelector<HTMLElement>("#reject")!,
        "click",
      );
      const result = await executeDismissal(
        [makeRule([clickSelector("reject", ["#reject"])])],
        createDismissalState(),
      );
      expect(result.clicked).toBe(false);
      expect(click).not.toHaveBeenCalled();
    },
  );

  it("does not fall back to generic actions when a site rule owns the flow", async () => {
    document.body.innerHTML =
      loadFixture("simple-banner.html") + '<div id="banner"></div>';
    const click = vi.spyOn(
      document.querySelector<HTMLElement>("#reject-all")!,
      "click",
    );
    const result = await executeDismissal(
      [makeRule([clickSelector("missing", ["#missing"])])],
      createDismissalState(),
    );
    expect(result).toMatchObject({
      matched: true,
      clicked: false,
      ruleId: "demo",
    });
    expect(click).not.toHaveBeenCalled();
  });

  it("waits for a delayed next step and does not repeat a completed flow", async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<div id="banner"><button id="manage">Manage preferences</button><div id="panel" hidden><button id="reject">Reject all</button></div></div>';
    const manage = document.querySelector<HTMLElement>("#manage")!;
    const manageClick = vi.spyOn(manage, "click");
    const rejectClick = vi.spyOn(
      document.querySelector<HTMLElement>("#reject")!,
      "click",
    );
    manage.addEventListener("click", () => {
      window.setTimeout(() => {
        document.querySelector<HTMLElement>("#panel")!.hidden = false;
      }, 200);
    });
    const rule = makeRule([
      clickSelector("manage", ["#manage"]),
      clickSelector("reject", ["#reject"], { maxWaitMs: 500 }),
    ]);
    const state = createDismissalState();
    const result = executeDismissal([rule], state);
    await vi.advanceTimersByTimeAsync(300);
    expect((await result).clicked).toBe(true);
    expect((await executeDismissal([rule], state)).clicked).toBe(false);
    expect(manageClick).toHaveBeenCalledOnce();
    expect(rejectClick).toHaveBeenCalledOnce();
  });

  it("resumes after a missing step even when the original match selector is removed", async () => {
    document.body.innerHTML =
      '<div id="banner"><button id="manage">Manage preferences</button></div>';
    const manageClick = vi.fn(() =>
      document.querySelector("#banner")!.remove(),
    );
    document.querySelector("#manage")!.addEventListener("click", manageClick);
    const rule = makeRule([
      clickSelector("manage", ["#manage"]),
      clickSelector("save", ["#save"]),
    ]);
    const state = createDismissalState();
    expect((await executeDismissal([rule], state)).clicked).toBe(true);
    document.body.innerHTML = '<button id="save">Save choices</button>';
    const saveClick = vi.spyOn(
      document.querySelector<HTMLElement>("#save")!,
      "click",
    );
    expect((await executeDismissal([rule], state)).clicked).toBe(true);
    expect(manageClick).toHaveBeenCalledOnce();
    expect(saveClick).toHaveBeenCalledOnce();
  });

  it("stops waiting at the step timeout", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="banner"></div>';
    const rule = makeRule([
      clickSelector("missing", ["#missing"], { maxWaitMs: 250 }),
    ]);
    const result = executeDismissal([rule], createDismissalState());
    await vi.advanceTimersByTimeAsync(250);
    expect(await result).toMatchObject({
      matched: true,
      clicked: false,
      reason: "rule demo missing step missing",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not click after cancellation while waiting", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="banner"></div>';
    const controller = new AbortController();
    const result = executeDismissal(
      [makeRule([clickSelector("reject", ["#reject"], { maxWaitMs: 500 })])],
      createDismissalState(),
      controller.signal,
    );
    controller.abort();
    document.querySelector("#banner")!.innerHTML =
      '<button id="reject">Reject all</button>';
    const click = vi.spyOn(
      document.querySelector<HTMLElement>("#reject")!,
      "click",
    );
    await vi.advanceTimersByTimeAsync(100);
    expect((await result).clicked).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it("matches complete text labels rather than substrings", async () => {
    document.body.innerHTML =
      '<div id="banner"><button>Do not reject all</button></div>';
    expect(
      (
        await executeDismissal(
          [makeRule([clickText("reject", ["Reject all"])])],
          createDismissalState(),
        )
      ).clicked,
    ).toBe(false);
  });

  it("searches all matching scoped containers", async () => {
    document.body.innerHTML =
      '<div id="banner"><div class="panel"></div><div class="panel"><button id="reject">Reject all</button></div></div>';
    const rule = makeRule([
      clickText("reject", ["Reject all"], { withinSelectors: [".panel"] }),
    ]);
    expect(
      (await executeDismissal([rule], createDismissalState())).clicked,
    ).toBe(true);
  });
});

describe("rule matching", () => {
  it.each([
    ["https://demo.test/", true],
    ["https://sub.demo.test/", true],
    ["https://notdemo.test/", false],
    ["https://demo.test.evil.test/", false],
  ])("matches domain boundaries for %s", (url, expected) => {
    const rule = makeRule([]);
    rule.match.selectors = [];
    expect(ruleMatches(rule, { url: new URL(url) })).toBe(expected);
  });

  it("evaluates global path patterns deterministically", () => {
    document.body.innerHTML = '<div id="banner"></div>';
    const rule = makeRule([]);
    rule.match.pathPattern = /^\/article/g;
    const context = { url: new URL("https://demo.test/article") };
    expect(ruleMatches(rule, context)).toBe(true);
    expect(ruleMatches(rule, context)).toBe(true);
  });

  it("rechecks path restrictions when resuming a rule", async () => {
    document.body.innerHTML =
      '<div id="banner"><button id="manage">Manage</button><button id="save">Save</button></div>';
    const rule = makeRule([
      clickSelector("manage", ["#manage"]),
      clickSelector("missing", ["#missing"]),
    ]);
    rule.match.pathPattern = /^\/article/;
    const state = createDismissalState();
    window.history.replaceState({}, "", "/article");
    expect((await executeDismissal([rule], state)).clicked).toBe(true);
    window.history.replaceState({}, "", "/other");
    expect((await executeDismissal([rule], state)).matched).toBe(false);
  });

  it("sorts enabled rules by descending priority without changing the registry", () => {
    const low = { ...makeRule([]), id: "low", priority: 1 };
    const high = { ...makeRule([]), id: "high", priority: 200 };
    const disabled = { ...makeRule([]), enabled: false };
    const rules = [low, disabled, high];
    expect(sortRules(rules)).toEqual([high, low]);
    expect(rules).toEqual([low, disabled, high]);
  });
});
