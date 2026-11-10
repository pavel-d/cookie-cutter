import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import rules from "../rules/matchers.json";

const { startCookieDismissal } = vi.hoisted(() => ({
  startCookieDismissal: vi.fn(() => vi.fn()),
}));
vi.mock("../src/engine", () => ({ startCookieDismissal }));

let sendMessage: ReturnType<typeof vi.fn>;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  startCookieDismissal.mockClear();
  sendMessage = vi.fn();
  log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("chrome", {
    runtime: {
      id: "test-extension",
      sendMessage,
      onMessage: { addListener: vi.fn() },
    },
  });
});

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.unstubAllGlobals();
});

describe("content script matching rules", () => {
  it.each([undefined, null])(
    "reports an absent background response (%s) without a secondary TypeError",
    async (response) => {
      sendMessage.mockResolvedValue(response);
      await import("../src/content");
      await vi.waitFor(() => expect(log).toHaveBeenCalledOnce());
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(
          "Could not load matching rules: Error: The extension background did not return matching rules.",
        ),
        expect.objectContaining({ cause: response }),
      );
      expect(startCookieDismissal).not.toHaveBeenCalled();
    },
  );

  it.each([false, [], { error: 42 }, {}])(
    "rejects a malformed response (%j) before starting dismissal",
    async (response) => {
      sendMessage.mockResolvedValue(response);
      await import("../src/content");
      await vi.waitFor(() => expect(log).toHaveBeenCalledOnce());
      expect(log.mock.calls[0][1]).toMatchObject({ cause: response });
      expect(startCookieDismissal).not.toHaveBeenCalled();
    },
  );

  it("logs a rejected message's original DOMException and its details", async () => {
    const original = new DOMException("Message channel closed", "AbortError");
    sendMessage.mockRejectedValue(original);
    await import("../src/content");
    await vi.waitFor(() => expect(log).toHaveBeenCalledOnce());
    expect(log).toHaveBeenCalledWith(
      "[cookie-cutter] Could not load matching rules: AbortError: Message channel closed",
      original,
    );
  });

  it("retains the diagnostic returned by the background", async () => {
    sendMessage.mockResolvedValue({
      error:
        "Error: Could not download matching rules.\nCaused by: TimeoutError: The operation timed out.",
    });
    await import("../src/content");
    await vi.waitFor(() => expect(log).toHaveBeenCalledOnce());
    expect(log.mock.calls[0][0]).toContain(
      "TimeoutError: The operation timed out.",
    );
    expect(startCookieDismissal).not.toHaveBeenCalled();
  });

  it("starts dismissal with valid matching rules", async () => {
    sendMessage.mockResolvedValue({
      document: { revision: "a".repeat(64), rules },
    });
    await import("../src/content");
    await vi.waitFor(() => expect(startCookieDismissal).toHaveBeenCalledOnce());
    expect(log).not.toHaveBeenCalled();
  });
});
