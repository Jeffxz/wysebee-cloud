import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";

const ICON_BUTTON = "shrink-0 rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-700";

/** A value shown in full, with a button that copies it (a tick for a moment after). */
export function Copyable({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex items-start gap-2 rounded-md border border-stone-200 bg-stone-50 px-2 py-1.5 dark:border-stone-700 dark:bg-stone-900">
      <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[11px]" data-track-private>
        {value}
      </code>
      <button type="button" className={ICON_BUTTON} onClick={() => void copy()} aria-label={t("agents.api.copy", { what: label })} title={t("agents.api.copy", { what: label })}>
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
    </div>
  );
}
