import { runGenericHeuristics } from "../src/engine/heuristics";
import { loadFixture, matcherRules } from "./helpers";

function mount(name: string) {
  document.body.innerHTML =
    "<main><button>Continue</button></main>" +
    loadFixture("captured/" + name + ".html");
  for (const template of document.querySelectorAll<HTMLTemplateElement>(
    "template[shadowrootmode=open]",
  )) {
    template
      .parentElement!.attachShadow({ mode: "open" })
      .append(template.content);
    template.remove();
  }
}

it.each([
  ["western-automation", "i do not accept"],
  ["hmrc-choice", "reject additional cookies"],
  ["hmrc-confirmation", "hide cookies message"],
  ["gateway-choice", "reject analytics cookies"],
  ["gateway-confirmation", "hide cookie message"],
  ["axeptio", "continue without consent"],
  ["samsung-preferences", "decline all"],
])("chooses the explicit action in %s", (name, label) => {
  mount(name);
  const clicks: string[] = [];
  document.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      clicks.push(
        (event.composedPath()[0] as HTMLElement)
          .textContent!.trim()
          .toLowerCase(),
      );
    },
    { once: true },
  );
  const clicked = new WeakSet<HTMLElement>();
  expect(runGenericHeuristics(matcherRules, clicked).clicked).toBe(true);
  expect(clicks).toEqual([label]);
  expect(runGenericHeuristics(matcherRules, clicked).matched).toBe(false);
});

it.each([
  ["oak-furnitureland", "[role=dialog]"],
  ["currys-perks", "smc-bg"],
])("removes the %s signup without triggering a handler", (name, selector) => {
  mount(name);
  const spy = vi.fn();
  document.body.addEventListener("click", spy);
  try {
    const clicked = new WeakSet<HTMLElement>();
    expect(runGenericHeuristics(matcherRules, clicked).matched).toBe(true);
    expect(document.querySelector(selector)).toBeNull();
    expect(document.querySelector("main button")).not.toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(runGenericHeuristics(matcherRules, clicked).matched).toBe(false);
  } finally {
    document.body.removeEventListener("click", spy);
  }
});

it("leaves the acceptance-only notice unchanged", () => {
  mount("lightoptics");
  expect(runGenericHeuristics(matcherRules, new WeakSet()).matched).toBe(false);
  expect(document.querySelector("#accept-cookies")).not.toBeNull();
});
