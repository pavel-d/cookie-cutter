import { matcherRules } from "./helpers";
import {
  findBestCandidate,
  runGenericHeuristics,
} from "../src/engine/heuristics";
import { loadFixture } from "./helpers";

describe("floating promotional offers", () => {
  it.each([
    ["Get £50 off", "Close teaser"],
    ["Get ￡50 off", "Close offer"],
    ["Get $20 off", "Close offer"],
    ["Save €100.50 off", "Close promotion"],
    ["Get 25% off", "Close teaser"],
    ["Claim your reward", "Close offer"],
  ])(
    "dismisses %s through %s without opening the offer",
    (offer, closeLabel) => {
      document.body.innerHTML = `<aside style="position: fixed"><span role="button">${offer}</span><button aria-label="${closeLabel}"></button></aside>`;
      const open = vi.fn();
      const close = vi.fn();
      document
        .querySelector("[role='button']")!
        .addEventListener("click", open);
      document.querySelector("button")!.addEventListener("click", close);

      expect(runGenericHeuristics(matcherRules, new WeakSet()).clicked).toBe(
        false,
      );
      expect(document.querySelector("aside")).toBeNull();
      expect(close).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    },
  );

  it("preserves an ordinary inline offer", () => {
    document.body.innerHTML =
      '<section><span role="button">Get £50 off</span><button aria-label="Close teaser"></button></section>';
    expect(findBestCandidate(matcherRules)).toBeNull();
  });

  it("requires promotional context for a floating teaser close control", () => {
    document.body.innerHTML =
      '<aside style="position: fixed"><p>Help with your order</p><button aria-label="Close teaser"></button></aside>';
    expect(findBestCandidate(matcherRules)).toBeNull();
  });

  it("closes the captured subscription teaser despite hidden SMS consent text", () => {
    document.body.innerHTML = loadFixture("captured/ecoflow-teaser.html");
    const close = vi.fn();
    const open = vi.fn();
    document
      .querySelector(".email-subscription-popup__trigger-close")!
      .addEventListener("click", close);
    document
      .querySelector(".email-subscription-popup__trigger-image-wrapper")!
      .addEventListener("click", open);
    expect(findBestCandidate(matcherRules)?.popup).toBe(
      document.querySelector("#email-subscription-popup"),
    );
    expect(runGenericHeuristics(matcherRules, new WeakSet()).clicked).toBe(
      false,
    );
    expect(document.querySelector("#email-subscription-popup")).toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    "display: none",
    "visibility: hidden",
    "opacity: 0",
    "content-visibility: hidden",
  ])(
    "ignores hidden consent text with %s in a promotional overlay",
    (style) => {
      document.body.innerHTML = `<aside style="position: fixed"><img alt="Newsletter subscription"><div style="${style}"><p>You consent to marketing messages.</p></div><button>Close</button></aside>`;
      expect(findBestCandidate(matcherRules)?.reason).toBe(
        "dismiss promotional popup",
      );
    },
  );

  it("preserves visible consent choices in a promotional overlay", () => {
    document.body.innerHTML =
      '<aside style="position: fixed"><img alt="Newsletter subscription"><p>You consent to marketing messages.</p><button>Close</button></aside>';
    expect(findBestCandidate(matcherRules)).toBeNull();
  });

  it.each([
    [
      '<div class="popup-close" style="cursor: pointer">×</div>',
      "Sale: Shop now",
    ],
    ['<span id="dismiss-offer" style="cursor: pointer"></span>', "BESTSELLERS"],
    [
      '<img class="closeIcon" alt="Close" width="24" height="24" style="cursor: pointer">',
      "Coupon offer",
    ],
    ['<button title="Close"><svg></svg></button>', "Special promotion"],
    ['<button aria-label="Close"></button>', "Newsletter subscription"],
  ])("dismisses a media overlay using %s", (control, imageLabel) => {
    document.body.innerHTML = `<aside style="position: fixed"><a href="/shop"><img alt="${imageLabel}" width="200" height="200"></a>${control}</aside>`;
    const open = vi.fn();
    document.querySelector("a")!.addEventListener("click", open);
    const candidate = findBestCandidate(matcherRules);
    expect(candidate?.reason).toBe("dismiss promotional popup");
    expect(runGenericHeuristics(matcherRules, new WeakSet()).clicked).toBe(
      false,
    );
    expect(document.querySelector("aside")).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it("uses promotional overlay metadata when artwork has no image label", () => {
    document.body.innerHTML =
      '<div class="seasonal-promotion" style="position: fixed"><img alt="" width="200" height="200"><span class="close-btn" style="cursor: pointer"></span></div>';
    expect(findBestCandidate(matcherRules)?.reason).toBe(
      "dismiss promotional popup",
    );
  });

  it.each(["fixed", "absolute"])(
    "closes the supplied bestseller markup in a %s popup without opening the artwork",
    (position) => {
      document.body.innerHTML = loadFixture(
        "captured/aliexpress-bestseller.html",
      );
      document.querySelector<HTMLElement>(
        ".drogue-poplayer-modal",
      )!.style.position = position;
      const close = vi.fn();
      const open = vi.fn();
      document.querySelector(".close-btn")!.addEventListener("click", close);
      document.querySelector(".pop-picture")!.addEventListener("click", open);

      expect(runGenericHeuristics(matcherRules, new WeakSet()).clicked).toBe(
        false,
      );
      expect(document.querySelector(".drogue-poplayer-modal")).toBeNull();
      expect(close).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    },
  );

  it.each(["campaign-popup", "notice-modal", "floating-poplayer"])(
    "recognizes unlabelled artwork in a renamed %s",
    (className) => {
      document.body.innerHTML = `<div class="${className}" style="position: fixed"><img class="artwork" alt="picture"><img class="exit-marker" alt="close"></div>`;
      expect(findBestCandidate(matcherRules)?.element).toBe(
        document.querySelector(".exit-marker"),
      );
    },
  );

  it.each([
    '<div class="poplayer-modal"><img alt="pop-picture"><img class="close-btn" alt="close"></div>',
    '<div style="position: fixed"><img alt="pop-picture"><img class="close-btn" alt="close"></div>',
    '<div class="gallery-modal" style="position: fixed"><img alt="pop-picture"><img class="close-btn" alt="close"></div>',
    '<div class="popup" style="position: fixed"><img alt="pop-picture"><img class="close-btn" alt="close"><button>Next image</button></div>',
    '<div class="popup" style="position: fixed"><img alt="pop-picture"><img class="close-btn" alt="close"><input type="email"></div>',
    '<div class="popup" style="position: fixed"><p>Account verification</p><img alt="pop-picture"><img class="close-btn" alt="close"></div>',
    '<div class="popup" style="position: fixed"><img class="close-btn" alt="close"></div>',
    '<div class="popup" style="position: fixed"><img alt="pop-picture" hidden><img class="close-btn" alt="close"></div>',
    '<div class="popup" style="position: fixed"><img alt="pop-picture"><img class="close-btn" alt="close" aria-disabled="true"></div>',
  ])("preserves non-promotional or unsafe artwork popups: %s", (html) => {
    document.body.innerHTML = html;
    expect(findBestCandidate(matcherRules)).toBeNull();
  });

  it.each([
    '<aside><img alt="Sale"><button>Close</button></aside>',
    '<aside style="position: fixed"><img alt="Photo"><button>Close</button></aside>',
    '<aside style="position: fixed"><img alt="Sale"><button aria-label="Shop now" class="close" style="cursor: pointer"></button></aside>',
    '<aside style="position: fixed"><img alt="Sale"><div class="close"></div></aside>',
    '<aside style="position: fixed"><img alt="Sale"><div class="caption">Close</div></aside>',
    '<aside style="position: fixed"><img alt="Sale"><div class="disclose" style="cursor: pointer"></div></aside>',
    '<aside style="position: fixed"><img alt="Sale"><button disabled>Close</button></aside>',
    '<aside style="position: fixed" inert><img alt="Sale"><button>Close</button></aside>',
    '<aside style="position: fixed"><img alt="Sale" hidden><button>Close</button></aside>',
    '<aside style="position: fixed"><img alt="Sale"><button hidden>Close</button></aside>',
    '<aside style="position: fixed"><img alt="Sale"><input type="email"><button>Close</button></aside>',
    '<aside style="position: fixed"><h2>Your shopping cart</h2><img alt="Sale"><button>Close</button></aside>',
    '<aside style="position: fixed"><h2>Sign in to your account</h2><img alt="Sale"><button>Close</button></aside>',
    '<aside class="support-chat" style="position: fixed"><img alt="Sale"><button>Close</button></aside>',
    '<aside class="image-lightbox" style="position: fixed"><img alt="Sale"><button>Close</button></aside>',
  ])("preserves unrelated or unsafe image UI: %s", (html) => {
    document.body.innerHTML = html;
    expect(findBestCandidate(matcherRules)).toBeNull();
  });
});
