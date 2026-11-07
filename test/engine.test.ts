import { withSiteRules } from "./helpers";
import { startCookieDismissal } from "../src/engine";
import { OBSERVER_WINDOW_MS, SCAN_INTERVAL_MS } from "../src/rules/constants";
import { clickSelector, defineRule } from "../src/rules/helpers";
import { loadFixture } from "./helpers";

describe("scan lifecycle", () => {
  let stop: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
  });

  it("counts a removed popup once and excludes ineffective clicks", async () => {
    document.body.innerHTML =
      '<section class="cookie-banner"><p>We use cookies.</p><button>Reject all</button></section>';
    const closed = vi.fn();
    const banner = document.querySelector<HTMLElement>("section")!;
    stop = startCookieDismissal(withSiteRules([]), closed);
    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS * 2);
    expect(closed).not.toHaveBeenCalled();
    banner.remove();
    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
    expect(closed).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS * 2);
    expect(closed).toHaveBeenCalledOnce();
  });

  it("does not count opening preferences, then counts the hidden banner", async () => {
    document.body.innerHTML =
      '<section class="cookie-banner"><p>We use cookies.</p><button>Preferences</button></section>';
    const banner = document.querySelector<HTMLElement>("section")!;
    banner.querySelector("button")!.addEventListener("click", () => {
      banner.innerHTML = "<p>Cookie preferences</p><button>Deny all</button>";
      banner.querySelector("button")!.addEventListener("click", () => {
        banner.hidden = true;
      });
    });
    const closed = vi.fn();
    stop = startCookieDismissal(withSiteRules([]), closed);
    await vi.advanceTimersByTimeAsync(0);
    expect(closed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
    expect(closed).toHaveBeenCalledOnce();
  });

  it("counts reject plus confirmation on the same banner as one closure", async () => {
    document.body.innerHTML =
      '<section class="cookie-banner"><p>We use cookies.</p><button>Reject all</button></section>';
    const banner = document.querySelector<HTMLElement>("section")!;
    banner.querySelector("button")!.addEventListener("click", () => {
      banner.innerHTML =
        "<p>You have rejected cookies.</p><button>Hide this message</button>";
      banner
        .querySelector("button")!
        .addEventListener("click", () => banner.remove());
    });
    const closed = vi.fn();
    stop = startCookieDismissal(withSiteRules([]), closed);
    await vi.advanceTimersByTimeAsync(0);
    expect(closed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS * 2);
    expect(closed).toHaveBeenCalledOnce();
  });

  it("rescans when an existing banner becomes visible", async () => {
    document.body.innerHTML = loadFixture("simple-banner.html");
    const banner = document.querySelector<HTMLElement>("#cookie-banner")!;
    banner.hidden = true;
    const clicked = vi.fn();
    document.querySelector("#reject-all")!.addEventListener("click", clicked);
    stop = startCookieDismissal(withSiteRules([]));
    await vi.advanceTimersByTimeAsync(0);
    expect(clicked).not.toHaveBeenCalled();
    banner.hidden = false;
    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("does not starve scans while the page changes continuously", async () => {
    stop = startCookieDismissal(withSiteRules([]));
    await vi.advanceTimersByTimeAsync(0);
    document.body.innerHTML = loadFixture("simple-banner.html");
    const clicked = vi.fn();
    document.querySelector("#reject-all")!.addEventListener("click", clicked);
    for (let index = 0; index < 6; index += 1) {
      document.body.append(document.createElement("span"));
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("continues looking for late banners after unrelated early mutations", async () => {
    stop = startCookieDismissal(withSiteRules([]));
    await vi.advanceTimersByTimeAsync(0);
    for (let index = 0; index < 7; index += 1) {
      document.body.append(document.createElement("span"));
      await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
    }
    document.body.innerHTML = loadFixture("simple-banner.html");
    const click = vi.spyOn(
      document.querySelector<HTMLElement>("#reject-all")!,
      "click",
    );
    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
    expect(click).toHaveBeenCalledOnce();
  });

  it("serializes multi-step rules across mutations", async () => {
    document.body.innerHTML =
      '<div id="banner"><button id="manage">Manage preferences</button></div>';
    const manage = document.querySelector<HTMLElement>("#manage")!;
    const manageClick = vi.spyOn(manage, "click");
    const rejectClick = vi.fn();
    manage.addEventListener("click", () => {
      window.setTimeout(() => {
        document.querySelector("#banner")!.innerHTML =
          '<button id="reject">Reject all</button>';
        document
          .querySelector("#reject")!
          .addEventListener("click", rejectClick);
      }, 1200);
    });
    const rule = defineRule({
      id: "delayed",
      name: "Delayed",
      match: { domains: ["demo.test"], selectors: ["#banner"] },
      steps: [
        clickSelector("manage", ["#manage"]),
        clickSelector("reject", ["#reject"], { maxWaitMs: 2000 }),
      ],
    });
    stop = startCookieDismissal(withSiteRules([rule]));
    await vi.advanceTimersByTimeAsync(0);
    document.body.append(document.createElement("span"));
    await vi.advanceTimersByTimeAsync(2200);
    expect(manageClick).toHaveBeenCalledOnce();
    expect(rejectClick).toHaveBeenCalledOnce();
  });

  it("cancels a queued rescan at the observation deadline", async () => {
    stop = startCookieDismissal(withSiteRules([]));
    await vi.advanceTimersByTimeAsync(OBSERVER_WINDOW_MS - 100);
    document.body.innerHTML = loadFixture("simple-banner.html");
    const clicked = vi.fn();
    document.querySelector("#reject-all")!.addEventListener("click", clicked);
    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
    expect(clicked).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops a pending rule at the observation deadline", async () => {
    document.body.innerHTML = '<div id="banner"></div>';
    const rule = defineRule({
      id: "slow",
      name: "Slow",
      match: { domains: ["demo.test"], selectors: ["#banner"] },
      steps: [
        clickSelector("reject", ["#reject"], {
          maxWaitMs: OBSERVER_WINDOW_MS * 2,
        }),
      ],
    });
    stop = startCookieDismissal(withSiteRules([rule]));
    await vi.advanceTimersByTimeAsync(OBSERVER_WINDOW_MS);
    document.querySelector("#banner")!.innerHTML =
      '<button id="reject">Reject all</button>';
    const click = vi.spyOn(
      document.querySelector<HTMLElement>("#reject")!,
      "click",
    );
    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
    expect(click).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears scanning timers when the page is left", async () => {
    stop = startCookieDismissal(withSiteRules([]));
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event("pagehide"));
    document.body.innerHTML = loadFixture("simple-banner.html");
    const click = vi.spyOn(
      document.querySelector<HTMLElement>("#reject-all")!,
      "click",
    );
    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
    expect(click).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports invalid rules and cleans up instead of leaking an async rejection", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const rule = defineRule({
      id: "invalid",
      name: "Invalid",
      match: { domains: ["demo.test"], selectors: ["["] },
      steps: [],
    });
    stop = startCookieDismissal(withSiteRules([rule]));
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledWith(
      "[cookie-cutter] Dismissal failed",
      expect.objectContaining({ name: "SyntaxError" }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
