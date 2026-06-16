import React from "react";

// FlowTrade wordmark — replaces Handy's hand-drawn SVG logo in the nav.
// Plain styled text keeps the rebrand surgical (no new asset pipeline).
const FlowTradeTextLogo = ({ className }: { className?: string }) => {
  return (
    <span
      className={`text-logo-primary font-semibold tracking-tight ${className ?? ""}`}
    >
      <span className="font-bold">Flow</span>Trade
    </span>
  );
};

export default FlowTradeTextLogo;
