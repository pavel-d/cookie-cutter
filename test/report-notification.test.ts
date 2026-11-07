// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionMessage, ReportStatus } from "../src/reporting/protocol";

vi.mock("../src/reporting/stats-background", () => ({ registerStats() {} }));
vi.mock("../src/rules/background", () => ({ registerRuleUpdates() {} }));

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const message: ExtensionMessage = {
  type: "selection-captured",
  capture: {
    url: "https://fixture.example/",
    title: "Popup fixture",
    capturedAt: "2026-11-07T10:00:00.000Z",
    selection: {
      selectorPath: ["#popup"],
      html: '<aside id="popup">Offer</aside>',
    },
    html: '<!doctype html><html><body><aside id="popup">Offer</aside></body></html>',
  },
};

describe("on-page report feedback", () => {
  let status: ReportStatus;
  let events: string[];
  let listener: (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    respond: (value: unknown) => void,
  ) => boolean | undefined;
  const sender: chrome.runtime.MessageSender = {
    id: "extension-id",
    frameId: 0,
    documentId: "captured-document",
    tab: {
      id: 7,
      windowId: 1,
      index: 0,
      active: true,
      highlighted: true,
      pinned: false,
      incognito: false,
      selected: true,
      discarded: false,
      frozen: false,
      lastAccessed: 0,
      autoDiscardable: true,
      groupId: -1,
      url: "https://fixture.example/",
    },
  };
  const inject = vi.fn();
  const capture = vi.fn();
  const request = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    status = { phase: "selecting", tabId: 7, expiresAt: Date.now() + 120000 };
    events = [];
    inject.mockReset().mockImplementation(async ({ args }) => {
      events.push(args[0].phase);
      return [];
    });
    capture.mockReset().mockImplementation(async () => {
      events.push("screenshot");
      return "data:image/png;base64,test";
    });
    request.mockReset().mockImplementation(async (url) => {
      if (String(url).startsWith("data:")) return new Response(png);
      events.push("backend");
      return Response.json(
        {
          identifier: "TEST-1",
          url: "https://linear.app/example/issue/TEST-1",
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", request);
    vi.stubGlobal("chrome", {
      storage: {
        session: {
          setAccessLevel: async () => {},
          get: async () => ({ reportStatus: status }),
          set: async (value: { reportStatus: ReportStatus }) => {
            status = value.reportStatus;
          },
        },
      },
      action: {
        setBadgeText: async () => {},
        setBadgeBackgroundColor: async () => {},
      },
      tabs: {
        get: async () => sender.tab,
        query: async () => [sender.tab],
        captureVisibleTab: capture,
      },
      windows: { get: async () => ({ focused: true }) },
      scripting: { executeScript: inject },
      runtime: {
        id: "extension-id",
        getManifest: () => ({ version: "0.3.2" }),
        onMessage: {
          addListener: (callback: typeof listener) => {
            listener = callback;
          },
        },
      },
    });
    await import("../src/reporting/background");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function submit(): Promise<ReportStatus> {
    return new Promise((resolve) => {
      listener(message, sender, (value) => resolve(value as ReportStatus));
    });
  }

  it("shows sending only after capture, then confirms on the original document", async () => {
    const result = await submit();
    expect(events).toEqual(["screenshot", "sending", "backend", "sent"]);
    expect(result.phase).toBe("sent");
    for (const [call] of inject.mock.calls)
      expect(call.target).toEqual({
        tabId: 7,
        documentIds: ["captured-document"],
      });
    expect(inject.mock.calls[1][0].args).toEqual([
      { phase: "sent", identifier: "TEST-1" },
    ]);
  });

  it("shows a persistent error when sending fails", async () => {
    request.mockImplementation(async (url) => {
      if (String(url).startsWith("data:")) return new Response(png);
      events.push("backend");
      return Response.json({ error: "unavailable" }, { status: 502 });
    });
    expect((await submit()).phase).toBe("error");
    expect(events).toEqual(["screenshot", "sending", "backend", "error"]);
    expect(inject.mock.calls[1][0].args[0].message).toBe(
      "Could not send the report. Please try again.",
    );
  });

  it("shows capture errors without claiming the report was submitted", async () => {
    capture.mockRejectedValue(new Error("Could not capture this page."));
    expect((await submit()).phase).toBe("error");
    expect(request).not.toHaveBeenCalled();
    expect(events).toEqual(["error"]);
  });

  it("keeps a successful receipt if navigation prevents the page notification", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    inject.mockRejectedValue(new Error("Document was removed"));
    expect((await submit()).phase).toBe("sent");
    expect(warning).toHaveBeenCalledTimes(2);
  });
});
