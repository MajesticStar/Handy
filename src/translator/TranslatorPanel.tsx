import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
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
  price: "price",
  tenor: "month/year",
  basis: "basis differential",
  spread: "spread",
};

// Manual header drag — the declarative drag-region doesn't take on this
// NSPanel, so we move the window ourselves from pointer deltas.
function startDrag(e: React.PointerEvent) {
  if ((e.target as HTMLElement).closest(".ft-close")) return;
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

const PanelHeader: React.FC<{ onDismiss: () => void }> = ({ onDismiss }) => (
  <div className="ft-header" onPointerDown={startDrag}>
    <span className="ft-title">FlowTrade</span>
    <button className="ft-close" onClick={onDismiss} aria-label="Dismiss">
      ×
    </button>
  </div>
);

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
        <PanelHeader onDismiss={dismiss} />
        <div className="ft-hint">{quote.hint}</div>
      </div>
    );
  }

  return (
    <div className="ft-panel">
      <PanelHeader onDismiss={dismiss} />

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
