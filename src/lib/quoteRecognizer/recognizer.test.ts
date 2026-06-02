// FlowTrade 2C — recognizer fixtures.
// One test per demo cell, plus no-match fall-through. Run: `bun test`.
//
// Inputs mimic lightly-normalized speech-to-text (digit runs, dropped decimals)
// so the tests exercise the decimal re-derivation, not just string matching.

import { test, expect } from "bun:test";
import { recognize } from "./recognizer";

test("cell 1 — NG options (hero), bare premium re-derived, NYMEX-only venue", () => {
  const r = recognize("K 3.25/4 cs x2.95 61/64 nymex only");
  expect(r).not.toBeNull();
  expect(r!.shape).toBe("options");
  expect(r!.raw).toBe("K 3.25/4 cs x2.95 .061/.064 NYMEX only");
  expect(r!.expanded).toBe(
    "May Henry Hub $3.25/$4.00 call spread — ref $2.95 — 6.1¢ bid / 6.4¢ offer — NYMEX only",
  );
  expect(r!.needsConfirm).toEqual(["premium"]);
});

test("cell 2 — NG outright future (3-decimal scale)", () => {
  const r = recognize("K 2.95/2.96");
  expect(r!.shape).toBe("future");
  expect(r!.raw).toBe("K 2.95/2.96");
  expect(r!.expanded).toBe("May Henry Hub future — $2.950 bid / $2.960 offer");
  expect(r!.needsConfirm).toEqual([]);
});

test("cell 3 — NG basis differential (signed, cents, ICE)", () => {
  const r = recognize("HSC K basis -.045/-.04 ice");
  expect(r!.shape).toBe("basis");
  expect(r!.raw).toBe("HSC K basis -.045/-.04 ICE");
  expect(r!.expanded).toBe(
    "HSC May basis vs Henry Hub — −4.5¢ bid / −4¢ offer — ICE",
  );
  expect(r!.needsConfirm).toEqual(["basis"]);
});

test("cell 4 — NG basis locational spread (two hubs)", () => {
  const r = recognize("waha/henry K spread -.95/-.90");
  expect(r!.shape).toBe("spread");
  expect(r!.raw).toBe("waha/hh K spread -.95/-.90");
  expect(r!.expanded).toBe(
    "Waha vs Henry Hub May locational spread (primary leg Waha) — −95¢ / −90¢",
  );
  expect(r!.needsConfirm).toEqual(["spread"]);
});

test("cell 5 — WTI options (no-decimal strikes -> dollars; gas-vs-oil aha)", () => {
  const r = recognize("wti Z 6250/7000 cs x64.50 1.10/1.15");
  expect(r!.shape).toBe("options");
  expect(r!.raw).toBe("Z 6250/7000 cs x64.50 1.10/1.15");
  expect(r!.expanded).toBe(
    "December WTI $62.50/$70.00 call spread — ref $64.50 — $1.10 bid / $1.15 offer",
  );
  expect(r!.needsConfirm).toEqual(["strikes"]);
});

test("cell 6 — WTI outright future", () => {
  const r = recognize("wti Z 64.50/64.55");
  expect(r!.shape).toBe("future");
  expect(r!.raw).toBe("Z 64.50/64.55");
  expect(r!.expanded).toBe("December WTI future — $64.50 bid / $64.55 offer");
  expect(r!.needsConfirm).toEqual([]);
});

test("the gas-vs-oil contrast: same digit shape, 10x different meaning", () => {
  // 'sixty-one' in a gas premium = 6.1¢ ; 'sixty-two fifty' in an oil strike = $62.50
  const gas = recognize("K 3.25/4 cs x2.95 61/64");
  const oil = recognize("wti Z 6250/7000 cs x64.50 1.10/1.15");
  expect(gas!.expanded).toContain("6.1¢");
  expect(oil!.expanded).toContain("$62.50");
});

test("no match — ordinary speech falls through", () => {
  expect(recognize("the weather is nice today")).toBeNull();
  expect(recognize("")).toBeNull();
});
