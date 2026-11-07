import type { CookieRule } from "../types";

const labelKeys = [
  "consent",
  "reject",
  "preferences",
  "close",
  "offerClose",
  "icons",
  "nonEssential",
] as const;
const patternKeys = [
  "closeIdentity",
  "popupIdentity",
  "excludedContext",
  "promotionalMedia",
  "consentIdentity",
  "consentRegion",
  "confirmedChoice",
  "necessaryOnly",
  "strictlyNecessary",
  "noOtherCookies",
  "signup",
  "incentive",
  "discount",
  "rewards",
] as const;
const selectorKeys = [
  "closeTargets",
  "headings",
  "formControls",
  "media",
  "overlay",
  "consentRegion",
  "email",
] as const;
const imageCloseKeys = [
  "minSize",
  "maxSize",
  "minContainerScale",
  "maxAspectRatio",
] as const;

export interface MatcherRules {
  labels: Record<(typeof labelKeys)[number], string[]>;
  patterns: Record<(typeof patternKeys)[number], RegExp>;
  selectors: Record<(typeof selectorKeys)[number], string>;
  threshold: number;
  imageClose: Record<(typeof imageCloseKeys)[number], number>;
  sites: CookieRule[];
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid rules object.");
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 2048)
    throw new Error("Invalid rule text.");
  return value;
}

function texts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 256)
    throw new Error("Invalid rule labels.");
  return value.map(text);
}

function fields<K extends string, T>(
  value: unknown,
  keys: readonly K[],
  decode: (value: unknown) => T,
): Record<K, T> {
  const input = object(value);
  if (
    Object.keys(input).length !== keys.length ||
    Object.keys(input).some((key) => !keys.includes(key as K))
  )
    throw new Error("Unexpected rule fields.");
  return Object.fromEntries(
    keys.map((key) => [key, decode(input[key])]),
  ) as Record<K, T>;
}

function boundedNumber(value: unknown, maximum: number): number {
  if (
    !Number.isInteger(value) ||
    typeof value !== "number" ||
    value < 0 ||
    value > maximum
  )
    throw new Error("Invalid rule number.");
  return value;
}

export function parseRuleset(value: unknown): MatcherRules {
  const input = object(value);
  if (input.schemaVersion !== 1) throw new Error("Unsupported rules schema.");
  const imageClose = fields(input.imageClose, imageCloseKeys, (value) => {
    const number = boundedNumber(value, 256);
    if (number === 0) throw new Error("Invalid image close limit.");
    return number;
  });
  if (imageClose.minSize > imageClose.maxSize)
    throw new Error("Invalid image close size range.");
  if (!Array.isArray(input.sites) || input.sites.length > 512)
    throw new Error("Invalid site rules.");
  const ids = new Set<string>();
  const sites = input.sites.map((value): CookieRule => {
    const rule = object(value);
    const id = text(rule.id);
    if (ids.has(id)) throw new Error("Duplicate rule ID.");
    ids.add(id);
    const match = object(rule.match);
    if (
      !Array.isArray(rule.steps) ||
      rule.steps.length < 1 ||
      rule.steps.length > 20
    )
      throw new Error("Invalid rule steps.");
    if (rule.enabled !== undefined && typeof rule.enabled !== "boolean")
      throw new Error("Invalid rule enabled flag.");
    return {
      id,
      name: text(rule.name),
      enabled: rule.enabled as boolean | undefined,
      priority:
        rule.priority === undefined
          ? undefined
          : boundedNumber(rule.priority, 1000),
      match: {
        domains: texts(match.domains),
        selectors:
          match.selectors === undefined ? undefined : texts(match.selectors),
        pathPattern:
          match.pathPattern === undefined
            ? undefined
            : new RegExp(text(match.pathPattern)),
      },
      steps: rule.steps.map((value) => {
        const step = object(value);
        const target = object(step.target);
        const selectors =
          target.selectors === undefined ? undefined : texts(target.selectors);
        const labels =
          target.texts === undefined ? undefined : texts(target.texts);
        if (!selectors?.length && !labels?.length)
          throw new Error("Empty rule target.");
        return {
          id: text(step.id),
          target: { selectors, texts: labels },
          withinSelectors:
            step.withinSelectors === undefined
              ? undefined
              : texts(step.withinSelectors),
          maxWaitMs:
            step.maxWaitMs === undefined
              ? undefined
              : boundedNumber(step.maxWaitMs, 15000),
        };
      }),
    };
  });
  return {
    labels: fields(input.labels, labelKeys, texts),
    patterns: fields(
      input.patterns,
      patternKeys,
      (value) => new RegExp(text(value), "i"),
    ),
    selectors: fields(input.selectors, selectorKeys, text),
    threshold: boundedNumber(input.threshold, 100),
    imageClose,
    sites,
  };
}
