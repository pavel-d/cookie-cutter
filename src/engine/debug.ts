const DEBUG = false;

export function debugLog(...args: unknown[]): void {
  if (!DEBUG) {
    return;
  }

  console.debug("[cookie-cutter]", ...args);
}
