import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { btn, btnPrimary, cn, errorBanner, inputBase, muted, surface } from "@shared/cn";
import { addAgent, handleFor, validHandle } from "../agents";

/**
 * Adding one of the person's own agents (Home's menu → +): what it is called, and its "@"
 * handle — made from the name until the person changes it. The agent is made here.
 * Added, its settings open.
 */
export function AddAgentDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const { t } = useTranslation();
  const [label, setLabel] = useState("");
  const [handle, setHandle] = useState("");
  // Until the person types a handle of their own, it follows the name.
  const [handleTouched, setHandleTouched] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = handleTouched ? handle : handleFor(label);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    if (busy) return;
    if (!label.trim()) return setProblem(t("home.addAgent.needLabel"));
    if (!validHandle(name)) return setProblem(t("home.addAgent.badHandle"));
    setBusy(true);
    try {
      const agent = await addAgent(name, label.trim());
      onAdded(agent.id);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 text-stone-900 dark:text-stone-100" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("home.addAgent.title")}
        className={cn(surface, "flex w-full max-w-md flex-col gap-4 p-5 shadow-xl")}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">{t("home.addAgent.title")}</h2>
        <p className={cn(muted, "text-xs")}>{t("home.addAgent.intro")}</p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("home.addAgent.label")}</span>
          <input
            className={inputBase}
            aria-label={t("home.addAgent.label")}
            autoFocus
            value={label}
            maxLength={60}
            placeholder={t("home.addAgent.labelPlaceholder")}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("home.addAgent.handle")}</span>
          <div className="flex items-center gap-1">
            <span className={muted}>@</span>
            <input
              className={cn(inputBase, "font-mono")}
              aria-label={t("home.addAgent.handle")}
              value={name}
              maxLength={30}
              placeholder="travel-planner"
              onChange={(e) => {
                setHandleTouched(true);
                setHandle(e.target.value.toLowerCase());
              }}
            />
          </div>
          <span className={cn(muted, "text-xs")}>{t("home.addAgent.handleHelp")}</span>
        </label>
        {problem && <div className={cn(errorBanner, "mb-0 text-xs")}>{problem}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn} onClick={onClose}>
            {t("home.addAgent.cancel")}
          </button>
          <button type="button" className={btnPrimary} onClick={() => void save()}>
            {t("home.addAgent.save")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
