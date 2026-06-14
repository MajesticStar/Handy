import React, { useEffect, useState } from "react";
import { BookOpen, Pencil, Plus, RotateCcw, X } from "lucide-react";
import {
  BaseDirectory,
  exists,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import seed from "@/data/lexicon-seed.json";

type TokenClass =
  | "product"
  | "tenor"
  | "strategy"
  | "side"
  | "qualifier";

interface LexiconEntry {
  id: string;
  term: string;
  aliases: string[];
  expansion: string;
  token_class: TokenClass;
  notes?: string;
}

const TOKEN_CLASSES: TokenClass[] = [
  "product",
  "tenor",
  "strategy",
  "side",
  "qualifier",
];

const STORAGE_FILE = "lexicon-additions.json";

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
        {TOKEN_CLASSES.map((c) => (
          <option key={c} value={c}>
            {c}
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
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

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
      setIsAdding(true);
      setDraft(emptyDraft);
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
    setDraft(emptyDraft);
    setIsAdding(false);
  };

  const handleStartEdit = (entry: LexiconEntry) => {
    setEditingId(entry.id);
    setEditDraft(entryToDraft(entry));
    setIsAdding(false);
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
    setIsAdding(false);
    cancelEdit();
    const ok = await saveToDisk([]);
    if (!ok) {
      toast.error("Failed to reset vocabulary");
    }
  };

  const displayed = computeDisplayed(additions, sessionDeletions);
  const trueAdditionsCount = additions.filter(
    (a) => !SEED_IDS.has(a.id),
  ).length;
  const overrideCount = additions.filter((a) => SEED_IDS.has(a.id)).length;
  const hasChanges = trueAdditionsCount > 0 || overrideCount > 0;

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
                  setIsAdding((v) => !v);
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

          {isAdding && teachPhrase && (
            <p className="text-xs text-mid-gray">
              Heard: <span className="font-mono">“{teachPhrase}”</span> — add the
              word FlowTrade missed.
            </p>
          )}

          {isAdding && (
            <RowForm
              draft={draft}
              setDraft={setDraft}
              onSave={handleAdd}
              onCancel={() => {
                setIsAdding(false);
                setDraft(emptyDraft);
              }}
              saveLabel="Add"
              termPlaceholder="Term (e.g., jv)"
              expansionPlaceholder="Expansion (e.g., Apr/Oct)"
            />
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-mid-gray/20 text-xs text-mid-gray uppercase tracking-wide">
                  <th className="text-left py-2 pr-3 font-medium">Term</th>
                  <th className="text-left py-2 pr-3 font-medium">Expansion</th>
                  <th className="text-left py-2 pr-3 font-medium">Class</th>
                  <th className="text-left py-2 pr-3 font-medium">Aliases</th>
                  <th className="py-2 w-16" />
                </tr>
              </thead>
              <tbody className="divide-y divide-mid-gray/10">
                {displayed.map((entry) =>
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
