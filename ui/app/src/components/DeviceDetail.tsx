import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { btn, cn, muted } from "@shared/cn";
import type { BrowserLink } from "../api";
import { refreshLinks, useLinks } from "../presence";
import { DeviceIcon } from "./common/DeviceIcon";
import { CLOUD_DEVICE, LINK_DEVICE, linkOnline } from "./DevicesNav";
import { unpairLink } from "./SettingsView/BrowsersSection";
import { ago } from "./SettingsView/DesktopsSection";
import { linkKind } from "./SettingsView/PairBrowserDialog";

const card = "rounded-md border border-stone-200 dark:border-stone-700";

/** A labelled value of the details list; nothing when it has none. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="flex gap-4 px-3 py-2 text-sm">
      <dt className={cn(muted, "w-40 shrink-0")}>{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

/** A titled section of the page. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 text-xs font-medium">{title}</h3>
      {children}
    </section>
  );
}

/** A list of what the person allowed on the device, or that there is none. */
function Allowed({ title, items }: { title: string; items: string[] }) {
  const { t } = useTranslation();
  return (
    <Section title={title}>
      {items.length === 0 ? (
        <p className={cn(muted, "text-xs")}>{t("devices.detail.noneAllowed")}</p>
      ) : (
        <ul className={cn(card, "flex flex-wrap gap-1.5 p-3")}>
          {items.map((item) => (
            <li key={item} className="rounded bg-stone-100 px-2 py-0.5 font-mono text-xs dark:bg-stone-800">
              {item}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** The heading every device's page starts with: its icon, name and whether it is reached. */
function Header({ icon, title, handle, paused, status, actions }: { icon: ReactNode; title: string; handle?: string; paused?: boolean; status: ReactNode; actions?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="mb-6 flex items-start gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-stone-100 dark:bg-stone-800">{icon}</span>
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <span className="truncate">{title}</span>
          {handle && <span className={cn(muted, "shrink-0 text-sm font-normal")}>@{handle}</span>}
          {paused && (
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900 dark:text-amber-200">
              {t("settings.browsers.pausedBadge")}
            </span>
          )}
        </h2>
        <div className="mt-0.5 text-xs">{status}</div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

function Status({ online, text }: { online: boolean; text: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className={cn("h-2 w-2 rounded-full", online ? "bg-green-500" : "bg-stone-400")} aria-hidden />
      {text}
    </span>
  );
}

function CloudDetail() {
  const { t } = useTranslation();
  return (
    <div className="max-w-4xl" data-track-private>
      <Header icon={<DeviceIcon name="Wysebee Cloud" kind="cloud" size={22} />} title="Wysebee Cloud" status={<Status online text={t("settings.desktops.cloudConnected")} />} />
      <p className={cn(muted, "mb-4 text-sm")}>{t("settings.desktops.cloudHint")}</p>
      <p className={cn(muted, "text-sm")}>{t("devices.detail.cloudAbout")}</p>
    </div>
  );
}

function LinkDetail({ link, onOpenAgent, onUnpaired }: { link: BrowserLink; onOpenAgent: (name: string) => void; onUnpaired: () => void }) {
  const { t, i18n } = useTranslation();
  /* v8 ignore next -- @preserve: i18n has resolved a language before any page renders */
  const locale = i18n.resolvedLanguage || i18n.language || "en";
  const kind = linkKind(link);
  const folders = link.folders ?? [];
  const online = linkOnline(link);
  const statusText =
    link.status === "connected"
      ? t("settings.browsers.connected")
      : link.last_seen
        ? t("settings.browsers.offline", { when: ago(link.last_seen, new Date(), locale) })
        : t("settings.browsers.offlineNever");
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const unpair = async () => {
    let gone = false;
    await unpairLink(link, t, async () => {
      gone = true;
    });
    if (gone) onUnpaired();
  };

  return (
    <div className="max-w-4xl" data-track-private>
      <Header
        icon={<DeviceIcon name={link.agent_type?.name ?? link.browser} kind={LINK_DEVICE[kind]} size={22} />}
        title={link.label}
        handle={link.agent}
        paused={link.paused}
        status={<Status online={online} text={statusText} />}
        actions={
          <>
            <button type="button" className={cn(btn, "px-2 py-1 text-xs")} onClick={() => onOpenAgent(link.agent)} data-track="Device open agent">
              {t("devices.detail.openAgent")}
            </button>
            <button type="button" className={cn(btn, "px-2 py-1 text-xs")} onClick={() => void unpair()} data-track="Device unpair">
              {t("settings.browsers.unpair")}
            </button>
          </>
        }
      />

      <Section title={t("devices.detail.about")}>
        <dl className={cn(card, "divide-y divide-stone-200 dark:divide-stone-700")}>
          <Fact label={t("devices.detail.agent")}>
            <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => onOpenAgent(link.agent)}>
              {link.label} <span className={muted}>@{link.agent}</span>
            </button>
          </Fact>
          <Fact label={t("devices.detail.type")}>{link.agent_type?.name}</Fact>
          <Fact label={t(kind === "browser" ? "devices.detail.browser" : "devices.detail.device")}>{link.browser}</Fact>
          <Fact label={t("devices.detail.version")}>{link.extension_version}</Fact>
          <Fact label={t("devices.detail.status")}>{link.paused ? t("devices.detail.paused") : statusText}</Fact>
          <Fact label={t("devices.detail.lastSeen")}>{link.last_seen && when(link.last_seen)}</Fact>
          <Fact label={t("devices.detail.paired")}>{when(link.created_at)}</Fact>
        </dl>
      </Section>

      {kind !== "browser" && (
        <>
          <Allowed title={t("devices.detail.programs")} items={link.approved ?? []} />
          <Allowed title={t("devices.detail.skills")} items={link.approved_skills ?? []} />
          <Section title={t("devices.detail.folders")}>
            {folders.length === 0 ? (
              <p className={cn(muted, "text-xs")}>{t("devices.detail.noneAllowed")}</p>
            ) : (
              <ul className={cn(card, "divide-y divide-stone-200 dark:divide-stone-700")}>
                {folders.map((f) => (
                  <li key={f.id} className="px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{f.name}</span>
                      <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] dark:bg-stone-800">{t(f.mode === "write" ? "devices.detail.readWrite" : "devices.detail.readOnly")}</span>
                    </div>
                    <div className={cn(muted, "truncate font-mono text-[11px]")}>{f.path}</div>
                    {f.description && <div className={cn(muted, "text-xs")}>{f.description}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

/**
 * A device's page (`#/devices/<id>`, 2026-11-20), opened from the Devices menu (DevicesNav):
 * Wysebee Cloud, or a device or browser paired with Wysebee Agent — its agent, what it is,
 * whether it is reached, and, for a computer or a phone, what the person allowed the agent
 * there. **Open agent** opens the agent's settings; **Unpair** (asked first) unpairs it and
 * goes back to the list (`onUnpaired`).
 */
export function DeviceDetail({ device, onOpenAgent, onUnpaired }: { device: string; onOpenAgent: (name: string) => void; onUnpaired: () => void }) {
  const { t } = useTranslation();
  const links = useLinks();
  if (device === CLOUD_DEVICE) return <CloudDetail />;
  if (links === null) return <p className={cn(muted, "text-xs")}>{t("settings.desktops.loading")}</p>;
  const link = links.find((l) => l.id === device);
  if (!link)
    return (
      <div className="max-w-4xl">
        <p className={cn(muted, "mb-3 text-sm")}>{t("devices.detail.notFound")}</p>
        <button type="button" className={cn(btn, "px-2 py-1 text-xs")} onClick={onUnpaired}>
          {t("devices.detail.back")}
        </button>
      </div>
    );
  return (
    <LinkDetail
      link={link}
      onOpenAgent={onOpenAgent}
      onUnpaired={() => {
        void refreshLinks();
        onUnpaired();
      }}
    />
  );
}
