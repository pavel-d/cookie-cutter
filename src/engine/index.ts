import { OBSERVER_WINDOW_MS, SCAN_INTERVAL_MS } from "../rules/constants";
import { runGenericHeuristics } from "./heuristics";
import { debugLog } from "./debug";
import { runMatchingRule } from "./rules";
import { createDismissalState } from "../types";
import { isVisible } from "./dom";
import type {
  DetectionContext,
  DismissalState,
  ExecutionResult,
} from "../types";
import type { MatcherRules } from "../rules/ruleset";

export async function executeDismissal(
  rules: MatcherRules,
  state: DismissalState,
  signal?: AbortSignal,
): Promise<ExecutionResult> {
  const context: DetectionContext = {
    url: new URL(window.location.href),
  };

  const siteResult = await runMatchingRule(
    rules,
    rules.sites,
    context,
    state.ruleProgress,
    signal,
  );
  if (siteResult.matched) {
    debugLog("site rule result", siteResult.reason);
    return siteResult;
  }
  if (signal?.aborted) {
    return { matched: false, clicked: false, reason: "dismissal stopped" };
  }
  return runGenericHeuristics(rules, state.clickedElements);
}

export function startCookieDismissal(
  rules: MatcherRules,
  onPopupClosed?: () => void,
): () => void {
  const state = createDismissalState();
  const controller = new AbortController();
  let scanTimer: number | undefined;
  let running = false;
  const pending = new Set<HTMLElement>();
  const counted = new WeakSet<HTMLElement>();
  const recordClosed = (): void => {
    for (const popup of pending) {
      if (isVisible(popup)) continue;
      pending.delete(popup);
      if (!counted.has(popup)) {
        counted.add(popup);
        onPopupClosed?.();
      }
    }
  };

  const stop = (): void => {
    controller.abort();
    window.clearTimeout(scanTimer);
    window.clearTimeout(deadlineTimer);
    document.removeEventListener("DOMContentLoaded", onReady);
    window.removeEventListener("pagehide", stop);
  };

  const runScan = async (): Promise<void> => {
    if (controller.signal.aborted || running) {
      return;
    }

    running = true;
    try {
      recordClosed();
      const result = await executeDismissal(rules, state, controller.signal);
      if (!controller.signal.aborted) {
        if (result.matched && result.popup && !counted.has(result.popup))
          pending.add(result.popup);
        recordClosed();
      }
    } catch (error) {
      stop();
      console.error("[cookie-cutter] Dismissal failed", error);
    } finally {
      running = false;
      scheduleScan();
    }
  };

  const scheduleScan = (): void => {
    if (controller.signal.aborted) {
      return;
    }
    if (running || scanTimer !== undefined) {
      return;
    }
    scanTimer = window.setTimeout(() => {
      scanTimer = undefined;
      void runScan();
    }, SCAN_INTERVAL_MS);
  };

  const onReady = (): void => {
    void runScan();
  };

  const deadlineTimer = window.setTimeout(() => {
    recordClosed();
    stop();
  }, OBSERVER_WINDOW_MS);
  window.addEventListener("pagehide", stop, { once: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady, { once: true });
  } else {
    onReady();
  }
  return stop;
}
