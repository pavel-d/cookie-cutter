import { withSiteRules } from "./helpers";
import { executeDismissal } from "../src/engine";
import {
  byDomain,
  clickSelector,
  clickText,
  defineRule,
} from "../src/rules/helpers";
import { loadFixture } from "./helpers";
import { createDismissalState } from "../src/types";

describe("site-specific rules", () => {
  it("runs a two-step custom flow before generic heuristics", async () => {
    document.body.innerHTML = loadFixture("multi-step-rule.html");
    window.history.replaceState({}, "", "/article");

    const manageButton = document.querySelector("#manage");
    const saveButton = document.querySelector("#save");
    const rejectButton = document.querySelector("#reject-non-essential");

    expect(manageButton).toBeInstanceOf(HTMLElement);
    expect(saveButton).toBeInstanceOf(HTMLElement);
    expect(rejectButton).toBeInstanceOf(HTMLElement);

    const clicks: string[] = [];

    for (const [id, node] of [
      ["manage", manageButton],
      ["reject", rejectButton],
      ["save", saveButton],
    ] as const) {
      (node as HTMLElement).addEventListener("click", () => {
        clicks.push(id);
      });
    }

    const rule = defineRule({
      id: "demo-cmp",
      name: "Demo CMP",
      match: {
        domains: byDomain("demo.test"),
        selectors: ["#demo-banner"],
      },
      steps: [
        clickSelector("open-preferences", ["#manage"]),
        clickText("reject-non-essential", ["Reject non-essential"]),
        clickSelector("save-preferences", ["#save"]),
      ],
    });

    const result = await executeDismissal(
      withSiteRules([rule]),
      createDismissalState(),
    );

    expect(result.clicked).toBe(true);
    if (!result.matched) {
      throw new Error("Expected the site rule to match");
    }
    expect(result.ruleId).toBe("demo-cmp");
    expect(clicks).toEqual(["manage", "reject", "save"]);
  });
});
