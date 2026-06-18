import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import {
  BaseDirectory,
  exists,
  readTextFile,
} from "@tauri-apps/plugin-fs";
import React, { useEffect, useState } from "react";
import {
  recognize,
  setUserLexicon,
  looksLikeQuoteAttempt,
  isQuote,
  type QuoteHint,
  type RecognizedQuote,
} from "@/lib/quoteRecognizer/recognizer";
import "./TranslatorPanel.css";

// Where the Vocabulary tab saves the trader's added/edited words.
const VOCAB_FILE = "lexicon-additions.json";

// Pull the trader's saved Vocabulary entries off disk and fold them into the
// recognizer. Read fresh on every dictation so a word added in the Vocabulary
// tab takes effect immediately — no app restart. Any failure (missing file,
// bad JSON) falls back to the seed list; dictation must never break.
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

// Human labels for the fields the recognizer marks "needs confirm" (amber).
const CONFIRM_LABELS: Record<string, string> = {
  strikes: "strikes",
  premium: "premium",
  price: "price",
  tenor: "month/year",
  basis: "basis differential",
  spread: "spread",
};

// Manual header drag — the declarative drag-region doesn't take on this
// NSPanel, so we move the window ourselves from pointer deltas.
function startDrag(e: React.PointerEvent) {
  if ((e.target as HTMLElement).closest("button")) return;
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

const TranslatorPanel: React.FC = () => {
  const [quote, setQuote] = useState<RecognizedQuote | QuoteHint | null>(null);
  // A near-miss: couldn't read it as a market, but it looked like a quote
  // attempt (probably a mis-heard word) — offer to teach the word.
  const [teachPhrase, setTeachPhrase] = useState<string | null>(null);
  const [showPlain, setShowPlain] = useState(false);

  useEffect(() => {
    const setup = listen<string>("flowtrade-transcription", async (event) => {
      // Apply the trader's Vocabulary-tab words before translating.
      await applyUserLexicon();
      const result = recognize(event.payload);
      // R2: answer the paste handshake first — Rust is waiting on this to
      // decide whether to paste clean shorthand or the raw transcript.
      // A hint pastes nothing different (raw transcript goes through).
      await invoke("submit_flowtrade_translation", {
        raw: isQuote(result) ? result.raw : null,
      });
      if (result) {
        setTeachPhrase(null);
        setShowPlain(false);
        setQuote(result);
        await invoke("show_translator_panel");
      } else if (looksLikeQuoteAttempt(event.payload)) {
        // near-miss — keep the panel up and offer to teach the missed word
        setQuote(null);
        setTeachPhrase(event.payload);
        await invoke("show_translator_panel");
      } else {
        setQuote(null);
        setTeachPhrase(null);
        await invoke("hide_translator_panel");
      }
    });

    return () => {
      setup.then((unlisten) => unlisten());
    };
  }, []);

  const dismiss = async () => {
    await invoke("hide_translator_panel");
  };

  // Hand the missed phrase to the main window's Vocabulary tab, then surface it.
  const teach = async () => {
    if (teachPhrase) await emit("flowtrade-teach-word", teachPhrase);
    await invoke("show_main_window_command");
    await invoke("hide_translator_panel");
  };

  if (!quote && !teachPhrase) return null;

  if (teachPhrase && !quote) {
    return (
      <div className="ft-bubble ft-bubble-teach" onPointerDown={startDrag}>
        <button className="ft-close" onClick={dismiss} aria-label="Dismiss">
          ×
        </button>
        <div className="ft-teach-msg">Didn't catch that as a market.</div>
        <div className="ft-teach-heard">"{teachPhrase}"</div>
        <button className="ft-teach-btn" onClick={teach}>
          Teach FlowTrade a word
        </button>
      </div>
    );
  }

  if (!quote) return null;

  if (!isQuote(quote)) {
    return (
      <div className="ft-bubble ft-bubble-hint" onPointerDown={startDrag}>
        <button className="ft-close" onClick={dismiss} aria-label="Dismiss">
          ×
        </button>
        <div className="ft-hint">{quote.hint}</div>
      </div>
    );
  }

  return (
    <div className="ft-bubble" onPointerDown={startDrag}>
      <button className="ft-close" onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
      <div className="ft-shorthand">{quote.raw}</div>
      <div className="ft-status">
        <span className="ft-canonical">
          <span className="ft-dot" />
          Canonical
        </span>
        {quote.needsConfirm.length > 0 && (
          <span className="ft-confirm">
            ⚠ confirm:{" "}
            {quote.needsConfirm
              .map((f) => CONFIRM_LABELS[f] ?? f)
              .join(" · ")}
          </span>
        )}
        <button
          className="ft-expander"
          onClick={() => setShowPlain((s) => !s)}
        >
          Plain English {showPlain ? "⌃" : "⌄"}
        </button>
      </div>
      {showPlain && <div className="ft-plain">{quote.expanded}</div>}
    </div>
  );
};

export default TranslatorPanel;
