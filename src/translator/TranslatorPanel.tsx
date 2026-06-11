import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useState } from "react";
import { recognize, type RecognizedQuote } from "@/lib/quoteRecognizer/recognizer";
import "./TranslatorPanel.css";

// Human labels for the fields the recognizer marks "needs confirm" (amber).
const CONFIRM_LABELS: Record<string, string> = {
  strikes: "strikes",
  premium: "premium",
  basis: "basis differential",
  spread: "spread",
};

const TranslatorPanel: React.FC = () => {
  const [quote, setQuote] = useState<RecognizedQuote | null>(null);

  useEffect(() => {
    // The Rust side announces the final transcription text (observational —
    // it does not change what gets pasted). We recognize it here and decide
    // whether this is a quote worth showing.
    const setup = listen<string>("flowtrade-transcription", async (event) => {
      const result = recognize(event.payload);
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

  return (
    <div className="ft-panel">
      <div className="ft-header">
        <span className="ft-title">FlowTrade</span>
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
