import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../hooks/useSettings";
import { SETTINGS_TABS, SettingsTab } from "./Sidebar";

// The Settings hub item opens this page, which carries the old Handy tabs as
// its own secondary sub-tab nav (General / Models / Advanced / About, plus
// Post Process and Debug when those are toggled on). Keeps the hub clean.
export const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  const availableTabs = Object.entries(SETTINGS_TABS)
    .filter(([_, config]) => config.enabled(settings))
    .map(([id, config]) => ({ id: id as SettingsTab, ...config }));

  // If the active tab got hidden (e.g. Debug toggled off while open), fall
  // back to General so we never render an empty page.
  const active = availableTabs.some((tab) => tab.id === activeTab)
    ? activeTab
    : "general";
  const ActiveComponent = SETTINGS_TABS[active].component;

  return (
    <div className="w-full max-w-3xl">
      <div className="flex flex-wrap gap-1 mb-4 border-b border-mid-gray/20 pb-2">
        {availableTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex gap-2 items-center px-3 py-1.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-logo-primary/80"
                  : "hover:bg-mid-gray/20 opacity-85 hover:opacity-100"
              }`}
            >
              <Icon width={18} height={18} className="shrink-0" />
              {t(tab.labelKey)}
            </button>
          );
        })}
      </div>
      <ActiveComponent />
    </div>
  );
};
