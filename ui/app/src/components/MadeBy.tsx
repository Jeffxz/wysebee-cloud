import { useTranslation } from "react-i18next";
import type { Person } from "../api";

/**
 * Who made something and who changed it last (Wysebee Cloud's `created_by` / `updated_by`,
 * 2026-11-16), on one small muted line: "you" for the signed-in person (by email), else
 * their name, else their email, else "someone". Nothing when it names nobody.
 */
export function MadeBy({ made, changed, me, className, as: Tag = "p" }: { made?: Person | null; changed?: Person | null; me: string; className?: string; /** `span` inside a button. */ as?: "p" | "span" }) {
  const { t } = useTranslation();
  if (!made) return null;
  const who = (p: Person) =>
    me && p.email && p.email.trim().toLowerCase() === me.trim().toLowerCase() ? t("common.people.you") : p.name || p.email || t("common.people.someone");
  const text =
    changed && changed.id !== made.id
      ? t("common.people.madeAndChanged", { made: who(made), changed: who(changed) })
      : t("common.people.made", { made: who(made) });
  return <Tag className={className ?? "text-xs text-stone-500 dark:text-stone-400"}>{text}</Tag>;
}
