import { test, expect } from "bun:test";
import { rolesView, ROLE_ORDER, type LexiconEntry } from "./dictionaryView";

const e = (
  id: string,
  token_class: LexiconEntry["token_class"],
  term: string,
  expansion: string,
): LexiconEntry => ({ id, term, expansion, token_class, aliases: [] });

// injected market map so the test never depends on product-specs.json
const fakeAsset = (x: LexiconEntry) =>
  ({ hh: "ng", waha: "ng", wti: "oil" } as Record<string, string>)[x.id] ?? null;

test("returns all six roles in anatomy order", () => {
  expect(rolesView([], "all").map((r) => r.label)).toEqual([
    "Product",
    "Month / Tenor",
    "Strategy",
    "Side",
    "Venue",
    "Qualifier",
  ]);
});

test("groups entries by role, sorted by expansion", () => {
  const data = [
    e("hh", "product", "HH", "Henry Hub"),
    e("waha", "product", "waha", "Waha"),
    e("cs", "strategy", "cs", "call spread"),
  ];
  const view = rolesView(data, "all");
  const product = view.find((r) => r.key === "product")!;
  expect(product.count).toBe(2);
  expect(product.entries.map((x) => x.expansion)).toEqual(["Henry Hub", "Waha"]);
});

test("market tab filters ONLY the product role by asset class", () => {
  const data = [
    e("hh", "product", "HH", "Henry Hub"),
    e("wti", "product", "WTI", "WTI"),
    e("cs", "strategy", "cs", "call spread"),
  ];
  const ng = rolesView(data, "ng", fakeAsset);
  expect(ng.find((r) => r.key === "product")!.entries.map((x) => x.id)).toEqual(["hh"]);
  // strategy unaffected by market
  expect(ng.find((r) => r.key === "strategy")!.count).toBe(1);
});

test("btc market yields an empty product role (illustrative)", () => {
  const data = [e("hh", "product", "HH", "Henry Hub")];
  expect(rolesView(data, "btc", fakeAsset).find((r) => r.key === "product")!.count).toBe(0);
});
