import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  cursorPosition,
  getCurrentWindow,
  PhysicalPosition,
} from "@tauri-apps/api/window";
import { BaseDirectory, exists, readTextFile } from "@tauri-apps/plugin-fs";
import React, { useEffect, useState } from "react";
import {
  recognize,
  setUserLexicon,
  isQuote,
} from "@/lib/quoteRecognizer/recognizer";
import "./FlowBar.css";

// Where the Vocabulary tab saves the trader's added/edited words. Read fresh on
// every dictation so the dot reflects the same recognition the receipt uses.
const VOCAB_FILE = "lexicon-additions.json";

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

// Drag the whole bar from a pointer-down anywhere except on an action button.
// The declarative drag-region doesn't take on an NSPanel, so we move the window
// ourselves from pointer deltas (same approach as the translator panel).
function startDrag(e: React.PointerEvent) {
  if ((e.target as HTMLElement).closest(".fb-action")) return;
  const win = getCurrentWindow();
  const dpr = window.devicePixelRatio;
  const sx = e.screenX;
  const sy = e.screenY;
  win.outerPosition().then((pos) => {
    const onMove = (ev: PointerEvent) => {
      win.setPosition(
        new PhysicalPosition(
          Math.round(pos.x + (ev.screenX - sx) * dpr),
          Math.round(pos.y + (ev.screenY - sy) * dpr),
        ),
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

function onAction(key: string) {
  if (key === "dictate") {
    invoke("toggle_dictation").catch((e) =>
      console.warn("toggle_dictation failed:", e),
    );
  }
  if (key === "recents") {
    invoke("show_recents_picker").catch((e) =>
      console.warn("show_recents_picker failed:", e),
    );
  }
  // other tools wired in later tasks/plans
}

// The six cockpit tools. Click-actions are wired in follow-on plans; here they
// are visual affordances that appear on hover.
const ACTIONS = [
  { key: "dictate", glyph: "🎤", label: "Dictate" },
  { key: "polish", glyph: "✨", label: "Polish" },
  { key: "snippets", glyph: "🔖", label: "Snippets" },
  { key: "note", glyph: "📝", label: "Note" },
  { key: "commands", glyph: "🎙", label: "Commands" },
  { key: "recents", glyph: "↻", label: "Recents" },
];

const FlowBar: React.FC = () => {
  const [expanded, setExpanded] = useState(false);
  const [listening, setListening] = useState(false);
  const [canonical, setCanonical] = useState(false);

  // Listening state — reuse the recording overlay's own show/hide events.
  useEffect(() => {
    const subs = [
      listen("show-overlay", () => setListening(true)),
      listen("hide-overlay", () => setListening(false)),
    ];
    return () => {
      subs.forEach((s) => s.then((un) => un()));
    };
  }, []);

  // Canonical dot — did FlowTrade parse the last dictation into a valid quote?
  // Applies the trader's Vocabulary words first, exactly like the receipt panel.
  useEffect(() => {
    const sub = listen<string>("flowtrade-transcription", async (event) => {
      await applyUserLexicon();
      setCanonical(isQuote(recognize(event.payload)));
    });
    return () => {
      sub.then((un) => un());
    };
  }, []);

  // Hover expand/collapse, geometry-driven. A non-activating floating panel
  // doesn't get dependable mouse-enter/leave from macOS — and they go stale
  // after the window is dragged — so deriving "expanded" from those events is
  // flaky. Instead, poll the cursor against the bar's rect: expand when it's
  // inside, collapse when it's outside. Cheap (three reads), always correct.
  useEffect(() => {
    const win = getCurrentWindow();
    const id = window.setInterval(async () => {
      try {
        const [cur, pos, size] = await Promise.all([
          cursorPosition(),
          win.outerPosition(),
          win.outerSize(),
        ]);
        setExpanded(
          cur.x >= pos.x &&
            cur.x <= pos.x + size.width &&
            cur.y >= pos.y &&
            cur.y <= pos.y + size.height,
        );
      } catch {
        // Transient read failure — leave state as-is, try again next tick.
      }
    }, 120);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      className={"fb-bar" + (expanded ? " fb-expanded" : "")}
      onPointerDown={startDrag}
    >
      <div className="fb-pill">
        <span className={"fb-dot" + (canonical ? " fb-dot-on" : "")} />
        {listening && <span className="fb-levels" aria-hidden />}
      </div>
      <div className="fb-actions">
        {ACTIONS.map((a) => (
          <button
            key={a.key}
            className="fb-action"
            title={a.label}
            aria-label={a.label}
            onClick={() => onAction(a.key)}
          >
            {a.glyph}
          </button>
        ))}
      </div>
    </div>
  );
};

export default FlowBar;
