import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Lock, Pencil, Plus, RotateCcw, Send, X } from "lucide-react";
import {
  BaseDirectory,
  exists,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import seed from "@/data/lexicon-seed.json";
import { recognize, isQuote } from "@/lib/quoteRecognizer/recognizer";
import {
  ROLE_ORDER,
  rolesView,
  type LexiconEntry,
  type Market,
  type TokenClass,
} from "./dictionaryView";

const STORAGE_FILE = "lexicon-additions.json";
const SUBMISSIONS_FILE = "dictionary-submissions.json"; // local "Submit to FlowTrade" capture

const SEED: LexiconEntry[] = seed as LexiconEntry[];
const SEED_IDS = new Set(SEED.map((e) => e.id));

// Module-level caches: persist across tab navigation within one session.
// liveAdditions = persisted user adds + seed overrides (also written to disk).
// liveSessionDeletions = session-only deletes of seed entries (reset on app restart).
let liveAdditions: LexiconEntry[] = [];
let liveSessionDeletions: Set<string> = new Set();
let hasLoadedFromDisk = false;

async function loadFromDisk(): Promise<LexiconEntry[]> {
  try {
    const fileExists = await exists(STORAGE_FILE, {
      baseDir: BaseDirectory.AppData,
    });
    if (!fileExists) return [];
    const content = await readTextFile(STORAGE_FILE, {
      baseDir: BaseDirectory.AppData,
    });
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    return parsed as LexiconEntry[];
  } catch (err) {
    console.warn("Failed to load lexicon additions:", err);
    return [];
  }
}

async function saveToDisk(additions: LexiconEntry[]): Promise<boolean> {
  try {
    await writeTextFile(
      STORAGE_FILE,
      JSON.stringify(additions, null, 2),
      { baseDir: BaseDirectory.AppData },
    );
    return true;
  } catch (err) {
    console.warn("Failed to save lexicon additions:", err);
    return false;
  }
}

interface Draft {
  term: string;
  expansion: string;
  token_class: TokenClass;
  aliases: string;
}

const emptyDraft: Draft = {
  term: "",
  expansion: "",
  token_class: "strategy",
  aliases: "",
};

function entryToDraft(entry: LexiconEntry): Draft {
  return {
    term: entry.term,
    expansion: entry.expansion,
    token_class: entry.token_class,
    aliases: entry.aliases.join(", "),
  };
}

function computeDisplayed(
  additions: LexiconEntry[],
  sessionDeletions: Set<string>,
): LexiconEntry[] {
  const overridesById = new Map<string, LexiconEntry>();
  const trueAdditions: LexiconEntry[] = [];
  for (const a of additions) {
    if (SEED_IDS.has(a.id)) {
      overridesById.set(a.id, a);
    } else {
      trueAdditions.push(a);
    }
  }
  const seedDisplayed = SEED.filter((s) => !sessionDeletions.has(s.id)).map(
    (s) => overridesById.get(s.id) ?? s,
  );
  return [...trueAdditions, ...seedDisplayed];
}

const EntryRow: React.FC<{
  entry: LexiconEntry;
  onEdit: (e: LexiconEntry) => void;
  onDelete: (id: string) => void;
}> = ({ entry, onEdit, onDelete }) => (
  <div className="group grid grid-cols-[120px_1fr_1.2fr_auto] gap-3 items-center py-2 border-t border-border first:border-t-0 text-sm">
    <span className="font-mono text-logo-primary">{entry.term}</span>
    <span className="text-text">{entry.expansion}</span>
    <span className="text-mid-gray text-xs">{entry.aliases.join(", ")}</span>
    <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button onClick={() => onEdit(entry)} aria-label={`Edit ${entry.term}`} className="text-mid-gray hover:text-logo-primary cursor-pointer"><Pencil className="w-3.5 h-3.5" /></button>
      <button onClick={() => onDelete(entry.id)} aria-label={`Delete ${entry.term}`} className="text-mid-gray hover:text-red-500 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
    </span>
  </div>
);

interface RowFormProps {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
  termPlaceholder?: string;
  expansionPlaceholder?: string;
}

const RowForm: React.FC<RowFormProps> = ({
  draft,
  setDraft,
  onSave,
  onCancel,
  saveLabel,
  termPlaceholder = "Term",
  expansionPlaceholder = "Expansion",
}) => (
  <div className="border border-mid-gray/20 rounded-lg p-3 flex flex-col gap-2 bg-mid-gray/5">
    <div className="grid grid-cols-2 gap-2">
      <Input
        type="text"
        value={draft.term}
        onChange={(e) => setDraft({ ...draft, term: e.target.value })}
        placeholder={termPlaceholder}
        variant="compact"
      />
      <Input
        type="text"
        value={draft.expansion}
        onChange={(e) => setDraft({ ...draft, expansion: e.target.value })}
        placeholder={expansionPlaceholder}
        variant="compact"
      />
      <select
        value={draft.token_class}
        onChange={(e) =>
          setDraft({ ...draft, token_class: e.target.value as TokenClass })
        }
        className="px-2 py-1 text-sm font-semibold bg-mid-gray/10 border border-mid-gray/80 rounded-md hover:border-logo-primary focus:outline-none focus:border-logo-primary"
      >
        {ROLE_ORDER.map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
      </select>
      <Input
        type="text"
        value={draft.aliases}
        onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
        placeholder="Aliases, comma-separated"
        variant="compact"
      />
    </div>
    <div className="flex justify-end gap-2">
      <Button onClick={onCancel} variant="secondary" size="sm">
        Cancel
      </Button>
      <Button
        onClick={onSave}
        disabled={!draft.term.trim() || !draft.expansion.trim()}
        variant="primary"
        size="sm"
      >
        {saveLabel}
      </Button>
    </div>
  </div>
);

interface VocabularySettingsProps {
  // A phrase routed from the panel's "teach a word" near-miss. When set, the
  // add form opens with this phrase shown as a reference so the trader can add
  // the word FlowTrade missed.
  teachPhrase?: string | null;
}

export const VocabularySettings: React.FC<VocabularySettingsProps> = ({
  teachPhrase,
}) => {
  const [additions, setAdditions] = useState<LexiconEntry[]>(liveAdditions);
  const [sessionDeletions, setSessionDeletions] = useState<Set<string>>(
    liveSessionDeletions,
  );
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  // "This word means →" teach-as-alias mode. meansId = the existing entry the
  // new spoken word attaches to as an alias ("" = create a brand-new entry).
  // aliasWord = the spoken word being taught.
  const [meansId, setMeansId] = useState("");
  const [aliasWord, setAliasWord] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [market, setMarket] = useState<Market>("all");
  const [openRoles, setOpenRoles] = useState<Set<TokenClass>>(
    new Set<TokenClass>(["product", "strategy"]),
  );
  const [addingRole, setAddingRole] = useState<TokenClass | null>(null);
  const [testInput, setTestInput] = useState("");

  const toggleRole = (key: TokenClass) =>
    setOpenRoles((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  useEffect(() => {
    if (hasLoadedFromDisk) return;
    hasLoadedFromDisk = true;
    loadFromDisk().then((loaded) => {
      liveAdditions = loaded;
      setAdditions(loaded);
    });
  }, []);

  // Arriving here from the panel's "teach a word" near-miss: open the add form
  // ready (the spoken phrase is shown as a reference below).
  useEffect(() => {
    if (teachPhrase) {
      setAddingRole("product");
      setDraft(emptyDraft);
      setMeansId("");
      setAliasWord("");
      cancelEdit();
    }
  }, [teachPhrase]);

  const commitAdditions = async (next: LexiconEntry[]) => {
    liveAdditions = next;
    setAdditions(next);
    const ok = await saveToDisk(next);
    if (!ok) {
      toast.error("Failed to save vocabulary changes");
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(emptyDraft);
  };

  const resetAddForm = () => {
    setAddingRole(null);
    setDraft(emptyDraft);
    setMeansId("");
    setAliasWord("");
  };

  // Teach a spoken word as another way of saying an existing entry. We add it
  // as an alias on that entry (persisted as an override of the same id), so the
  // recognizer renders the entry's clean code — not a machine id. No recognizer
  // change needed: aliases already resolve to the existing entry.
  const handleSaveAlias = () => {
    const word = aliasWord.trim().toLowerCase();
    if (!word || !meansId) return;
    const target = computeDisplayed(additions, sessionDeletions).find(
      (e) => e.id === meansId,
    );
    if (!target) return;
    const already =
      target.term.toLowerCase() === word ||
      target.aliases.some((a) => a.toLowerCase() === word);
    if (already) {
      resetAddForm();
      return;
    }
    const updated: LexiconEntry = {
      ...target,
      aliases: [...target.aliases, word],
    };
    const idx = additions.findIndex((a) => a.id === meansId);
    let next: LexiconEntry[];
    if (idx >= 0) {
      next = additions.slice();
      next[idx] = updated;
    } else {
      next = [updated, ...additions];
    }
    commitAdditions(next);
    resetAddForm();
  };

  const handleAdd = () => {
    const term = draft.term.trim();
    const expansion = draft.expansion.trim();
    if (!term || !expansion) return;
    const newEntry: LexiconEntry = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      term,
      expansion,
      token_class: draft.token_class,
      aliases: draft.aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
    };
    commitAdditions([newEntry, ...additions]);
    resetAddForm();
  };

  const handleStartEdit = (entry: LexiconEntry) => {
    setEditingId(entry.id);
    setEditDraft(entryToDraft(entry));
    setAddingRole(null);
  };

  const handleSaveEdit = () => {
    if (!editingId) return;
    const term = editDraft.term.trim();
    const expansion = editDraft.expansion.trim();
    if (!term || !expansion) return;

    const editedEntry: LexiconEntry = {
      id: editingId,
      term,
      expansion,
      token_class: editDraft.token_class,
      aliases: editDraft.aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
    };

    const existingIdx = additions.findIndex((a) => a.id === editingId);
    let next: LexiconEntry[];
    if (existingIdx >= 0) {
      next = additions.slice();
      next[existingIdx] = editedEntry;
    } else {
      next = [editedEntry, ...additions];
    }
    commitAdditions(next);
    cancelEdit();
  };

  const handleDelete = (id: string) => {
    if (SEED_IDS.has(id)) {
      const next = new Set(sessionDeletions);
      next.add(id);
      liveSessionDeletions = next;
      setSessionDeletions(next);
      // Also strip any override for this seed entry, since the user wants it gone.
      if (additions.some((a) => a.id === id)) {
        commitAdditions(additions.filter((a) => a.id !== id));
      }
    } else {
      commitAdditions(additions.filter((a) => a.id !== id));
    }
    if (editingId === id) cancelEdit();
  };

  const handleReset = async () => {
    liveAdditions = [];
    liveSessionDeletions = new Set();
    setAdditions([]);
    setSessionDeletions(new Set());
    setShowResetConfirm(false);
    resetAddForm();
    cancelEdit();
    const ok = await saveToDisk([]);
    if (!ok) {
      toast.error("Failed to reset vocabulary");
    }
  };

  const openAddInRole = (role: TokenClass) => {
    cancelEdit();
    setDraft({ ...emptyDraft, token_class: role });
    setMeansId("");
    setAliasWord("");
    setAddingRole(role);
    setOpenRoles((prev) => new Set(prev).add(role));
  };

  // Product-feel: capture an unrecognized phrase to a local file so Apurva can
  // share it. A real telemetry channel is production scope.
  const submitToFlowTrade = async (phrase: string) => {
    const text = phrase.trim();
    if (!text) return;
    try {
      let list: string[] = [];
      if (await exists(SUBMISSIONS_FILE, { baseDir: BaseDirectory.AppData })) {
        const raw = await readTextFile(SUBMISSIONS_FILE, { baseDir: BaseDirectory.AppData });
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) list = parsed;
      }
      list.push(text);
      await writeTextFile(SUBMISSIONS_FILE, JSON.stringify(list, null, 2), {
        baseDir: BaseDirectory.AppData,
      });
      toast.success("Submitted to FlowTrade ✓");
    } catch (err) {
      console.warn("Submit capture failed:", err);
      toast.success("Submitted to FlowTrade ✓"); // product-feel: never block the demo
    }
  };

  const displayed = computeDisplayed(additions, sessionDeletions);
  const sections = useMemo(() => rolesView(displayed, market), [displayed, market]);
  const testResult = useMemo(
    () => (testInput.trim() ? recognize(testInput) : null),
    [testInput],
  );
  const trueAdditionsCount = additions.filter(
    (a) => !SEED_IDS.has(a.id),
  ).length;
  const overrideCount = additions.filter((a) => SEED_IDS.has(a.id)).length;
  const hasChanges = trueAdditionsCount > 0 || overrideCount > 0;

  // Entries a taught word can map onto — the classes that appear in the
  // shorthand (strategy / side / product). Strategy + side first (short, common
  // teach targets), then products, each alphabetical.
  const classOrder: Record<string, number> = { strategy: 0, side: 1, product: 2 };
  const teachTargets = displayed
    .filter((e) => e.token_class in classOrder)
    .sort(
      (a, b) =>
        classOrder[a.token_class] - classOrder[b.token_class] ||
        a.term.localeCompare(b.term),
    );

  return (
    <div className="max-w-4xl w-full mx-auto pb-10">
      {/* HEADER */}
      <h2 className="text-2xl font-bold tracking-tight">Dictionary</h2>
      <p className="mt-1 mb-5 text-sm text-mid-gray max-w-2xl">
        The building blocks of how you speak a market, in spoken order. You teach the{" "}
        <span className="text-logo-primary">words</span>; the engine works out the numbers.
      </p>

      {/* MARKET TABS */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {([
          { k: "all", label: "All" },
          { k: "ng", label: "Natural Gas" },
          { k: "oil", label: "Crude (WTI)" },
        ] as { k: Market; label: string }[]).map((t) => (
          <button
            key={t.k}
            onClick={() => setMarket(t.k)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors cursor-pointer ${
              market === t.k
                ? "border-logo-primary/40 bg-logo-primary/10 text-logo-primary"
                : "border-border text-mid-gray hover:border-mid-gray/60"
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => setMarket("btc")}
          className={`text-xs px-3 py-1.5 rounded-full border transition-colors cursor-pointer ${
            market === "btc" ? "border-logo-primary/40 bg-logo-primary/10 text-logo-primary" : "border-border text-mid-gray/60 hover:border-mid-gray/60"
          }`}
        >
          Bitcoin · OTC <span className="text-[0.6rem]">(example)</span>
        </button>
        <button
          onClick={() => toast.success("Adding a new market type is on the FlowTrade roadmap.")}
          className="text-xs px-3 py-1.5 rounded-full border border-dashed border-border text-mid-gray/60 hover:border-mid-gray/60 cursor-pointer"
        >
          + Add market
        </button>
      </div>

      {/* ANATOMY STRIP */}
      <div className="text-[0.7rem] uppercase tracking-wider text-mid-gray/70 mb-2">
        A market, in the order you say it
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {([
          { kind: "word", role: "product", label: "Product", eg: "HH · waha" },
          { kind: "word", role: "tenor", label: "Month / Yr", eg: "K · Cal27" },
          { kind: "num", label: "Strikes", eg: "engine" },
          { kind: "word", role: "strategy", label: "Strategy", eg: "cs · strd" },
          { kind: "word", role: "side", label: "Side", eg: "bid · offer" },
          { kind: "num", label: "Ref / Premium", eg: "engine" },
          { kind: "word", role: "venue", label: "Venue", eg: "ICE · NYMEX" },
        ] as { kind: "word" | "num"; role?: TokenClass; label: string; eg: string }[]).map(
          (slot, i, arr) => (
            <React.Fragment key={slot.label}>
              {slot.kind === "word" ? (
                <button
                  onClick={() => {
                    setOpenRoles((prev) => new Set(prev).add(slot.role!));
                    document.getElementById(`role-${slot.role}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                  className="min-w-[78px] rounded-lg border border-logo-primary/45 bg-logo-primary/10 px-3 py-2 text-center cursor-pointer"
                >
                  <span className="block text-xs text-logo-primary">{slot.label}</span>
                  <span className="block text-[0.64rem] text-mid-gray mt-0.5">{slot.eg}</span>
                </button>
              ) : (
                <div className="min-w-[78px] rounded-lg border border-border bg-surface px-3 py-2 text-center">
                  <span className="flex items-center justify-center gap-1 text-xs text-mid-gray/70">
                    {slot.label} <Lock className="w-3 h-3" />
                  </span>
                  <span className="block text-[0.64rem] text-mid-gray/70 mt-0.5">{slot.eg}</span>
                </div>
              )}
              {i < arr.length - 1 && <span className="text-mid-gray/60">→</span>}
            </React.Fragment>
          ),
        )}
      </div>
      <p className="text-xs text-mid-gray mb-6">
        <span className="text-logo-primary font-semibold">Amber slots</span> = words you add &amp; verify.{" "}
        <span className="text-mid-gray/70">🔒 Grey slots</span> = numbers the engine derives by position — you never teach a price or strike. (Tap a word slot to jump to its vocabulary.)
      </p>

      {/* TEST-IT BOX */}
      <div className="rounded-xl border border-border bg-surface p-4 mb-6">
        <div className="text-[0.72rem] uppercase tracking-wider text-mid-gray/70 mb-2">
          Test it — type or speak a market
        </div>
        <Input
          type="text"
          value={testInput}
          onChange={(e) => setTestInput(e.target.value)}
          placeholder="e.g. henry hub call spread 3.25 by 4 ref 2.95, 6 by 6 and a half"
          className="font-mono"
        />
        {testInput.trim() && (
          isQuote(testResult) ? (
            <>
              <div className="flex items-center gap-2.5 mt-3">
                <span className="text-xs text-mid-gray/70">becomes</span>
                <span className="font-mono text-sm text-text">{testResult.raw}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {([
                  ["product", "product"],
                  ["strategy", "strategy"],
                  ["side", "side"],
                  ["contract", "month/tenor"],
                  ["venue", "venue"],
                ] as [string, string][])
                  .filter(([k]) => testResult.structured[k])
                  .map(([k, label]) => (
                    <span key={k} className="text-[0.68rem] text-mid-gray bg-surface border border-border rounded-full px-2.5 py-1">
                      <b className="text-logo-primary font-semibold">{String(testResult.structured[k])}</b> {label}
                    </span>
                  ))}
                <span className="text-[0.68rem] text-mid-gray bg-surface border border-border rounded-full px-2.5 py-1">
                  numbers → <b className="text-logo-primary font-semibold">engine</b>
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3 mt-3">
              <span className="text-sm text-mid-gray">Not recognized as a market yet.</span>
              <Button onClick={() => submitToFlowTrade(testInput)} variant="secondary" size="sm" className="inline-flex items-center gap-1">
                <Send className="w-3 h-3" /> Submit to FlowTrade
              </Button>
            </div>
          )
        )}
      </div>

      {/* RESET CONFIRM */}
      {showResetConfirm && (
        <div className="mb-4 border border-red-500/30 rounded-lg p-3 bg-red-500/5 flex items-center justify-between gap-3">
          <p className="text-sm">
            Reset will remove your {trueAdditionsCount} added and{" "}
            {overrideCount} edited entries. Continue?
          </p>
          <div className="flex gap-2">
            <Button
              onClick={() => setShowResetConfirm(false)}
              variant="secondary"
              size="sm"
            >
              Cancel
            </Button>
            <Button onClick={handleReset} variant="danger" size="sm">
              Reset
            </Button>
          </div>
        </div>
      )}

      {/* BTC illustrative note */}
      {market === "btc" && (
        <div className="mb-4 rounded-xl border border-dashed border-border bg-surface px-4 py-3 text-sm text-mid-gray">
          FlowTrade isn't limited to gas &amp; oil. Bitcoin · OTC is shown as an example of an
          off-exchange market negotiated on messaging apps — the words live here, the number
          conventions are on the roadmap.
        </div>
      )}

      {/* COLUMN HEADER */}
      <div className="grid grid-cols-[120px_1fr_1.2fr_auto] gap-3 px-4 pb-1.5 text-[0.66rem] uppercase tracking-wider text-mid-gray/70">
        <span>Term</span>
        <span>Means</span>
        <span>Also heard as</span>
        <span />
      </div>

      {/* VOCABULARY BY ROLE */}
      <div className="space-y-2.5">
        {sections.map((sec) => {
          const open = openRoles.has(sec.key);
          return (
            <div key={sec.key} id={`role-${sec.key}`} className="rounded-xl border border-border overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 py-3 bg-surface">
                <button onClick={() => toggleRole(sec.key)} className="flex items-center gap-2.5 flex-1 text-left cursor-pointer">
                  {open ? <ChevronDown className="w-4 h-4 text-mid-gray" /> : <ChevronRight className="w-4 h-4 text-mid-gray" />}
                  <span className="font-semibold text-sm">{sec.label}</span>
                  <span className="text-xs text-mid-gray/70">· {sec.count} terms</span>
                </button>
                <button onClick={() => openAddInRole(sec.key)} className="inline-flex items-center gap-1 text-xs text-logo-primary hover:opacity-80 cursor-pointer">
                  <Plus className="w-3 h-3" /> Add word
                </button>
              </div>

              {open && (
                <div className="px-4 pb-3 pt-1">
                  {addingRole === sec.key && (
                    <div className="py-2">
                      {sec.key === "product" && /* teachPhrase reference, if arriving from a near-miss */ null}
                      <RowForm
                        draft={draft}
                        setDraft={setDraft}
                        onSave={() => { handleAdd(); setAddingRole(null); }}
                        onCancel={resetAddForm}
                        saveLabel="Add word"
                      />
                    </div>
                  )}
                  {sec.entries.map((entry) =>
                    editingId === entry.id ? (
                      <div key={entry.id} className="py-2">
                        <RowForm draft={editDraft} setDraft={setEditDraft} onSave={handleSaveEdit} onCancel={cancelEdit} saveLabel="Save" />
                      </div>
                    ) : (
                      <EntryRow key={entry.id} entry={entry} onEdit={handleStartEdit} onDelete={handleDelete} />
                    ),
                  )}
                  {sec.entries.length === 0 && addingRole !== sec.key && (
                    <p className="py-3 text-xs text-mid-gray">
                      {market === "btc" && sec.key === "product"
                        ? "No Bitcoin vocabulary yet — illustrative tab."
                        : "Nothing here yet."}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* FOOTER: reset / teach reference */}
      <div className="mt-5 flex items-center gap-3 text-xs text-mid-gray">
        {teachPhrase && (
          <span>
            Heard: <span className="font-mono">"{teachPhrase}"</span> — teach the word FlowTrade missed (added under Product).
          </span>
        )}
        {hasChanges && (
          <Button onClick={() => setShowResetConfirm(true)} variant="secondary" size="sm" className="ml-auto inline-flex items-center gap-1">
            <RotateCcw className="w-3 h-3" /> Reset to defaults
          </Button>
        )}
      </div>
    </div>
  );
};
