// View-model for the remade Dictionary (Part B). Pure + framework-free so it
// unit-tests with `bun test`. Groups the lexicon by ROLE (token class) in
// spoken-anatomy order, and filters the Product role by market (asset class).

// Relative import (not the @ alias) so `bun test` resolves it.
import productSpecs from "../../../data/product-specs.json";

export type TokenClass =
  | "product"
  | "tenor"
  | "strategy"
  | "side"
  | "qualifier"
  | "venue";

export interface LexiconEntry {
  id: string;
  term: string;
  aliases: string[];
  expansion: string;
  token_class: TokenClass;
  notes?: string;
}

// Roles in spoken-anatomy order (Product → Month → Strategy → Side → Venue →
// Qualifier), with trader-facing labels. Numbers (strikes/premium) are NOT
// lexicon roles — they're the engine-locked slots, rendered only in the anatomy
// strip, never here.
export const ROLE_ORDER: { key: TokenClass; label: string }[] = [
  { key: "product", label: "Product" },
  { key: "tenor", label: "Month / Tenor" },
  { key: "strategy", label: "Strategy" },
  { key: "side", label: "Side" },
  { key: "venue", label: "Venue" },
  { key: "qualifier", label: "Qualifier" },
];

export type Market = "all" | "ng" | "oil" | "btc";

const PRODUCT_TO_ASSET: Record<string, string> =
  (productSpecs as { product_to_asset_class?: Record<string, string> })
    .product_to_asset_class ?? {};

// asset_class for a product entry; keys in product_to_asset_class are lowercased
// product ids/terms. null if unmapped.
export function assetClassOf(entry: LexiconEntry): string | null {
  return (
    PRODUCT_TO_ASSET[entry.id?.toLowerCase()] ??
    PRODUCT_TO_ASSET[entry.term?.toLowerCase()] ??
    null
  );
}

export interface RoleSection {
  key: TokenClass;
  label: string;
  count: number;
  entries: LexiconEntry[];
}

// Build the role sections. `market` filters ONLY the Product section (other
// roles are market-agnostic). "btc" yields an empty Product section
// (illustrative — no Bitcoin vocabulary yet). assetClass is injectable for tests.
export function rolesView(
  displayed: LexiconEntry[],
  market: Market,
  assetClass: (e: LexiconEntry) => string | null = assetClassOf,
): RoleSection[] {
  return ROLE_ORDER.map(({ key, label }) => {
    let entries = displayed.filter((e) => e.token_class === key);
    if (key === "product" && market !== "all") {
      entries =
        market === "btc"
          ? []
          : entries.filter((e) => assetClass(e) === market);
    }
    entries = [...entries].sort((a, b) => a.expansion.localeCompare(b.expansion));
    return { key, label, count: entries.length, entries };
  });
}
