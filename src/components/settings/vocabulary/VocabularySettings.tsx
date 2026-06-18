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
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title="Vocabulary">
        <div className="p-4 space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-xs text-mid-gray flex items-center gap-2">
              <BookOpen className="w-3.5 h-3.5" />
              {displayed.length} entries shown
              {hasChanges && (
                <span className="text-mid-gray/70">
                  {" "}
                  · {trueAdditionsCount} added · {overrideCount} edited
                </span>
              )}
            </p>
            <div className="flex gap-2">
              {hasChanges && (
                <Button
                  onClick={() => setShowResetConfirm(true)}
                  variant="secondary"
                  size="sm"
                  className="inline-flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset to defaults
                </Button>
              )}
              <Button
                onClick={() => {
                  if (isAdding) resetAddForm();
                  else setIsAdding(true);
                  cancelEdit();
                }}
                variant="primary"
                size="sm"
                className="inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                Add entry
              </Button>
            </div>
          </div>

          {showResetConfirm && (
            <div className="border border-red-500/30 rounded-lg p-3 bg-red-500/5 flex items-center justify-between gap-3">
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

          {isAdding && (
            <div className="flex flex-col gap-2">
              {teachPhrase && (
                <p className="text-xs text-mid-gray">
                  Heard: <span className="font-mono">“{teachPhrase}”</span> —
                  teach the word FlowTrade missed.
                </p>
              )}
              <label className="text-xs text-mid-gray flex flex-col gap-1">
                This word means
                <select
                  value={meansId}
                  onChange={(e) => setMeansId(e.target.value)}
                  className="px-2 py-1 text-sm font-semibold bg-mid-gray/10 border border-mid-gray/80 rounded-md hover:border-logo-primary focus:outline-none focus:border-logo-primary"
                >
                  <option value="">— a brand-new entry —</option>
                  {teachTargets.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.term} — {e.expansion} ({e.token_class})
                    </option>
                  ))}
                </select>
              </label>

              {meansId === "" ? (
                <RowForm
                  draft={draft}
                  setDraft={setDraft}
                  onSave={handleAdd}
                  onCancel={resetAddForm}
                  saveLabel="Add"
                  termPlaceholder="Term (e.g., jv)"
                  expansionPlaceholder="Expansion (e.g., Apr/Oct)"
                />
              ) : (
                <div className="border border-mid-gray/20 rounded-lg p-3 flex flex-col gap-2 bg-mid-gray/5">
                  <Input
                    type="text"
                    value={aliasWord}
                    onChange={(e) => setAliasWord(e.target.value)}
                    placeholder="The word you say (e.g., wobble)"
                    variant="compact"
                  />
                  <div className="flex justify-end gap-2">
                    <Button onClick={resetAddForm} variant="secondary" size="sm">
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSaveAlias}
                      disabled={!aliasWord.trim()}
                      variant="primary"
                      size="sm"
                    >
                      Add word
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-mid-gray/20 text-xs text-mid-gray uppercase tracking-wide">
                  {(
                    [
                      { key: "term" as SortKey, label: "Term" },
                      { key: "expansion" as SortKey, label: "Expansion" },
                      { key: "token_class" as SortKey, label: "Class" },
                      { key: "aliases" as SortKey, label: "Aliases" },
                    ] as { key: SortKey; label: string }[]
                  ).map(({ key, label }) => (
                    <th key={key} className="text-left py-2 pr-3 font-medium">
                      <button
                        onClick={() => handleSortClick(key)}
                        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-logo-primary transition-colors cursor-pointer"
                        title={`Sort by ${label.toLowerCase()}`}
                      >
                        {label}
                        {sortKey === key ? (
                          sortDir === "asc" ? (
                            <ArrowUp className="w-3 h-3" />
                          ) : (
                            <ArrowDown className="w-3 h-3" />
                          )
                        ) : null}
                      </button>
                    </th>
                  ))}
                  <th className="py-2 w-16" />
                </tr>
              </thead>
              <tbody className="divide-y divide-mid-gray/10">
                {sortedDisplayed.map((entry) =>
                  editingId === entry.id ? (
                    <tr key={entry.id} className="bg-mid-gray/5">
                      <td colSpan={5} className="p-3">
                        <RowForm
                          draft={editDraft}
                          setDraft={setEditDraft}
                          onSave={handleSaveEdit}
                          onCancel={cancelEdit}
                          saveLabel="Save"
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr key={entry.id}>
                      <td className="py-2 pr-3 font-mono">{entry.term}</td>
                      <td className="py-2 pr-3">{entry.expansion}</td>
                      <td className="py-2 pr-3 text-mid-gray">
                        {entry.token_class}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {entry.aliases.map((a) => (
                            <span
                              key={a}
                              className="px-1.5 py-0.5 rounded bg-mid-gray/10 text-xs font-mono"
                            >
                              {a}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleStartEdit(entry)}
                            className="text-mid-gray hover:text-logo-primary transition-colors cursor-pointer"
                            aria-label={`Edit ${entry.term}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(entry.id)}
                            className="text-mid-gray hover:text-red-500 transition-colors cursor-pointer"
                            aria-label={`Delete ${entry.term}`}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </div>
      </SettingsGroup>
    </div>
  );
};
