import React from "react";
import "./FlowBar.css";

// Stub: a static pill, just to prove the window renders. A later task builds the real bar.
const FlowBar: React.FC = () => (
  <div className="fb-bar">
    <div className="fb-pill">
      <span className="fb-dot" />
    </div>
  </div>
);

export default FlowBar;
