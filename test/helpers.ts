import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import data from "../rules/matchers.json";
import { parseRuleset } from "../src/rules/ruleset";
import type { CookieRule } from "../src/types";

export const matcherRules = parseRuleset(data);
export const withSiteRules = (sites: CookieRule[]) => ({
  ...matcherRules,
  sites,
});

export function loadFixture(name: string): string {
  const fixturePath = resolve(process.cwd(), "test", "fixtures", name);
  return readFileSync(fixturePath, "utf8");
}
