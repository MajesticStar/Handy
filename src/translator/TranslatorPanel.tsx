import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useState } from "react";
import {
  recognize,
  isQuote,
  type QuoteHint,
  type RecognizedQuote,
} from "@/lib/quoteRecognizer/recognizer";
import "./TranslatorPanel.css";

// Human labels for the fields the recognizer marks "needs confirm" (amber).
const CONFIRM_LABELS: Record<string, string> = {
  strikes: "strikes",
  premium: "premium",
  basis: "basis differential",
  spread: "spread",
};

const TranslatorPanel: React.FC = () => {
  const [quote, setQuote] = useState<RecognizedQuote | QuoteHint | null>(null);

  useEffect(() => {
    const setup = listen<string>("flowtrade-transcription", async (event) => {
      const result = recognize(event.payload);
      // R2: answer the paste handshake first — Rust is waiting on this to
      // decide whether to paste clean shorthand or the raw transcript.
      // A hint pastes nothing different (raw transcript goes through).
      await invoke("submit_flowtrade_translation", {
        raw: isQuote(result) ? result.raw : null,
      });
      if (result) {
        setQuote(result);
        await invoke("show_translator_panel");
      } else {
        setQuote(null);
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

  if (!quote) return null;

  if (!isQuote(quote)) {
    return (
      <div className="ft-panel">
        <div className="ft-header" data-tauri-drag-region>
          <span className="ft-title" data-tauri-drag-region>
            FlowTrade
          </span>
          <button className="ft-close" onClick={dismiss} aria-label="Dismiss">
            ×
          </button>
        </div>
        <div className="ft-hint">{quote.hint}</div>
      </div>
    );
  }

  return (
    <div className="ft-panel">
      <div className="ft-header" data-tauri-drag-region>
        <span className="ft-title" data-tauri-drag-region>
          FlowTrade
        </span>
        <button className="ft-close" onClick={dismiss} aria-label="Dismiss">
          ×
        </button>
      </div>

      <div className="ft-panes">
        <div className="ft-pane ft-pane-raw">
          <div className="ft-pane-label">Shorthand</div>
          <div className="ft-raw">{quote.raw}</div>
        </div>
        <div className="ft-pane ft-pane-expanded">
          <div className="ft-pane-label">Plain English</div>
          <div className="ft-expanded">{quote.expanded}</div>
        </div>
      </div>

      {quote.needsConfirm.length > 0 && (
        <div className="ft-confirm">
          <span className="ft-confirm-label">Confirm:</span>
          {quote.needsConfirm.map((field) => (
            <span key={field} className="ft-confirm-chip">
              {CONFIRM_LABELS[field] ?? field}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default TranslatorPanel;
