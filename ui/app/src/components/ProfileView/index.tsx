import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { UserRound } from "lucide-react";
import { btn, btnPrimary, cn, inputBase, muted } from "@shared/cn";
import { useAccount } from "../../account";
import { billingEnabled, canSignOut, selfHosted } from "../../cloud/auth";
import { cloudHost } from "../../cloud/host";
import { loadProfile, personNameOf, updateProfile, useProfile } from "../../profile";
import { AgentAvatarModal } from "../AgentsView/AgentAvatarModal";
import { PersonAvatar, initialOf } from "../common/PersonAvatar";
import { BillingTab } from "./BillingTab";
import { StorageUsage } from "./StorageUsage";
import { DeleteAccountSection } from "./DeleteAccount";

/** The Account page's tabs, in order: the first is where `#/account` (and `#/profile`) opens. */
export const ACCOUNT_TABS = [
  ["profile", "profile.tabs.profile"],
  ["billing", "profile.tabs.billing"],
] as const;

export type AccountTab = (typeof ACCOUNT_TABS)[number][0];

/** The tab a URL segment names; anything else is the first. */
export function accountTabFromSegment(segment: string | undefined): AccountTab {
  return ACCOUNT_TABS.find(([key]) => key === segment)?.[0] ?? ACCOUNT_TABS[0][0];
}

/**
 * The **Account** page (`#/account[/<tab>]`; `#/profile` was its address until 2026-11-04 and
 * still opens it), opened by the person's button on the rail: **Profile** and **Billing**
 * (their plan, its usage, the plans and their payments), as a tab strip like Settings'.
 */
export function AccountView({ tab = ACCOUNT_TABS[0][0], onSelectTab }: { tab?: AccountTab; onSelectTab: (tab: AccountTab) => void }) {
  const { t } = useTranslation();
  // Billing only where the server serves plans (an extension's `features.billing`; cloud/auth.ts).
  const billing = billingEnabled();
  const tabs = billing ? ACCOUNT_TABS : ACCOUNT_TABS.filter(([key]) => key !== "billing");
  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex flex-wrap gap-1 border-b border-stone-200 dark:border-stone-700" role="tablist">
        {tabs.map(([key, labelKey]) => (
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
      {tab === "billing" && billing ? <BillingTab /> : <ProfileView />}
    </div>
  );
}

/** The longest display name the server takes (apps/cloud/users.py). */
const MAX_NAME = 80;

/**
 * Account → **Profile**, as the desktop's Profile page: their display name — shown on their chat messages, and what Wysebee calls them —
 * and their picture, then who they are signed in as, with Sign out. Their row in Wysebee
 * Cloud (`/api/v1/profile`), the same one the desktop's Profile page changes.
 */
export function ProfileView() {
  const { t } = useTranslation();
  const profile = useProfile();
  const { status } = useAccount();
  // The account's own name: what shows when no display name is chosen.
  const accountName = personNameOf(null, status);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => loadProfile(), []);
  // The field shows what is saved, once it is read (and again when it changes elsewhere).
  useEffect(() => {
    if (profile) setName(profile.display_name);
  }, [profile]);

  const shown = profile?.display_name || accountName;
  const changed = profile !== null && name.trim() !== profile.display_name;
  const save = async () => {
    setSaving(true);
    try {
      await updateProfile({ display_name: name.trim() });
      toast.success(t("profile.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-8">
      <section aria-label={t("profile.title")} className="space-y-4" data-track-private>
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-full outline-none hover:opacity-80 focus:ring-2 focus:ring-primary-600"
            onClick={() => setPicking(true)}
            disabled={!profile}
            aria-label={t("profile.changePicture")}
            title={t("profile.changePicture")}
          >
            <PersonAvatar avatar={profile?.avatar} name={shown} size={72} className="rounded-full" />
          </button>
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{shown || t("agents.chat.you")}</div>
            <p className={cn(muted, "text-xs")}>{t("profile.pictureHint")}</p>
          </div>
        </div>
        <form
          className="flex flex-col gap-1 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (changed && !saving) void save();
          }}
        >
          <label htmlFor="profile-display-name" className="font-medium">
            {t("profile.displayName")}
          </label>
          <div className="flex gap-2">
            <input
              id="profile-display-name"
              className={cn(inputBase, "flex-1")}
              value={name}
              maxLength={MAX_NAME}
              placeholder={accountName}
              disabled={!profile}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className={btnPrimary} disabled={!changed || saving}>
              {t("profile.save")}
            </button>
          </div>
          <span className={cn(muted, "text-[11px]")}>{t("profile.displayNameHint")}</span>
        </form>
      </section>

      {/* With plans, storage is shown on Billing, with the rest of its usage. */}
      {!billingEnabled() && <StorageUsage />}

      <section className="max-w-2xl">
        <h2 className="mb-4 text-base font-semibold">{t("account.title")}</h2>
        {/* The person's own name and email: kept out of click labels. */}
        <div data-track-private className="flex items-center gap-3 rounded-lg border border-stone-200 p-4 text-sm dark:border-stone-700">
          <UserRound size={28} className="shrink-0 text-primary-500" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className={cn(muted, "text-xs")}>{t("account.signedInAs")}</div>
            <div className="truncate font-medium">{accountName}</div>
            {status?.email && <div className={cn(muted, "truncate text-xs")}>{status.email}</div>}
          </div>
          {canSignOut() && (
            <button
              type="button"
              className={cn(btn, "shrink-0")}
              disabled={signingOut}
              onClick={() => {
                setSigningOut(true);
                void cloudHost.signOut();
              }}
            >
              {t("account.signOut")}
            </button>
          )}
        </div>
      </section>

      {!selfHosted() && <DeleteAccountSection />}

      {picking && profile && (
        <AgentAvatarModal
          avatar={profile.avatar ?? ""}
          label={shown}
          title={t("profile.picture")}
          fallback={<span className="flex h-full w-full items-center justify-center rounded-md bg-primary-100 text-lg font-semibold text-primary-700">{initialOf(shown)}</span>}
          onApply={async (next) => {
            await updateProfile({ avatar: next || null });
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
