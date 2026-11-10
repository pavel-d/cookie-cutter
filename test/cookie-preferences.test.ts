import {
  findBestCandidate,
  runGenericHeuristics,
} from "../src/engine/heuristics";
import { loadFixture, matcherRules } from "./helpers";

function preferences(accepted = false) {
  document.body.innerHTML = loadFixture(
    "captured/cookie-choice-preferences.html",
  );
  const [allow, deny] = Array.from(
    document.querySelectorAll<HTMLInputElement>("input[type='radio']"),
  );
  allow.checked = accepted;
  deny.checked = !accepted;
  const save = document.querySelector<HTMLAnchorElement>("a")!;
  save.addEventListener("click", (event) => event.preventDefault());
  // The captured Angular controls have no native name. Model the page's form
  // controller, which updates both checked properties on a radio change.
  deny.addEventListener("change", () => {
    allow.checked = !deny.checked;
  });
  return { allow, deny, save, form: document.querySelector("form")! };
}

function scan(clicked = new WeakSet<HTMLElement>()) {
  return runGenericHeuristics(matcherRules, clicked);
}

describe("captured cookie choices", () => {
  it("opens the submitted banner's preferences without accepting, hiding or counting a rejection", () => {
    document.body.innerHTML = loadFixture("captured/cookie-choice-banner.html");
    const buttons = Array.from(document.querySelectorAll("button"));
    const accept = vi.fn();
    const choose = vi.fn();
    buttons[0].addEventListener("click", accept);
    buttons[1].addEventListener("click", choose);
    expect(findBestCandidate(matcherRules)).toMatchObject({
      label: "choose your cookies",
      reason: "open cookie preferences",
    });
    const clicked = new WeakSet<HTMLElement>();
    expect(scan(clicked)).toMatchObject({ clicked: true, popup: undefined });
    expect(scan(clicked).clicked).toBe(false);
    expect(choose).toHaveBeenCalledOnce();
    expect(accept).not.toHaveBeenCalled();
    expect(buttons[0].isConnected).toBe(true);
  });

  it("saves the actual default rejection using properties, not stale checked attributes", () => {
    const { allow, deny, save } = preferences();
    expect(allow.hasAttribute("checked")).toBe(true);
    expect(allow.checked).toBe(false);
    expect(deny.hasAttribute("checked")).toBe(false);
    const saved = vi.fn();
    save.addEventListener("click", saved);
    const clicked = new WeakSet<HTMLElement>();
    expect(scan(clicked)).toMatchObject({ label: "save my cookie settings" });
    expect(scan(clicked).clicked).toBe(false);
    expect(saved).toHaveBeenCalledOnce();
    expect(deny.checked).toBe(true);
  });

  it("turns an enabled choice off through the visible label before saving", () => {
    const { allow, deny, save } = preferences(true);
    const accepted = vi.fn();
    const saved = vi.fn();
    allow.addEventListener("click", accepted);
    save.addEventListener("click", saved);
    const clicked = new WeakSet<HTMLElement>();
    expect(scan(clicked)).toMatchObject({
      label: "do not use these cookies",
      popup: undefined,
    });
    expect(deny.checked).toBe(true);
    expect(allow.checked).toBe(false);
    expect(saved).not.toHaveBeenCalled();
    expect(scan(clicked)).toMatchObject({ label: "save my cookie settings" });
    expect(scan(clicked).clicked).toBe(false);
    expect(saved).toHaveBeenCalledOnce();
    expect(accepted).not.toHaveBeenCalled();
  });

  it("does not save or loop when a rejected change fails", () => {
    const { deny, save } = preferences(true);
    deny.addEventListener("click", (event) => event.preventDefault());
    const saved = vi.fn();
    save.addEventListener("click", saved);
    const clicked = new WeakSet<HTMLElement>();
    expect(scan(clicked).clicked).toBe(true);
    expect(deny.checked).toBe(false);
    expect(scan(clicked).clicked).toBe(false);
    expect(saved).not.toHaveBeenCalled();
  });

  it("waits for the framework to clear the accepting radio before saving", () => {
    const { allow, deny, save } = preferences();
    allow.checked = true;
    deny.checked = true;
    const saved = vi.fn();
    save.addEventListener("click", saved);
    expect(scan().clicked).toBe(false);
    expect(saved).not.toHaveBeenCalled();
  });

  it.each([
    "unknown checkbox",
    "unknown select",
    "unrelated email",
    "extra radio",
    "disabled deny",
    "inert form",
    "hidden fieldset",
    "hidden label",
    "hidden input",
    "unrelated heading",
    "ambiguous rejection",
    "accepting save",
    "cross-origin save",
    "new-window save",
    "missing form",
  ])("leaves %s unchanged", (scenario) => {
    const { deny, save, form } = preferences(true);
    switch (scenario) {
      case "unknown checkbox":
        form.insertAdjacentHTML("beforeend", '<input type="checkbox" checked>');
        break;
      case "unknown select":
        form.insertAdjacentHTML(
          "beforeend",
          "<select><option>Accept</option></select>",
        );
        break;
      case "unrelated email":
        form.insertAdjacentHTML("beforeend", '<input type="email">');
        break;
      case "extra radio":
        form.insertAdjacentHTML("beforeend", '<input type="radio" checked>');
        break;
      case "disabled deny":
        deny.disabled = true;
        break;
      case "inert form":
        form.setAttribute("inert", "");
        break;
      case "hidden fieldset":
        deny.closest("fieldset")!.hidden = true;
        break;
      case "hidden label":
        deny.labels![0].hidden = true;
        break;
      case "hidden input":
        deny.hidden = true;
        break;
      case "unrelated heading":
        document.querySelector("h2")!.textContent = "Contact preferences";
        break;
      case "ambiguous rejection":
        deny.labels![0].textContent = "No";
        break;
      case "accepting save":
        save.textContent = "Accept and save";
        break;
      case "cross-origin save":
        save.href = "https://other.test/save";
        break;
      case "new-window save":
        save.target = "_blank";
        break;
      case "missing form":
        form.replaceWith(...form.childNodes);
        break;
    }
    const clicked = vi.fn();
    document.body.addEventListener("click", clicked, { once: true });
    expect(scan().clicked).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
    expect(save.isConnected).toBe(true);
  });
});
