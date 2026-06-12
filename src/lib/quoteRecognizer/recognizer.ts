// FlowTrade 2C — quote recognizer (prototype, constrained).
//
// Turns a transcribed NatGas / WTI quote into (a) clean shorthand and
// (b) plain English. This is the "brain" behind the two-pane translator.
//
// It is NOT a production grammar. It recognizes the canonical ICE-Chat shapes
// for the six demo cells — NG options, NG outright future, NG basis
// differential, NG basis locational spread, WTI options, WTI outright future —
// plus an optional venue tag (NYMEX / ICE / Nodal). Anything it can't fit
// returns null and the caller falls through to normal paste.
//
// Locked design rule (see product-specs.json): never trust the speech-to-text
// decimals — re-derive them by position + asset class. The numeric scales live
// in product-specs.json; product -> asset_class lookup lives there too.
//
// Re-grounded 2026-06-11 to live-validated ICE Chat formats (vault docs:
// ice-chat-recognition-validation.md, market-string-reference-ng-wti.md):
// the pasted string carries no venue tag and no "basis"/"spread" keyword
// (those stay spoken cues only); WTI keeps the product token, requires a
// 2-digit year, and strikes CARRY decimals (62.50, not 6250); trailing
// "out" is excluded; trade prints ("trades") stay in the string.
//
// Live-dictation repair layer added 2026-06-11 from real Whisper transcripts:
// strip commas/periods, merge unslashed number runs and fit them to the
// structure's strike count by scale ("62 50 70" -> 62.50/70.00), accept a
// standalone "x"/"by" as the reference marker, split a glued premium pair
// ("6164" -> .061/.064), and apply the ICE-style default-product rule
// (no product spoken = the desk default, Henry Hub in the prototype).

import lexiconSeed from "../../data/lexicon-seed.json";
import productSpecs from "../../data/product-specs.json";

export type Shape = "options" | "future" | "basis" | "spread";

export interface RecognizedQuote {
  shape: Shape;
  raw: string; // clean shorthand — left pane / what gets pasted into chat
  expanded: string; // plain English — right pane
  needsConfirm: string[]; // structured fields to highlight amber
  structured: Record<string, unknown>;
}

// Soft landing for an almost-quote (e.g. a call spread with no strikes):
// nothing is pasted differently — the transcript goes through unchanged —
// but the panel explains why no market was produced.
export interface QuoteHint {
  hint: string;
}

