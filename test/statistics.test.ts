// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PopupCounter, type StatsStorage } from "../src/statistics";

function storage(): StatsStorage {
  let total = 0;
  const pages = new Map<string, number>();
  return {
    async getTotal() {
      return total;
    },
    async getPage(id) {
      return pages.get(id) ?? 0;
    },
    async save(nextTotal, id, count) {
      total = nextTotal;
      pages.set(id, count);
    },
  };
}

describe("popup statistics", () => {
  it("serializes simultaneous closures without losing totals and keeps documents separate", async () => {
    const counter = new PopupCounter(storage());
    await Promise.all([
      counter.record("first"),
      counter.record("second"),
      counter.record("first"),
    ]);
    expect(await counter.read("first")).toEqual({ page: 2, total: 3 });
    expect(await counter.read("second")).toEqual({ page: 1, total: 3 });
    expect(await counter.read("reloaded-document")).toEqual({
      page: 0,
      total: 3,
    });
    expect(await counter.read(undefined)).toEqual({ page: 0, total: 3 });
  });

  it("preserves totals when the background restarts", async () => {
    const saved = storage();
    await new PopupCounter(saved).record("page");
    expect(await new PopupCounter(saved).read("page")).toEqual({
      page: 1,
      total: 1,
    });
  });

  it("reports storage errors and allows a later operation to recover", async () => {
    const saved = storage();
    const original = saved.save;
    saved.save = async () => {
      throw new Error("Storage unavailable");
    };
    const counter = new PopupCounter(saved);
    await expect(counter.record("page")).rejects.toThrow("Storage unavailable");
    saved.save = original;
    expect(await counter.record("page")).toEqual({ page: 1, total: 1 });
  });
});
