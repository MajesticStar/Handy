import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BaseDirectory, exists, readTextFile } from "@tauri-apps/plugin-fs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import React, { useEffect, useState } from "react";
import {
  recognize,
  setUserLexicon,
  isQuote,
} from "@/lib/quoteRecognizer/recognizer";
import "./RecentsPicker.css";

// Where the Vocabulary tab saves the trader's added/edited words.
const VOCAB_FILE = "lexicon-additions.json";

// Fold the trader's Vocabulary-tab words into the recognizer before
// re-deriving shorthands. Any failure falls back to seed list only;
// re-derivation must never throw.
async function applyUserLexicon() {
  try {
    const there = await exists(VOCAB_FILE, { baseDir: BaseDirectory.AppData });
    if (!there) {
      setUserLexicon([]);
      return;
    }
    const content = await readTextFile(VOCAB_FILE, {
      baseDir: BaseDirectory.AppData,
    });
    const parsed = JSON.parse(content);
    setUserLexicon(Array.isArray(parsed) ? parsed : []);
  } catch (err) {
    console.warn("Failed to load vocabulary additions:", err);
    setUserLexicon([]);
  }
}

// Fetch recent history, re-derive canonical shorthand for quote entries, and
// return the first 5 distinct shorthands. Re-derivation uses the same field
// priority and recognizer path as the translator panel, so a Recents copy ===
// what was originally pasted.
async function fetchRecentQuotes(): Promise<string[]> {
  type HistoryEntry = {
    transcription_text: string;
    post_processed_text?: string | null;
  };
  type PaginatedHistory = {
    entries: HistoryEntry[];
    has_more: boolean;
  };

  const result: PaginatedHistory = await invoke("get_history_entries", {
    cursor: null,
    limit: 20,
  });

  await applyUserLexicon();

  const seen = new Set<string>();
  const quotes: string[] = [];

  for (const entry of result.entries) {
    if (quotes.length >= 5) break;
    const text =
      entry.post_processed_text != null
        ? entry.post_processed_text
        : entry.transcription_text;
    const recognized = recognize(text);
    if (isQuote(recognized)) {
      const shorthand = recognized.raw;
      // Dedup: same shorthand dictated twice appears once (keep first).
      if (!seen.has(shorthand)) {
        seen.add(shorthand);
        quotes.push(shorthand);
      }
    }
  }

  return quotes;
}

const RecentsPicker: React.FC = () => {
  const [quotes, setQuotes] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const refresh = async () => {
    try {
      const q = await fetchRecentQuotes();
      setQuotes(q);
      setSelected(new Set());
    } catch (err) {
      console.warn("Recents: fetch failed:", err);
    }
  };

  useEffect(() => {
    refresh();
    const sub = listen("recents-refresh", () => {
      refresh();
    });
    return () => {
      sub.then((unlisten) => unlisten());
    };
  }, []);

  const toggleRow = (shorthand: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(shorthand)) next.delete(shorthand);
      else next.add(shorthand);
      return next;
    });
  };

  const handleCopy = async () => {
    if (selected.size === 0) return;
    // Join in display order, not Set insertion order.
    const text = quotes.filter((q) => selected.has(q)).join("\n");
    await writeText(text);
    await invoke("hide_recents_picker");
  };

  const handleClose = () => {
    invoke("hide_recents_picker");
  };

  return (
    <div className="rp-root">
      <div className="rp-header">
        <span className="rp-title">Recent Quotes</span>
      </div>
      <div className="rp-list">
        {quotes.length === 0 ? (
          <div className="rp-empty">No recent quotes yet.</div>
        ) : (
          quotes.map((q) => {
            const isSelected = selected.has(q);
            return (
              <button
                key={q}
                className={"rp-row" + (isSelected ? " rp-row-selected" : "")}
                onClick={() => toggleRow(q)}
                aria-pressed={isSelected}
              >
                <span className="rp-check">{isSelected ? "✓" : ""}</span>
                <span className="rp-shorthand">{q}</span>
              </button>
            );
          })
        )}
      </div>
      <div className="rp-footer">
        <button
          className="rp-copy"
          onClick={handleCopy}
          disabled={selected.size === 0}
        >
          Copy
        </button>
        <button className="rp-close" onClick={handleClose} aria-label="Close">
          ×
        </button>
      </div>
    </div>
  );
};

export default RecentsPicker;
