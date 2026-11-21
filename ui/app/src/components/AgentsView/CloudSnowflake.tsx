import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { btn, btnPrimary, cn, errorBanner, inputBase, muted } from "@shared/cn";
import { snowflakeIn, testTool, type CloudSnowflake, type CloudSnowflakeIn } from "../../api";
import { cloudSnowflakeProblemOf } from "./cloudSnowflakeCheck";

const AUTHS = ["token", "key"] as const;
// What the API threw: always an Error, its message the server's own detail.
const errorText = (e: unknown) => (e as Error).message;

/** Adding or changing one connection: tested with **Test connection**, saved to Wysebee Cloud
 * with **Save**, into the person's tools (by id, so its name can change) and given to the agent. */
export function CloudSnowflakeDialog({
  onSave,
  initial,
  others,
  onSaved,
  onClose,
}: {
  /** Keep it: made in the person's account, or changed — and given to the agent. */
  onSave: (name: string, connection: CloudSnowflakeIn) => Promise<CloudSnowflake>;
  initial?: CloudSnowflake;
  /** The agent's other connections, whose names this one must not repeat. */
  others: string[];
  onSaved: (row: CloudSnowflake) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [account, setAccount] = useState(initial?.account ?? "");
  const [database, setDatabase] = useState(initial?.database ?? "");
  const [warehouse, setWarehouse] = useState(initial?.warehouse ?? "");
  const [schema, setSchema] = useState(initial?.schema ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [user, setUser] = useState(initial?.user ?? "");
  const [auth, setAuth] = useState<CloudSnowflake["auth"]>(initial?.auth ?? "token");
  const [secret, setSecret] = useState("");
  const [changes, setChanges] = useState(initial?.changes ?? false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [tested, setTested] = useState<{ ok: boolean; text: string } | null>(null);
  // A stored secret is the other kind's once the way of signing in changes: it is asked for again.
  const stored = !!initial?.has_secret && auth === initial.auth;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const checked = (): CloudSnowflakeIn | null => {
    const c: CloudSnowflakeIn = {
      description: description.trim(),
      account: account.trim(),
      database: database.trim(),
      warehouse: warehouse.trim(),
      schema: schema.trim(),
      role: role.trim(),
      user: user.trim(),
      auth,
      changes,
      ...(secret.trim() ? { secret: secret.trim() } : {}),
    };
    const wrong = cloudSnowflakeProblemOf(name.trim(), c, others, stored);
    setProblem(wrong && t(wrong));
    return wrong ? null : c;
  };
  const test = async () => {
    const c = checked();
    if (!c) return;
    setBusy("test");
    setTested(null);
    try {
      const out = await testTool({ ...snowflakeIn(name.trim(), c), ...(initial ? { tool_id: initial.id } : {}) });
      setTested(out.ok ? { ok: true, text: t("agents.tools.snowflake.testOk", { version: out.version }) } : { ok: false, text: out.error });
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
  // `hidden` fields are the person's own (an account, a user): never a click label.
  const field = (id: string, label: string, value: string, set: (v: string) => void, extra: React.InputHTMLAttributes<HTMLInputElement> = {}, hidden = false) => (
    <div className="flex min-w-0 flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input id={id} className={cn(inputBase, "min-w-0")} value={value} onChange={(e) => set(e.target.value)} data-track-private={hidden || undefined} {...extra} />
    </div>
  );
  const heading = t(initial ? "agents.tools.snowflake.editTitle" : "agents.tools.snowflake.addTitle");

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={heading} className="flex max-h-[90vh] w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-stone-800" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">{heading}</h2>
        <p className={cn(muted, "text-xs")}>{t("agents.tools.snowflake.intro")}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("sf-name", t("agents.tools.postgres.name"), name, setName, { placeholder: "sales", autoFocus: !initial, className: cn(inputBase, "min-w-0 font-mono") })}
          {field("sf-account", t("agents.tools.snowflake.account"), account, setAccount, { placeholder: "myorg-myaccount", autoComplete: "off" }, true)}
        </div>
        <p className={cn(muted, "-mt-1 text-[11px]")}>{t("agents.tools.snowflake.accountHelp")}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("sf-database", t("agents.tools.postgres.database"), database, setDatabase, { placeholder: "SHOP" }, true)}
          {field("sf-warehouse", t("agents.tools.snowflake.warehouse"), warehouse, setWarehouse, { placeholder: "COMPUTE_WH" }, true)}
          {field("sf-schema", t("agents.tools.snowflake.schema"), schema, setSchema, { placeholder: "PUBLIC" }, true)}
          {field("sf-role", t("agents.tools.snowflake.role"), role, setRole, {}, true)}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="sf-auth" className="font-medium">
              {t("agents.tools.snowflake.auth")}
            </label>
            <select id="sf-auth" className={inputBase} value={auth} onChange={(e) => setAuth(e.target.value as CloudSnowflake["auth"])}>
              {AUTHS.map((a) => (
                <option key={a} value={a}>
                  {t(`agents.tools.snowflake.auths.${a}`)}
                </option>
              ))}
            </select>
          </div>
          {field("sf-user", t(auth === "key" ? "agents.tools.postgres.user" : "agents.tools.snowflake.userOptional"), user, setUser, { autoComplete: "off" }, true)}
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="sf-secret" className="font-medium">
            {t(`agents.tools.snowflake.secret.${auth}`)}
          </label>
          {auth === "key" ? (
            <textarea
              id="sf-secret"
              className={cn(inputBase, "min-h-[90px] font-mono text-xs")}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={stored ? t("agents.tools.snowflake.secretSaved") : "-----BEGIN PRIVATE KEY-----"}
              spellCheck={false}
            />
          ) : (
            <input id="sf-secret" type="password" autoComplete="new-password" className={inputBase} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={stored ? t("agents.tools.snowflake.secretSaved") : ""} />
          )}
          <p className={cn(muted, "text-[11px]")}>{t(`agents.tools.snowflake.secretHelp.${auth}`)}</p>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={changes} onChange={(e) => setChanges(e.target.checked)} />
          <span>
            <span className="font-medium">{t("agents.tools.postgres.changes")}</span>
            <span className={cn(muted, "block text-[11px]")}>{t("agents.tools.snowflake.changesHelp")}</span>
          </span>
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="sf-description" className="font-medium">
            {t("agents.tools.postgres.description")}
          </label>
          <textarea id="sf-description" className={cn(inputBase, "min-h-[50px]")} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("agents.tools.postgres.descriptionPlaceholder")} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={btn} onClick={() => void test()} disabled={busy !== null} data-track="Cloud snowflake test">
            {t(busy === "test" ? "agents.tools.postgres.testing" : "agents.tools.postgres.test")}
          </button>
          {tested && (
            <span role="status" className={cn("min-w-0 text-xs", tested.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
              {tested.text}
            </span>
          )}
        </div>
        <p className={cn(muted, "text-[11px]")}>{t("agents.tools.snowflake.cloudPrivate")}</p>
        {problem && <div className={cn(errorBanner, "mb-0 text-xs")}>{problem}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn} onClick={onClose}>
            {t("agents.tools.close")}
          </button>
          <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy !== null} data-track="Cloud snowflake save">
            {t(initial ? "agents.tools.local.saveEdit" : "agents.tools.local.saveAdd")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
