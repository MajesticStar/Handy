import React from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Bookmark,
  ClipboardList,
  Cog,
  Cpu,
  FlaskConical,
  Home,
  Info,
  Mic,
  Settings as SettingsIcon,
  Sparkles,
} from "lucide-react";
import FlowTradeTextLogo from "./icons/FlowTradeTextLogo";
import HandyHand from "./icons/HandyHand";
import {
  GeneralSettings,
  AdvancedSettings,
  DebugSettings,
  AboutSettings,
  PostProcessingSettings,
  ModelsSettings,
} from "./settings";

interface IconProps {
  width?: number | string;
  height?: number | string;
  size?: number | string;
  className?: string;
  [key: string]: any;
}

// --- Settings sub-tabs ---------------------------------------------------
// The old Handy top-level tabs, now nested under the Settings hub item.
// Vocabulary and History were promoted to top-level hub items (Dictionary /
// Trading Journal) and intentionally do NOT appear here.
interface SettingsTabConfig {
  labelKey: string;
  icon: React.ComponentType<IconProps>;
  component: React.ComponentType;
  enabled: (settings: any) => boolean;
}

export const SETTINGS_TABS = {
  general: {
    labelKey: "sidebar.general",
    icon: HandyHand,
    component: GeneralSettings,
    enabled: () => true,
  },
  models: {
    labelKey: "sidebar.models",
    icon: Cpu,
    component: ModelsSettings,
    enabled: () => true,
  },
  advanced: {
    labelKey: "sidebar.advanced",
    icon: Cog,
    component: AdvancedSettings,
    enabled: () => true,
  },
  postprocessing: {
    labelKey: "sidebar.postProcessing",
    icon: Sparkles,
    component: PostProcessingSettings,
    enabled: (settings) => settings?.post_process_enabled ?? false,
  },
  debug: {
    labelKey: "sidebar.debug",
    icon: FlaskConical,
    component: DebugSettings,
    enabled: (settings) => settings?.debug_mode ?? false,
  },
  about: {
    labelKey: "sidebar.about",
    icon: Info,
    component: AboutSettings,
    enabled: () => true,
  },
} as const satisfies Record<string, SettingsTabConfig>;

export type SettingsTab = keyof typeof SETTINGS_TABS;

// --- Hub nav -------------------------------------------------------------
export type HubItem =
  | "home"
  | "transforms"
  | "dictionary"
  | "snippets"
  | "voicecommands"
  | "journal"
  | "settings";

interface HubItemConfig {
  id: HubItem;
  labelKey: string;
  icon: React.ComponentType<IconProps>;
}

interface HubGroup {
  labelKey?: string; // section heading; omitted for the lead item (Home)
  items: HubItemConfig[];
}

// Home (no heading), then VOICE, then RECORD. Settings is pinned separately at
// the bottom of the component, so it is not part of this list.
const HUB_GROUPS: HubGroup[] = [
  { items: [{ id: "home", labelKey: "hub.home", icon: Home }] },
  {
    labelKey: "hub.sections.voice",
    items: [
      { id: "transforms", labelKey: "hub.transforms", icon: Sparkles },
      { id: "dictionary", labelKey: "hub.dictionary", icon: BookOpen },
      { id: "snippets", labelKey: "hub.snippets", icon: Bookmark },
      { id: "voicecommands", labelKey: "hub.voiceCommands", icon: Mic },
    ],
  },
  {
    labelKey: "hub.sections.record",
    items: [{ id: "journal", labelKey: "hub.journal", icon: ClipboardList }],
  },
];

const SETTINGS_HUB_ITEM: HubItemConfig = {
  id: "settings",
  labelKey: "hub.settings",
  icon: SettingsIcon,
};

interface SidebarProps {
  activeItem: HubItem;
  onItemChange: (item: HubItem) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeItem,
  onItemChange,
}) => {
  const { t } = useTranslation();

  const renderItem = (item: HubItemConfig) => {
    const Icon = item.icon;
    const isActive = activeItem === item.id;
    return (
      <div
        key={item.id}
        className={`flex gap-2 items-center p-2 w-full rounded-lg cursor-pointer transition-colors ${
          isActive
            ? "bg-logo-primary/80"
            : "hover:bg-mid-gray/20 hover:opacity-100 opacity-85"
        }`}
        onClick={() => onItemChange(item.id)}
      >
        <Icon width={22} height={22} className="shrink-0" />
        <p
          className="text-sm font-medium truncate"
          title={t(item.labelKey)}
        >
          {t(item.labelKey)}
        </p>
      </div>
    );
  };

  return (
    <div className="flex flex-col w-44 h-full border-e border-mid-gray/20 px-2">
      <FlowTradeTextLogo className="m-4 text-2xl self-center" />
      <div className="flex flex-col w-full gap-1 pt-2 border-t border-mid-gray/20 overflow-y-auto flex-1">
        {HUB_GROUPS.map((group, groupIndex) => (
          <div key={groupIndex} className="flex flex-col w-full gap-1">
            {group.labelKey && (
              <p className="text-[10px] font-semibold uppercase tracking-wider text-mid-gray/60 px-2 pt-3 pb-1">
                {t(group.labelKey)}
              </p>
            )}
            {group.items.map(renderItem)}
          </div>
        ))}
      </div>
      <div className="w-full pt-2 pb-2 border-t border-mid-gray/20">
        {renderItem(SETTINGS_HUB_ITEM)}
      </div>
    </div>
  );
};
