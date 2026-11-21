import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { btn, btnPrimary, cn, errorBanner, inputBase, muted } from "@shared/cn";
import { postgresIn, testTool, type CloudPostgres, type CloudPostgresIn } from "../../api";
import { cloudPostgresProblemOf, DEFAULT_PORT } from "./cloudPostgresCheck";

const SSL_MODES = ["verify", "require"] as const;
// What the API threw: always an Error, its message the server's own detail.
const errorText = (e: unknown) => (e as Error).message;

/** Adding or changing one connection: tested with **Test connection**, saved to Wysebee Cloud
 * with **Save**, into the person's tools (by id, so its name can change) and given to the agent. */
export function CloudPostgresDialog({
  onSave,
  initial,
  others,
  onSaved,
  onClose,
}: {
  /** Keep it: made in the person's account, or changed — and given to the agent. */
  onSave: (name: string, connection: CloudPostgresIn) => Promise<CloudPostgres>;
  initial?: CloudPostgres;
  /** The agent's other connections, whose names this one must not repeat. */
  others: string[];
  onSaved: (row: CloudPostgres) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(String(initial?.port ?? DEFAULT_PORT));
  const [database, setDatabase] = useState(initial?.database ?? "");
  const [user, setUser] = useState(initial?.user ?? "");
  const [password, setPassword] = useState("");
  const [ssl, setSsl] = useState<CloudPostgres["ssl"]>(initial?.ssl ?? "verify");
  const [changes, setChanges] = useState(initial?.changes ?? false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [tested, setTested] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const checked = (): CloudPostgresIn | null => {
    const c: CloudPostgresIn = { description: description.trim(), host: host.trim(), port: Number(port), database: database.trim(), user: user.trim(), ssl, changes, ...(password ? { password } : {}) };
    const wrong = cloudPostgresProblemOf(name.trim(), c, others);
    setProblem(wrong && t(wrong));
    return wrong ? null : c;
  };
  const test = async () => {
    const c = checked();
    if (!c) return;
    setBusy("test");
    setTested(null);
    try {
      const out = await testTool({ ...postgresIn(name.trim(), c), ...(initial ? { tool_id: initial.id } : {}) });
      setTested(out.ok ? { ok: true, text: t("agents.tools.postgres.testOk", { version: out.version }) } : { ok: false, text: out.error });
    } catch (e) {
      setTested({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    const c = checked();
    if (!c) return;
    setBusy("save");
    try {
      onSaved(await onSave(name.trim(), c));
    } catch (e) {
      setProblem(errorText(e));
      setBusy(null);
    }
  };
  // `hidden` fields are the person's own (a host, a user): never a click label.
  const field = (id: string, label: string, value: string, set: (v: string) => void, extra: React.InputHTMLAttributes<HTMLInputElement> = {}, hidden = false) => (
    <div className="flex min-w-0 flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input id={id} className={cn(inputBase, "min-w-0")} value={value} onChange={(e) => set(e.target.value)} data-track-private={hidden || undefined} {...extra} />
    </div>
  );
  const heading = t(initial ? "agents.tools.postgres.editTitle" : "agents.tools.postgres.addTitle");

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={heading} className="flex max-h-[90vh] w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-stone-800" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">{heading}</h2>
        <p className={cn(muted, "text-xs")}>{t("agents.tools.postgres.intro")}</p>
        <p className={cn(muted, "text-xs")}>{t("agents.tools.postgres.publicOnly")}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("pg-name", t("agents.tools.postgres.name"), name, setName, { placeholder: "sales", autoFocus: !initial, className: cn(inputBase, "min-w-0 font-mono") })}
          {field("pg-database", t("agents.tools.postgres.database"), database, setDatabase, { placeholder: "shop" }, true)}
        </div>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          {field("pg-host", t("agents.tools.postgres.host"), host, setHost, { placeholder: "db.example.com" }, true)}
          {field("pg-port", t("agents.tools.postgres.port"), port, setPort, { inputMode: "numeric" })}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("pg-user", t("agents.tools.postgres.user"), user, setUser, { autoComplete: "off" }, true)}
          {field("pg-password", t("agents.tools.postgres.password"), password, setPassword, {
            type: "password",
            autoComplete: "new-password",
            placeholder: initial?.has_password ? t("agents.tools.postgres.passwordSaved") : "",
          })}
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="pg-ssl" className="font-medium">
            {t("agents.tools.postgres.ssl")}
          </label>
          <select id="pg-ssl" className={inputBase} value={ssl} onChange={(e) => setSsl(e.target.value as CloudPostgres["ssl"])}>
            {SSL_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`agents.tools.postgres.sslModes.${m}`)}
              </option>
            ))}
          </select>
          <p className={cn(muted, "text-[11px]")}>{t(`agents.tools.postgres.sslHelp.${ssl}`)}</p>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={changes} onChange={(e) => setChanges(e.target.checked)} />
          <span>
            <span className="font-medium">{t("agents.tools.postgres.changes")}</span>
            <span className={cn(muted, "block text-[11px]")}>{t("agents.tools.postgres.changesHelp")}</span>
          </span>
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="pg-description" className="font-medium">
            {t("agents.tools.postgres.description")}
          </label>
          <textarea id="pg-description" className={cn(inputBase, "min-h-[50px]")} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("agents.tools.postgres.descriptionPlaceholder")} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={btn} onClick={() => void test()} disabled={busy !== null} data-track="Cloud postgres test">
            {t(busy === "test" ? "agents.tools.postgres.testing" : "agents.tools.postgres.test")}
          </button>
          {tested && (
            <span role="status" className={cn("min-w-0 text-xs", tested.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
              {tested.text}
            </span>
          )}
        </div>
        <p className={cn(muted, "text-[11px]")}>{t("agents.tools.postgres.cloudPrivate")}</p>
        {problem && <div className={cn(errorBanner, "mb-0 text-xs")}>{problem}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn} onClick={onClose}>
            {t("agents.tools.close")}
          </button>
          <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy !== null} data-track="Cloud postgres save">
            {t(initial ? "agents.tools.local.saveEdit" : "agents.tools.local.saveAdd")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
