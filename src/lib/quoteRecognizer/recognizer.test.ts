// FlowTrade 2C — recognizer fixtures, RE-GROUNDED to validated ICE Chat formats.
//
// Every expected `raw` string below is a form confirmed recognized (blue) in
// live ICE Chat — see the vault docs `ice-chat-recognition-validation.md` and
// `market-string-reference-ng-wti.md`. Green here means "produces text we
// watched go blue", not just internal consistency. Run: `bun test`.
//
// Inputs mimic lightly-normalized speech-to-text (digit runs, dropped
// decimals, glued tokens) so the tests exercise the decimal re-derivation.
//
// Key format rules encoded (from validation, 2026-06-04 → 06-10):
//  - recognition is in-place: accepted input format IS the recognized form
//  - no venue tag and no "basis"/"spread" keyword in the recognized string
//  - NG basis / locational spread: slash bid/offer, leading-zero decimals
//  - WTI: product token kept, 2-digit year REQUIRED, strikes CARRY decimals
//  - trailing "out" excluded from the recognized string
//  - "trades" etc. = trade print (renders red in ICE Chat, kept in raw)

import { test, expect } from "bun:test";
import { recognize } from "./recognizer";

// ---- the six demo cells -----------------------------------------------------

test("cell 1 — NG options (hero), bare premium re-derived", () => {
  const r = recognize("K 3.25/4 cs x2.95 61/64");
  expect(r).not.toBeNull();
  expect(r!.shape).toBe("options");
  expect(r!.raw).toBe("K 3.25/4 cs x2.95 .061/.064");
  expect(r!.expanded).toBe(
    "May Henry Hub $3.25/$4.00 call spread — ref $2.95 — 6.1¢ bid / 6.4¢ offer",
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

test("cell 3 — NG basis: slash form, NO 'basis' word, NO venue in raw", () => {
  // trader SAYS "basis" (and maybe a venue) — neither appears in the pasted string
  const r = recognize("HSC K basis -.045/-.04 ice");
  expect(r!.shape).toBe("basis");
  expect(r!.raw).toBe("HSC K -0.045/-0.04");
  expect(r!.expanded).toBe(
    "HSC May basis vs Henry Hub — −4.5¢ bid / −4¢ offer — ICE",
  );
  expect(r!.needsConfirm).toEqual(["basis"]);
});

test("cell 4 — locational spread: hub1/hub2, NO 'spread' word in raw", () => {
  const r = recognize("waha/henry K spread -.05/-.04");
  expect(r!.shape).toBe("spread");
  expect(r!.raw).toBe("waha/hh K -0.05/-0.04");
  expect(r!.expanded).toBe(
    "Waha vs Henry Hub May locational spread (primary leg Waha) — −5¢ / −4¢",
  );
  expect(r!.needsConfirm).toEqual(["spread"]);
});

test("cell 5 — WTI options: product token kept, year kept, strikes carry decimals", () => {
  const r = recognize("wti z25 6250/7000 cs x64.50 1.20/1.30");
  expect(r!.shape).toBe("options");
  expect(r!.raw).toBe("WTI Z25 62.50/70.00 cs x64.50 1.20/1.30");
  expect(r!.expanded).toBe(
    "December 2025 WTI $62.50/$70.00 call spread — ref $64.50 — $1.20 bid / $1.30 offer",
  );
  expect(r!.needsConfirm).toEqual(["strikes"]);
});

test("cell 6 — WTI outright future: product + month+year kept", () => {
  const r = recognize("wti z25 57.33/57.35");
  expect(r!.shape).toBe("future");
  expect(r!.raw).toBe("WTI Z25 57.33/57.35");
  expect(r!.expanded).toBe(
    "December 2025 WTI future — $57.33 bid / $57.35 offer",
  );
  expect(r!.needsConfirm).toEqual([]);
});

// ---- crude tenor handling ---------------------------------------------------

test("crude year — month name + separate year token ('december 25')", () => {
  const r = recognize("wti december 25 57.33/57.35");
  expect(r!.raw).toBe("WTI Z25 57.33/57.35");
});

test("crude with NO year — tenor flagged amber, not invented", () => {
  const r = recognize("wti z 57.33/57.35");
  expect(r!.raw).toBe("WTI Z 57.33/57.35");
  expect(r!.needsConfirm).toContain("tenor");
});

test("WTI bare strikes expand to required decimals (60 -> 60.00)", () => {
  const r = recognize("wti z25 60/65 cs x62.50 1.20/1.30");
  expect(r!.raw).toBe("WTI Z25 60.00/65.00 cs x62.50 1.20/1.30");
  expect(r!.needsConfirm).toEqual(["strikes"]);
});

// ---- side / size / status (validated NG forms) -------------------------------

test("single-sided bid — '.061 bid', no slash pair", () => {
  const r = recognize("K 3.25/4 cs x2.95 .061 bid");
  expect(r!.raw).toBe("K 3.25/4 cs x2.95 .061 bid");
  expect(r!.expanded).toBe(
    "May Henry Hub $3.25/$4.00 call spread — ref $2.95 — 6.1¢ bid",
  );
  expect(r!.needsConfirm).toEqual([]);
});

test("trailing 'out' is excluded from the recognized string", () => {
  const r = recognize("U 3.50/4 cs x3.16 .098 offer out");
  expect(r!.raw).toBe("U 3.50/4 cs x3.16 .098 offer");
});

test("trade print — 'trades' kept in raw, marked as a print (renders red)", () => {
  // glued '3c' = strike 3 + single call, per the real ICE Chat sample
  const r = recognize("J 3c x2.95 trades .0465");
  expect(r!.raw).toBe("J 3c x2.95 trades .0465");
  expect(r!.expanded).toBe(
    "April Henry Hub $3.00 call — ref $2.95 — trades 4.65¢",
  );
  expect(r!.structured.status).toBe("trades");
});

test("live transcript — strikeless structure: soft hint, never invents", () => {
  // 'cost spread' resolves to cs but there are no strikes — must NOT
  // fabricate strikes or a WTI/HH locational spread (never-originate rule).
  // Instead: a hint explaining what's missing; transcript pastes unchanged.
  const r = recognize("December 25 WTI call spread 120 by 140");
  expect(r).not.toBeNull();
  expect("raw" in r!).toBe(false);
  expect((r as { hint: string }).hint).toContain("call spread");
  expect((r as { hint: string }).hint).toContain("strikes");
});

test("WTI with month+year spoken BEFORE the product ('December 25 WTI')", () => {
  const r = recognize("December 25 WTI 62 50 70 call spread x 64.50 120 130");
  expect(r!.raw).toBe("WTI Z25 62.50/70.00 cs x64.50 1.20/1.30");
  expect(r!.needsConfirm).toEqual(["strikes", "premium"]);
});

test("live transcript — 'at' as the spoken reference marker", () => {
  // Apurva spoke: "WTI December 25 62 50 70 call spread at 64 50 120 130"
  const r = recognize("WTI December 25 62 50 70 call spread at 64 50 120 130");
  expect(r!.raw).toBe("WTI Z25 62.50/70.00 cs x64.50 1.20/1.30");
  expect(r!.needsConfirm).toEqual(["strikes", "premium"]);
});

test("spoken future — 'at' splits the pair ('2.95 at 2.96')", () => {
  const r = recognize("May 2.95 at 2.96");
  expect(r!.raw).toBe("K 2.95/2.96");
  expect(r!.expanded).toBe("May Henry Hub future — $2.950 bid / $2.960 offer");
});

test("live transcript — glued month ('J3'), 'calls', leading-zero premium", () => {
  // Apurva spoke: "J 3 call at 2.95 trades .0465"
  const r = recognize("J3 calls at 295, trades 0465");
  expect(r).not.toBeNull();
  expect(r!.raw).toBe("J 3c x2.95 trades .0465");
  expect(r!.expanded).toBe(
    "April Henry Hub $3.00 call — ref $2.95 — trades 4.65¢",
  );
  expect(r!.needsConfirm).toEqual(["premium"]);
});

test("live transcript — spoken 'minus' keeps the basis sign", () => {
  // Apurva spoke: "HSC October basis minus 0.045 minus 0.04" — sign was
  // silently dropped live (wrong-sign quote pasted). Never again.
  const r = recognize("HSC October basis minus 0.045 minus 0.04");
  expect(r).not.toBeNull();
  expect((r as { raw: string }).raw).toBe("HSC V -0.045/-0.04");
});

test("live transcript — 'negative' + multi-word hub name", () => {
  const r = recognize(
    "houston ship channel october basis negative 0.045 negative 0.04",
  );
  expect((r as { raw: string }).raw).toBe("HSC V -0.045/-0.04");
});

test("live transcript — locational spread with spoken minus", () => {
  const r = recognize("Waha Henry October spread minus 0.05 minus 0.04");
  expect((r as { raw: string }).raw).toBe("waha/hh V -0.05/-0.04");
});

test("live ICE round 1 — NG future pastes derived decimals (295 -> 2.95)", () => {
  const r = recognize("May 295 at 296");
  expect((r as { raw: string }).raw).toBe("K 2.95/2.96");
  expect((r as { needsConfirm: string[] }).needsConfirm).toEqual(["price"]);
});

test("live ICE round 1 — WTI future pastes derived decimals (5733 -> 57.33)", () => {
  const r = recognize("WTI September 25 5733 at 5735");
  expect((r as { raw: string }).raw).toBe("WTI U25 57.33/57.35");
  expect((r as { needsConfirm: string[] }).needsConfirm).toEqual(["price"]);
});

test("live ICE round 1 — lost structure word: silent, no 4-leg 'future'", () => {
  // garbled straddle pasted 'K 350/345/180/190' live — never again
  expect(recognize("May 350 345 180 190")).toBeNull();
});

// ---- cross-cutting ------------------------------------------------------------

test("the gas-vs-oil contrast: same digit shape, 10x different meaning", () => {
  // 'sixty-one' in a gas premium = 6.1¢ ; 'sixty-two fifty' in an oil strike = $62.50
  const gas = recognize("K 3.25/4 cs x2.95 61/64");
  const oil = recognize("wti z25 6250/7000 cs x64.50 1.20/1.30");
  expect(gas!.expanded).toContain("6.1¢");
  expect(oil!.expanded).toContain("$62.50");
});

test("spoken venue is captured but NEVER pasted (not part of any recognized form)", () => {
  const r = recognize("K 3.25/4 cs x2.95 61/64 nymex only");
  expect(r!.raw).toBe("K 3.25/4 cs x2.95 .061/.064");
  expect(r!.expanded).toContain("NYMEX only");
  expect(r!.structured.venue).toBe("nymex");
});

// ---- live-dictation repair fixtures (real Whisper transcripts, 2026-06-11) ----

test("live transcript — commas, 'by' as ref marker, glued + paired numbers", () => {
  // Apurva spoke: "WTI Z25 62 50 70 call spread x 64.50 1.20 1.30"
  const r = recognize("WTI Z25, 62, 50, 70, call spread by 6450, 120, 130.");
  expect(r).not.toBeNull();
  expect(r!.raw).toBe("WTI Z25 62.50/70.00 cs x64.50 1.20/1.30");
  expect(r!.needsConfirm).toEqual(["strikes", "premium"]);
});

test("live transcript — clipped 'WTI' under the NG default: silent, not wrong", () => {
  // First word clipped by recording onset; oil-scale strikes can't be NG
  expect(
    recognize("Z25, 62, 50, 70, call spread, X, 64, 50, 120, 130"),
  ).toBeNull();
});

test("live transcript — clipped month: silent, no November hallucination", () => {
  // 'x' after the strategy is a ref marker, never the X month code
  expect(recognize("3.254 call spread x 295 6164")).toBeNull();
});

test("live transcript — hyphenated number runs ('325-4', '295-61-64')", () => {
  // Apurva spoke: "May 3.25 4 call spread x 2.95 61 64"
  const r = recognize("May, 325-4. Call spread by 295-61-64");
  expect(r).not.toBeNull();
  expect(r!.raw).toBe("K 3.25/4 cs x2.95 .061/.064");
  expect(r!.needsConfirm).toEqual(["strikes", "premium"]);
});

test("live transcript — spoken '4' arrives as the word 'for'", () => {
  // Apurva spoke: "May 3.25 4 call spread x 2.95 61 64"
  const r = recognize("May 325 for call spread by 295 61 64");
  expect(r).not.toBeNull();
  expect(r!.raw).toBe("K 3.25/4 cs x2.95 .061/.064");
  expect(r!.needsConfirm).toEqual(["strikes", "premium"]);
});

test("spoken NG quote — no slashes, commas, multi-word strategy, split x", () => {
  const r = recognize("May, 3.25, 4, call spread, x 2.95, 61, 64.");
  expect(r!.raw).toBe("K 3.25/4 cs x2.95 .061/.064");
  expect(r!.needsConfirm).toEqual(["premium"]);
});

test("spoken NG quote — glued premium pair splits (6164 -> .061/.064)", () => {
  const r = recognize("may 3.25 4 call spread x 2.95 6164");
  expect(r!.raw).toBe("K 3.25/4 cs x2.95 .061/.064");
  expect(r!.needsConfirm).toEqual(["premium"]);
});

test("no match — ordinary speech falls through", () => {
  expect(recognize("the weather is nice today")).toBeNull();
  expect(recognize("")).toBeNull();
});
