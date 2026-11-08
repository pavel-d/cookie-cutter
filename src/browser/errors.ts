export function describeError(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  while (!seen.has(error)) {
    seen.add(error);
    // DOMException is not an Error instance in every browser context.
    if (
      error !== null &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      const name =
        "name" in error && typeof error.name === "string"
          ? error.name
          : "Error";
      messages.push(`${name}: ${error.message}`);
      if (!("cause" in error)) break;
      error = error.cause;
    } else {
      messages.push(String(error));
      break;
    }
  }
  return messages.join("\nCaused by: ");
}

export function logError(context: string, error: unknown): void {
  console.error(`[cookie-cutter] ${context}: ${describeError(error)}`, error);
}
