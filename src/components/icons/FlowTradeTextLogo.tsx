import React from "react";

// FlowTrade wordmark: a small up-tick mark (voice + markets) + "Flow" in the
// brand accent. Bricolage Grotesque display face. The mark uses the accent
// token (currentColor via text-logo-primary) so it follows the single accent.
const FlowTradeTextLogo = ({ className }: { className?: string }) => {
  return (
    <span
      className={`inline-flex items-center gap-2 font-display font-extrabold tracking-tight text-text ${className ?? ""}`}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 32 32"
        fill="none"
        className="text-logo-primary"
        aria-hidden="true"
      >
        <rect width="32" height="32" rx="9" fill="currentColor" fillOpacity="0.14" />
        <path
          d="M6 19 L11 13 L16 22 L21 9 L26 16"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>
        <span className="text-logo-primary">Flow</span>Trade
      </span>
    </span>
  );
};

export default FlowTradeTextLogo;