export function isQuote(
  r: RecognizedQuote | QuoteHint | null,
): r is RecognizedQuote {
  return !!r && "raw" in r;
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

// Canonical CME/NYMEX month codes. Stable reference data, not speculative.
const MONTHS: Record<string, { code: string; name: string }> = {
  f: { code: "F", name: "January" },
  g: { code: "G", name: "February" },
  h: { code: "H", name: "March" },
  j: { code: "J", name: "April" },
  k: { code: "K", name: "May" },
  m: { code: "M", name: "June" },
  n: { code: "N", name: "July" },
  q: { code: "Q", name: "August" },
  u: { code: "U", name: "September" },
  v: { code: "V", name: "October" },
  x: { code: "X", name: "November" },
  z: { code: "Z", name: "December" },
};
const MONTH_NAMES: Record<string, string> = {
  jan: "f",
  january: "f",
  feb: "g",
  february: "g",
  mar: "h",
  march: "h",
  apr: "j",
  april: "j",
  may: "k",
  jun: "m",
  june: "m",
  jul: "n",
  july: "n",
  aug: "q",
  august: "q",
  sep: "u",
  sept: "u",
  september: "u",
  oct: "v",
  october: "v",
  nov: "x",
  november: "x",
  dec: "z",
  december: "z",
};

// Short, demo-clean display names (the lexicon expansions are deliberately
// verbose). Fall back to a trimmed expansion for anything not listed here.
const SHORT_NAME: Record<string, string> = {
  hh: "Henry Hub",
  hsc: "HSC",
  waha: "Waha",
  wti: "WTI",
};

type LexEntry = {
  id: string;
  term: string;
  aliases: string[];
  expansion: string;
  token_class: string;
  notes?: string;
};
const LEX = lexiconSeed as LexEntry[];

function buildMap(cls: string): Map<string, LexEntry> {
  const m = new Map<string, LexEntry>();
  for (const e of LEX) {
    if (e.token_class !== cls) continue;
    m.set(e.term.toLowerCase(), e);
    for (const a of e.aliases || []) m.set(a.toLowerCase(), e);
  }
  return m;
}
const PRODUCTS = buildMap("product");
const STRATEGIES = buildMap("strategy");
const VENUES = buildMap("venue");
const SIDES = buildMap("side");

const P2A = (productSpecs as any).product_to_asset_class as Record<
  string,
  string
>;

// Code-level keywords (not worth lexicon entries for the prototype).
const BASIS_WORDS = new Set(["basis", "swap", "swaps"]);
const SPREAD_WORDS = new Set(["spread", "spd"]);

// ---------------------------------------------------------------------------
// Number / decimal helpers
// ---------------------------------------------------------------------------

// Strip a value to a clean numeric string we can reason about: sign + digits + dot.
function clean(atom: string): string {
  return atom.replace(/[^0-9.\-]/g, "");
}

// Parse an atom into { sign, hasDot, digits, value? } without trusting decimals.
function num(atom: string) {
  const c = clean(atom);
  const sign = c.startsWith("-") ? -1 : 1;
  const body = c.replace(/^-/, "");
  return { sign, hasDot: body.includes("."), body, raw: c };
}

// Place a strike decimal by asset class. NG strikes are dollars.cents (X.YZ).
// Oil strikes CARRY the decimal in chat (62.50); a bare 1-2 digit token is
// whole dollars (60 -> 60.00) and a 3-4 digit run is spoken cents (6250 -> 62.50).
function strikeValue(atom: string, assetClass: string): number {
  const { sign, hasDot, body } = num(atom);
  if (hasDot) return sign * parseFloat(body);
  if (assetClass === "oil")
    return body.length >= 3
      ? (sign * parseInt(body, 10)) / 100 // 6250 -> 62.50
      : sign * parseInt(body, 10); // 60 -> 60.00
  // ng-style: decimal after the first digit (325 -> 3.25, 35 -> 3.5, 4 -> 4)
  if (body.length <= 1) return sign * parseInt(body, 10);
  return sign * parseFloat(body[0] + "." + body.slice(1));
}

// Place a premium decimal. NG premium low scale is 0.0XX (61 -> 0.061);
// oil premium is dollars (1.10 stays 1.10).
function premiumValue(atom: string, assetClass: string): number {
  const { sign, hasDot, body } = num(atom);
  if (hasDot) return sign * parseFloat(body);
  if (assetClass === "oil") return (sign * parseInt(body, 10)) / 100; // 120 -> 1.20
  // NG: a leading zero means the digits sit right after the dot
  // ("0465" -> 0.0465); otherwise low scale 0.0XX ("61" -> 0.061).
  if (body.startsWith("0"))
    return (sign * parseInt(body, 10)) / 10 ** body.length;
  return (sign * parseInt(body, 10)) / 1000; // 61 -> 0.061
}

// A futures / basis / spread price. Keep an explicit decimal; otherwise treat a
// bare basis integer as cents (45 -> 0.045) and an outright as ng-strike-style.
function priceValue(
  atom: string,
  assetClass: string,
  isDifferential: boolean,
): number {
  const { sign, hasDot, body } = num(atom);
  if (hasDot && isDifferential) {
    // a spoken "four and a half" style value ("4.5") is cents -> 0.045
    const v = parseFloat(body);
    return v >= 1 ? (sign * v) / 100 : sign * v;
  }
  if (hasDot) return sign * parseFloat(body);
  // basis cents are digit-count scaled: "45" = 4.5c -> 0.045, "4" = 4c -> 0.04
  if (isDifferential)
    return body.length === 1
      ? (sign * parseInt(body, 10)) / 100
      : (sign * parseInt(body, 10)) / 1000; cents
  if (assetClass === "oil") return (sign * parseInt(body, 10)) / 100;
  return body.length <= 1
    ? sign * parseInt(body, 10)
    : sign * parseFloat(body[0] + "." + body.slice(1));
}

// --- formatting ---
const MINUS = "−"; // proper minus sign for display
function fmtSign(v: number): string {
  return v < 0 ? MINUS : "";
}
function dollars(v: number, decimals: number): string {
  return `${fmtSign(v)}$${Math.abs(v).toFixed(decimals)}`;
}
function cents(v: number): string {
  // 0.061 -> "6.1¢", 0.045 -> "4.5¢", 0.04 -> "4¢", 0.95 -> "95¢"
  const c = Math.abs(v) * 100;
  const s = parseFloat(c.toFixed(2)).toString();
  return `${fmtSign(v)}${s}¢`;
}
// Raw-shorthand rendering of a gas premium: leading-dot, natural precision
// (.061, .0465).
function rawPremiumNG(v: number): string {
  return `${fmtSign(v)}${Math.abs(v).toString().replace(/^0/, "")}`;
}
// Raw rendering of a basis/spread differential: ASCII sign + leading zero
// (-0.045), the validated ICE Chat form.
function rawDiff(v: number): string {
  return `${v < 0 ? "-" : ""}${Math.abs(v)}`;
}

// How many strikes each structure expects (drives spoken-number pairing).
const STRIKE_COUNT: Record<string, number> = {
  c: 1,
  p: 1,
  straddle: 1,
  cs: 2,
  ps: 2,
  fence: 2,
  strangle: 2,
  call_tree: 3,
};

// Glue two adjacent spoken integers into one decimal ("62" + "50" -> "62.50").
function glueAtoms(a: string, b: string): string | null {
  if (num(a).hasDot || num(b).hasDot) return null;
  if (num(b).body.length !== 2) return null;
  return `${a}.${num(b).body}`;
}
function shortName(productId: string): string {
  if (SHORT_NAME[productId]) return SHORT_NAME[productId];
  const e = LEX.find((x) => x.id === productId);
  if (!e) return productId.toUpperCase();
  return e.expansion
    .split(/[—,(]/)[0]
    .replace(/natural gas$/i, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

function splitGroup(token: string): string[] {
  return token.split("/");
}
function looksNumeric(token: string): boolean {
  return /[0-9]/.test(token) && !MONTHS[token];
}

export function recognize(
  input: string,
): RecognizedQuote | QuoteHint | null {
  if (!input || !input.trim()) return null;
  // Whisper punctuates spoken lists ("62, 50, 70.") and hyphenates number
  // runs ("325-4", "295-61-64") — strip/split before parsing. A hyphen is
  // only a separator BETWEEN digits; a leading hyphen stays a minus sign.
  const tokens = input
    .trim()
    .toLowerCase()
    .replace(/[,;]/g, " ")
    .replace(/(?<=\d)-(?=\d)/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/[.,;:!?]+$/, ""))
    .filter(Boolean);
  // Whisper writes a spoken "4" as "for" mid-quote ("325 for call spread").
  // Convert only between a number and a non-number, so size forms like
  // "bid for 200" are untouched.
  for (let i = 1; i < tokens.length - 1; i++) {
    if (
      tokens[i] === "for" &&
      /\d/.test(tokens[i - 1]) &&
      !/^\d/.test(tokens[i + 1])
    ) {
      tokens[i] = "4";
    }
  }
  // Whisper writes small bare numbers as WORDS ("minus five") — convert
  // before sign folding (live find 2026-06-12: Waha/Henry never parsed).
  const NUMBER_WORDS: Record<string, string> = {
    zero: "0",
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
    ten: "10",
  };
  for (let i = 0; i < tokens.length; i++) {
    if (NUMBER_WORDS[tokens[i]]) tokens[i] = NUMBER_WORDS[tokens[i]];
  }
  // A spoken "minus"/"negative" arrives as a word — fold it into the next
  // number as a sign, or basis quotes silently lose their sign (live find
  // 2026-06-12: a negative basis pasted positive). Reverse order so removals
  // don't shift unprocessed indices.
  for (let i = tokens.length - 2; i >= 0; i--) {
    if (
      (tokens[i] === "minus" || tokens[i] === "negative") &&
      /^[\d.]/.test(tokens[i + 1])
    ) {
      tokens[i + 1] = "-" + tokens[i + 1];
      tokens.splice(i, 1);
    }
  }

  let monthKey: string | null = null;
  let year: string | null = null; // 2-digit contract year (crude requires it)
  let side: string | null = null; // bid | offer (single-sided quote)
  let status: string | null = null; // trades = a print, not a quote
  let strategy: LexEntry | null = null;
  let venue: LexEntry | null = null;
  let venueOnly = false;
  let basisFlag = false;
  let spreadFlag = false;
  const productIds: string[] = [];
  let refRaw: string | null = null;
  const numberGroups: { atoms: string[]; afterRef: boolean }[] = [];
  let seenRef = false;

  let prevNumeric = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const wasNumeric = prevNumeric;
    prevNumeric = false;
    // venue modifier
    if (t === "only") {
      venueOnly = true;
      continue;
    }
    if (t === "vs" || t === "ref") {
      seenRef = true;
      continue;
    }
    // "at" marks the reference only right after a structure ("call spread
    // at 64 50"); elsewhere it's the bid/offer word ("61 at 64") and the
    // number-group flattening handles it.
    if (t === "at" && strategy !== null && !seenRef) {
      seenRef = true;
      continue;
    }
    // standalone reference marker — "x 64.50" / "by 6450" (Whisper splits or
    // mishears the spoken "x"). Only once the quote body has started, so a
    // leading bare "x" can still be the November month code.
    if (
      (t === "x" || t === "by") &&
      (strategy !== null || numberGroups.length > 0)
    ) {
      seenRef = true;
      continue;
    }

    // reference marker: x2.95 / x64.50
    if (/^x[0-9.]/.test(t)) {
      refRaw = t.slice(1);
      seenRef = true;
      continue;
    }

    // month (single code letter or name) — only accept once, taken positionally
    if (monthKey === null && MONTHS[t]) {
      monthKey = t;
      continue;
    }
    if (monthKey === null && MONTH_NAMES[t]) {
      monthKey = MONTH_NAMES[t];
      continue;
    }
    // month glued to digits: a year ("z25", "dec25") or a strike/price
    // ("J3", "K325" — Whisper glues the month to the next number)
    if (monthKey === null) {
      const my = t.match(/^([a-z]+)(\d+)$/);
      if (my && (MONTHS[my[1]] || MONTH_NAMES[my[1]])) {
        monthKey = MONTHS[my[1]] ? my[1] : MONTH_NAMES[my[1]];
        if (/^(2[4-9]|3[0-9])$/.test(my[2])) {
          year = my[2];
        } else {
          numberGroups.push({ atoms: [my[2]], afterRef: seenRef });
          prevNumeric = true;
        }
        continue;
      }
    }
    // bare 2-digit year after the month ("december 25") — crude only.
    // The product may come before OR after the year ("December 25 WTI"),
    // so check the whole utterance, not just what's parsed so far.
    if (
      monthKey !== null &&
      year === null &&
      /^(2[4-9]|3[0-9])$/.test(t) && // plausible contract years only
      tokens.some((tok) => {
        const e = PRODUCTS.get(tok);
        return !!e && P2A[e.id] === "oil";
      })
    ) {
      year = t;
      continue;
    }

    // venue
    if (VENUES.has(t)) {
      venue = VENUES.get(t)!;
      continue;
    }

    // strategy — two-word spoken forms first ("call spread", "call tree")
    const two = i + 1 < tokens.length ? `${t} ${tokens[i + 1]}` : "";
    if (strategy === null && two && STRATEGIES.has(two)) {
      strategy = STRATEGIES.get(two)!;
      i++;
      continue;
    }
    if (STRATEGIES.has(t)) {
      strategy = STRATEGIES.get(t)!;
      continue;
    }

    // side / status words (bid, offer, trades + aliases); other side-class
    // tokens are consumed but unused in the prototype
    if (SIDES.has(t)) {
      const e = SIDES.get(t)!;
      if (e.id === "trades") status = "trades";
      else if (e.id === "bid" || e.id === "offer") side = e.id;
      continue;
    }

    // keywords
    if (BASIS_WORDS.has(t)) {
      basisFlag = true;
      continue;
    }
    if (SPREAD_WORDS.has(t)) {
      spreadFlag = true;
      continue;
    }

    // product spoken as a multi-word name ("houston ship channel",
    // "natural gas") — try the longest match first
    const threeP =
      i + 2 < tokens.length ? `${t} ${tokens[i + 1]} ${tokens[i + 2]}` : "";
    if (threeP && PRODUCTS.has(threeP)) {
      productIds.push(PRODUCTS.get(threeP)!.id);
      i += 2;
      continue;
    }
    const twoP = i + 1 < tokens.length ? `${t} ${tokens[i + 1]}` : "";
    if (twoP && PRODUCTS.has(twoP)) {
      productIds.push(PRODUCTS.get(twoP)!.id);
      i += 1;
      continue;
    }

    // product, possibly a '/'-group of hubs (locational spread legs)
    const parts = splitGroup(t);
    if (parts.length > 1 && parts.every((p) => PRODUCTS.has(p))) {
      for (const p of parts) productIds.push(PRODUCTS.get(p)!.id);
      continue;
    }
    if (PRODUCTS.has(t)) {
      productIds.push(PRODUCTS.get(t)!.id);
      continue;
    }

    // number(s) glued to a structure: 3c, 2.25/2.75ps (per the real sample)
    if (strategy === null) {
      const g = t.match(/^([0-9][0-9./]*)([a-z]+)$/);
      if (g && STRATEGIES.has(g[2])) {
        strategy = STRATEGIES.get(g[2])!;
        numberGroups.push({ atoms: splitGroup(g[1]), afterRef: seenRef });
        continue;
      }
    }

    // numbers — consecutive spoken numbers merge into one group ("62 50 70")
    if (looksNumeric(t)) {
      const last = numberGroups[numberGroups.length - 1];
      if (wasNumeric && last && last.afterRef === seenRef) {
        last.atoms.push(...splitGroup(t));
      } else {
        numberGroups.push({ atoms: splitGroup(t), afterRef: seenRef });
      }
      prevNumeric = true;
      continue;
    }
    // unknown token -> ignore (lenient)
  }

  // Need at least a month or a product to be a quote we understand.
  if (monthKey === null && productIds.length === 0) return null;
  if (numberGroups.length === 0 && refRaw === null) return null;

  // ICE-style default-product rule (Apurva, 2026-06-11): unless a product is
  // spoken, assume the desk's default. Hardcoded Henry Hub for the prototype;
  // becomes a per-user setting in production.
  const primaryProduct = productIds[0] ?? "hh";
  const assetClass = P2A[primaryProduct] ?? "ng";
  const isDifferential = assetClass === "ng_basis";

  // shape
  let shape: Shape;
  if (strategy) shape = "options";
  else if (spreadFlag) {
    // A locational spread needs BOTH hubs spoken — never invent a leg.
    // "spread" with no recognizable structure means we mis-heard: stay silent.
    if (productIds.length < 2) return null;
    shape = "spread";
  }
  else if (basisFlag || (isDifferential && numberGroups.length))
    shape = "basis";
  else shape = "future";

  const month = monthKey ? MONTHS[monthKey] : null;
  if (!month) return null; // every demo cell carries a month
  const tenor = month.code + (year ?? ""); // K (NG) / Z25 (crude)
  const monthEx = month.name + (year ? " 20" + year : "");

  // ----- slot the numbers and render -----
  if (shape === "options") {
    // Soft landing when the structure is clear but the strikes aren't —
    // a real desk habit ("call spread 120 by 140" = price update against
    // strikes from context). We never invent strikes; we explain instead.
    const incomplete = (): QuoteHint => ({
      hint:
        `Heard a ${monthEx} ${shortName(primaryProduct)} ` +
        `${strategy!.expansion} — but not its strikes. A complete market ` +
        `states the strikes; your words were pasted unchanged.`,
    });
    const strikeGroup = numberGroups.find((g) => !g.afterRef);
    if (!strikeGroup) return incomplete();

    // Fit the pre-ref numbers to the structure's strike count — spoken
    // numbers arrive unslashed ("62 50 70" -> 62.50/70.00 for a 2-strike cs).
    const strikeAtoms = [...strikeGroup.atoms];
    const need = STRIKE_COUNT[strategy!.id] ?? strikeAtoms.length;
    let strikesGlued = false;
    while (strikeAtoms.length > need) {
      let merged = false;
      for (let j = 0; j < strikeAtoms.length - 1; j++) {
        const g = glueAtoms(strikeAtoms[j], strikeAtoms[j + 1]);
        if (g) {
          strikeAtoms.splice(j, 2, g);
          strikesGlued = true;
          merged = true;
          break;
        }
      }
      if (!merged) return incomplete(); // numbers don't fit the structure
    }
    if (strikeAtoms.length < need) return incomplete();
    const strikes = strikeAtoms.map((a) => strikeValue(a, assetClass));

    // Silent-over-wrong: strikes that can't belong to this product mean a
    // mis-heard product (e.g. a clipped "WTI" under the NG default) — show
    // nothing rather than a confident wrong quote.
    if (assetClass !== "oil" && strikes.some((s) => Math.abs(s) > 50))
      return null;

    // Reference + premiums come from the post-ref numbers. The ref may
    // arrive as a glued token (x64.50), one atom ("6450") or two ("64, 50").
    const postRef = numberGroups
      .filter((g) => g.afterRef)
      .flatMap((g) => g.atoms);
    let refAtom = refRaw;
    let premAtoms = postRef;
    if (refAtom === null && seenRef && postRef.length > 0) {
      if (postRef.length === 4) {
        const g = glueAtoms(postRef[0], postRef[1]);
        refAtom = g ?? postRef[0];
        premAtoms = g ? postRef.slice(2) : postRef.slice(1);
      } else {
        refAtom = postRef[0];
        premAtoms = postRef.slice(1);
      }
    }
    // A lone bare 4-digit premium is a glued bid/offer pair ("6164" -> 61/64).
    const premTarget = side || status ? 1 : 2;
    if (
      premAtoms.length === 1 &&
      premTarget === 2 &&
      !num(premAtoms[0]).hasDot &&
      num(premAtoms[0]).body.length === 4
    ) {
      const b = num(premAtoms[0]).body;
      premAtoms = [b.slice(0, 2), b.slice(2)];
    }
    const prems = premAtoms.map((a) => premiumValue(a, assetClass));
    const premWasDerived = premAtoms.some((a) => !num(a).hasDot);
    const ref = refAtom ? strikeValue(refAtom, assetClass) : null;
    // Flag strikes amber only when a decimal was genuinely re-derived: any
    // bare oil strike (60 -> 60.00, 6250 -> 62.50) or a multi-digit bare NG
    // integer (325 -> 3.25). A transcription that carried the decimal is
    // trusted as-is.
    const strikesDerived =
      strikesGlued ||
      strikeAtoms.some((a) => {
        const n = num(a);
        return !n.hasDot && (assetClass === "oil" || n.body.length >= 3);
      });

    const isOil = assetClass === "oil";
    // Oil strikes must carry decimals in the pasted string (62.50, never
    // 6250); NG keeps the chat-native atoms as spoken.
    const rawStrikes = isOil
      ? strikes.map((s) => s.toFixed(2)).join("/")
      : strikeAtoms
          .map((a, j) => {
            const n = num(a);
            // echo as spoken unless the decimal was re-derived (325 -> 3.25)
            return !n.hasDot && n.body.length >= 3
              ? `${parseFloat(strikes[j].toFixed(3))}`
              : a;
          })
          .join("/");
    // Single-letter structures glue to the strike (J 3c); multi-letter are
    // spaced (3.25/4 cs) — matching the validated sample forms exactly.
    const strikeStrat =
      strategy!.id.length === 1
        ? `${rawStrikes}${strategy!.id}`
        : `${rawStrikes} ${strategy!.id}`;
    // A premium atom that carried its decimal is echoed (leading-dot form);
    // a bare one is re-derived per asset class.
    const rawPremAtom = (a: string, v: number) => {
      const n = num(a);
      if (n.hasDot) return n.raw.replace(/^(-?)0\./, "$1.");
      return isOil ? v.toFixed(2) : rawPremiumNG(v);
    };
    const rawPrem = premAtoms
      .map((a, j) => rawPremAtom(a, prems[j]))
      .join("/");
    const refDisplay =
      ref !== null
        ? isOil
          ? ref.toFixed(2)
          : `${parseFloat(ref.toFixed(3))}`
        : "";
    // Validated form carries no venue tag (kept in the expanded pane only).
    const raw = [
      isOil ? shortName(primaryProduct) : "",
      tenor,
      strikeStrat,
      refAtom ? `x${refDisplay}` : "",
      status === "trades" ? "trades" : "",
      rawPrem,
      side ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    const strikesEx = strikes.map((s) => dollars(s, 2)).join("/");
    const fmtPrem = (p: number) => (isOil ? dollars(p, 2) : cents(p));
    let premEx = "";
    if (prems.length) {
      if (status === "trades") premEx = `trades ${fmtPrem(prems[0])}`;
      else if (side) premEx = `${fmtPrem(prems[0])} ${side}`;
      else
        premEx = `${fmtPrem(prems[0])} bid / ${fmtPrem(prems[1] ?? prems[0])} offer`;
    }
    const refEx = ref !== null ? ` — ref ${dollars(ref, 2)}` : "";
    const venueEx = venue
      ? ` — ${venue.expansion.split(" ")[0]}${venueOnly ? " only" : ""}`
      : "";
    const expanded =
      `${monthEx} ${shortName(primaryProduct)} ${strikesEx} ${strategy!.expansion}` +
      refEx +
      (premEx ? ` — ${premEx}` : "") +
      venueEx;

    const needsConfirm: string[] = [];
    if (strikesDerived) needsConfirm.push("strikes");
    if (premWasDerived) needsConfirm.push("premium");
    if (isOil && !year) needsConfirm.push("tenor"); // crude requires a year

    return {
      shape,
      raw,
      expanded,
      needsConfirm,
      structured: {
        instrument: "option",
        contract: tenor,
        product: primaryProduct,
        assetClass,
        strategy: strategy!.id,
        strikes,
        ref,
        premium: prems,
        side,
        status,
        venue: venue?.id ?? null,
        venueOnly,
      },
    };
  }

  if (shape === "future") {
    // Flatten across groups — a spoken "at" splits the pair ("2.95 at 2.96").
    const atoms = numberGroups.flatMap((g) => g.atoms);
    if (!atoms.length) return null;
    // A future is one price or a bid/offer pair; more numbers means we
    // mis-heard a structure — silence over a fabricated multi-leg "future".
    if (atoms.length > 2) return null;
    const isOil = assetClass === "oil";
    const dec = isOil ? 2 : 3; // ng futures X.YYY ; oil XX.YY
    const prices = atoms.map((a) => priceValue(a, assetClass, false));
    // Paste derived decimals, not the spoken digits (295 -> 2.95,
    // 5733 -> 57.33); echo atoms that carried their own decimal.
    const priceDerived = atoms.some((a) => !num(a).hasDot);
    const rawPx = atoms
      .map((a, j) => {
        if (num(a).hasDot) return a;
        return isOil
          ? prices[j].toFixed(2)
          : `${parseFloat(prices[j].toFixed(3))}`;
      })
      .join("/");
    // Crude keeps the product token + month+year; NG is implied + bare month.
    const raw = isOil
      ? `${shortName(primaryProduct)} ${tenor} ${rawPx}`
      : `${tenor} ${rawPx}`;
    const pxEx =
      prices.length > 1
        ? `${dollars(prices[0], dec)} bid / ${dollars(prices[1], dec)} offer`
        : dollars(prices[0], dec);
    const expanded = `${monthEx} ${shortName(primaryProduct)} future — ${pxEx}`;
    const needsConfirm: string[] = [];
    if (priceDerived) needsConfirm.push("price");
    if (isOil && !year) needsConfirm.push("tenor");
    return {
      shape,
      raw,
      expanded,
      needsConfirm,
      structured: {
        instrument: "future",
        contract: tenor,
        product: primaryProduct,
        assetClass,
        prices,
        venue: venue?.id ?? null,
      },
    };
  }

  if (shape === "basis") {
    // Flatten — stray words must not split the bid/offer pair.
    const atoms = numberGroups.flatMap((g) => g.atoms);
    if (!atoms.length || atoms.length > 2) return null;
    const vals = atoms.map((a) => priceValue(a, assetClass, true));
    // Validated form: hub + month + slash bid/offer with leading-zero
    // decimals — NO "basis" keyword, NO venue tag (those stay spoken cues).
    const raw = `${shortName(primaryProduct).toUpperCase()} ${month.code} ${vals
      .map(rawDiff)
      .join("/")}`;
    const px =
      vals.length > 1
        ? `${cents(vals[0])} bid / ${cents(vals[1])} offer`
        : cents(vals[0]);
    const venueEx = venue ? ` — ${venue.expansion.split(" ")[0]}` : "";
    const expanded = `${shortName(primaryProduct)} ${month.name} basis vs Henry Hub — ${px}${venueEx}`;
    return {
      shape,
      raw,
      expanded,
      needsConfirm: ["basis"],
      structured: {
        instrument: "basis",
        contract: month.code,
        product: primaryProduct,
        assetClass,
        prices: vals,
        differential: true,
        venue: venue?.id ?? null,
      },
    };
  }

  // shape === "spread" (locational)
  const spreadAtoms = numberGroups.flatMap((g) => g.atoms);
  if (!spreadAtoms.length || spreadAtoms.length > 2) return null;
  const legA = productIds[0];
  const legB = productIds[1];
  const vals = spreadAtoms.map((a) =>
    priceValue(a, assetClass, isDifferential),
  );
  // Validated form: hub1/hub2 + month + slash values — NO "spread" keyword.
  const raw = `${legA}/${legB} ${month.code} ${vals.map(rawDiff).join("/")}`;
  const px =
    vals.length > 1 ? `${cents(vals[0])} / ${cents(vals[1])}` : cents(vals[0]);
  const expanded =
    `${shortName(legA)} vs ${shortName(legB)} ${month.name} locational spread ` +
    `(primary leg ${shortName(legA)}) — ${px}`;
  return {
    shape,
    raw,
    expanded,
    needsConfirm: ["spread"],
    structured: {
      instrument: "locational_spread",
      contract: month.code,
      legs: [legA, legB],
      assetClass,
      prices: vals,
      venue: venue?.id ?? null,
    },
  };
}
