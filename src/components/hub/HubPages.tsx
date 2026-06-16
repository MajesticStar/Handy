import React from "react";

// Thin hub pages for Phase H step 1. Home and Transforms get fuller content
// in later steps; Snippets and Voice Commands are labelled placeholders
// (Phases S and V). Kept deliberately light per the design doc.

export const HomePage: React.FC = () => (
  <div className="w-full max-w-2xl text-center py-16">
    <h1 className="text-2xl font-semibold">FlowTrade</h1>
    <p className="text-mid-gray mt-2">Speak your market — FlowTrade types it.</p>
    <p className="text-mid-gray/70 text-sm mt-10">
      Your dashboard appears here in the next build step.
    </p>
  </div>
);

export const TransformsPage: React.FC = () => (
  <div className="w-full max-w-2xl py-6">
    <h2 className="text-xl font-semibold mb-2">Transforms</h2>
    <p className="text-mid-gray mb-6">
      FlowTrade's market transform turns your spoken shorthand into a clean,
      ICE-canonical quote — the two-pane panel you see when you dictate. It runs
      on a fixed grammar, not a language model, so it never invents a price.
    </p>
    <div className="rounded-lg border border-mid-gray/20 p-4">
      <p className="text-xs uppercase tracking-wider text-mid-gray/60 mb-1">
        Example
      </p>
      <p className="font-mono text-sm">
        "henry hub call spread three and a quarter by four …"
      </p>
      <p className="font-mono text-sm mt-1 text-logo-primary">
        → K 3.25/4 cs x2.95 .061/.064
      </p>
    </div>
  </div>
);

export const SnippetsPage: React.FC = () => (
  <div className="w-full max-w-2xl text-center py-16">
    <h2 className="text-xl font-semibold">Snippets</h2>
    <p className="text-mid-gray mt-2">
      Coming soon — trader macros that paste saved text from a short trigger.
    </p>
  </div>
);

export const VoiceCommandsPage: React.FC = () => (
  <div className="w-full max-w-2xl text-center py-16">
    <h2 className="text-xl font-semibold">Voice Commands</h2>
    <p className="text-mid-gray mt-2">
      Coming soon — run your desk by voice: open and switch apps, change focus.
    </p>
  </div>
);
