import { useTranslation } from "react-i18next";
import { cn } from "@shared/cn";
import { SystemTab } from "./SystemTab";
import { SETTINGS_TABS, type SettingsTab } from "./tabs";

/**
 * Settings on the web (#/settings[/<pane>]), as a tab strip like the desktop's: **System** —
 * Send usage analytics, the setting that follows the person. (Connections is Devices on the
 * rail since 2026-11-04: DevicesView.)
 */
export function SettingsView({ tab = SETTINGS_TABS[0][0], onSelectTab }: { tab?: SettingsTab; onSelectTab: (tab: SettingsTab) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 max-w-4xl flex-1 flex-col">
      <div className="mb-4 flex shrink-0 flex-wrap gap-1 border-b border-stone-200 dark:border-stone-700" role="tablist">
        {SETTINGS_TABS.map(([key, labelKey]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === key
                ? "border-primary-600 text-primary-700 dark:border-primary-400 dark:text-primary-300"
                : "border-transparent text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200",
            )}
            onClick={() => onSelectTab(key)}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
      <SystemTab />
    </div>
  );
}
