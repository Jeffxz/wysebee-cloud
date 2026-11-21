import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@shared/cn";
// The app icon (scripts/make_icons.sh draws it from the logo SVG).
import wysebeeIcon from "../../assets/wysebee-icon.png";

// Whether an avatar string is an image (a data: URI or an http(s) URL) rather than
// an emoji/short glyph.
function isImageAvatar(avatar: string): boolean {
  return /^(data:|https?:\/\/)/i.test(avatar);
}

// The agent's avatar — Wysebee's, the app's one agent. An image avatar renders as an
// <img>; a short string (emoji) renders as a glyph; unset is the Wysebee app icon (it was
// a grey robot box before 2026-10-22). The person's picture uses it too, with their
// initial as the `fallback` instead of the app icon.
//
// `status` adds the agent's presence (presence.ts), as Slack shows a person's: a green dot
// at the bottom right while it is online, a hollow grey ring while it is offline.
export function AgentAvatar({
  status,
  ...rest
}: {
  avatar?: string | null;
  label?: string;
  size?: number;
  className?: string;
  /** What shows with no avatar; the app icon when not given. */
  fallback?: ReactNode;
  /** Online or offline: a dot on the picture. None: no dot. */
  status?: "online" | "offline" | null;
}) {
  const { t } = useTranslation();
  if (!status) return <Picture {...rest} />;
  const size = rest.size ?? 36;
  const dot = Math.max(8, Math.round(size * 0.32));
  return (
    <span className="relative inline-flex shrink-0" data-presence={status}>
      <Picture {...rest} />
      <span
        role="img"
        aria-label={t(status === "online" ? "common.presence.online" : "common.presence.offline")}
        title={t(status === "online" ? "common.presence.online" : "common.presence.offline")}
        className={cn(
          "absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-white dark:border-stone-900",
          status === "online" ? "bg-green-500" : "bg-white ring-2 ring-inset ring-stone-400 dark:bg-stone-900",
        )}
        style={{ width: dot, height: dot }}
      />
    </span>
  );
}

function Picture({
  avatar,
  label,
  size = 36,
  className,
  fallback,
}: {
  avatar?: string | null;
  label?: string;
  size?: number;
  className?: string;
  fallback?: ReactNode;
}) {
  const { t } = useTranslation();
  const box = cn(
    "flex shrink-0 items-center justify-center overflow-hidden rounded-md",
    className,
  );
  const style = { width: size, height: size };
  const alt = label
    ? t("common.avatar.named", { label })
    : t("common.avatar.unnamed");
  const trimmed = (avatar ?? "").trim();

  if (trimmed && isImageAvatar(trimmed)) {
    return (
      <img
        src={trimmed}
        alt={alt}
        className={cn(box, "border border-black/10 object-cover dark:border-white/10")}
        style={style}
      />
    );
  }
  if (trimmed) {
    return (
      <div
        className={cn(box, "bg-stone-100 dark:bg-stone-700")}
        style={style}
        role="img"
        aria-label={alt}
      >
        <span style={{ fontSize: Math.round(size * 0.58), lineHeight: 1 }}>
          {trimmed}
        </span>
      </div>
    );
  }
  if (fallback !== undefined) {
    return (
      <div className={box} style={style} role="img" aria-label={alt}>
        {fallback}
      </div>
    );
  }
  return <img src={wysebeeIcon} alt={alt} className={box} style={style} />;
}
