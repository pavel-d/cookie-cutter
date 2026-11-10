import { describe, expect, it, vi } from "vitest";
import { describeError, logError } from "../src/browser/errors";

describe("extension error logging", () => {
  it("includes DOMException details in the text and retains the original error", () => {
    const original = new DOMException(
      "The operation timed out.",
      "TimeoutError",
    );
    const error = new Error("Could not download matching rules.", {
      cause: original,
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("Rules update failed", error);
    expect(log).toHaveBeenCalledWith(
      "[cookie-cutter] Rules update failed: Error: Could not download matching rules.\nCaused by: TimeoutError: The operation timed out.",
      error,
    );
    expect(error.cause).toBe(original);
  });

  it("includes errors from another browser context without relying on instanceof", () => {
    expect(
      describeError({ name: "DataError", message: "Invalid key data" }),
    ).toBe("DataError: Invalid key data");
  });

  it.each(["offline", undefined, null, 42])(
    "preserves a non-Error rejection (%s)",
    (value) => {
      expect(describeError(value)).toBe(String(value));
    },
  );

  it("does not loop forever on a cyclic error cause", () => {
    const error = new Error("Cycle");
    error.cause = error;
    expect(describeError(error)).toBe("Error: Cycle");
  });
});
