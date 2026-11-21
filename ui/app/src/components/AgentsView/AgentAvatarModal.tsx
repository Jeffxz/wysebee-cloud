import { useEffect, useRef, useState, type ReactNode } from "react";
import { Shuffle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { btn, cn, errorBanner, inputBase, muted, surface } from "@shared/cn";
import { AgentAvatar } from "../common/AgentAvatar";
import { AVATAR_EMOJI } from "./avatarEmoji";
import { downscaleImageToDataUrl } from "./avatarImage";
import type { AvatarStyleKey } from "./avatarGenerate";

/** The generator, read with the picker (it is not in the app's first bundle). */
type Generator = typeof import("./avatarGenerate");

// Whether an avatar string is an image rather than a glyph. Mirrors the same test
// in AgentAvatar — the free-text field must not show a data: URI as if it were text.
function isImageAvatar(avatar: string): boolean {
  return /^(data:|https?:\/\/)/i.test(avatar);
}

/**
 * Picker for an agent's avatar, opened from the avatar in the page header.
 *
 * Every control commits straight through to the server and closes: the avatar is
 * saved on pick, not with the page's Save button, so there is no draft to preview
 * and nothing to roll back on failure. The parent owns the save (it writes the
 * avatar on top of the last-saved config document), so all this holds is the
 * free-text draft plus busy/error.
 */
export function AgentAvatarModal({
  avatar,
  label,
  onApply,
  onClose,
  title,
  fallback,
}: {
  avatar: string;
  label: string;
  /** The dialog's title; "Agent avatar" when not given. */
  title?: string;
  /** What the preview shows with no avatar (the person's initial); the app icon when not given. */
  fallback?: ReactNode;
  // Persists the avatar; "" clears it back to the default. Rejects on failure.
  onApply: (next: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // Seeded from the current avatar unless that is an image, which has no text form.
  const [text, setText] = useState(isImageAvatar(avatar) ? "" : avatar);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Generated avatars: a style and a batch of seeds, each a different one.
  const [gen, setGen] = useState<Generator | null>(null);
  const [style, setStyle] = useState<AvatarStyleKey>("notionists");
  const [seeds, setSeeds] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    void import("./avatarGenerate").then((g) => {
      if (!live) return;
      setGen(g);
      setSeeds(g.newSeeds());
    });
    return () => {
      live = false;
    };
  }, []);

  // The single commit path for every control below.
  const commit = async (next: string) => {
    setBusy(true);
    setError(null);
    try {
      await onApply(next);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // Stay open so the choice can be retried or abandoned.
      setBusy(false);
    }
  };

  // Downscale first (its own failure mode, and no point saving a broken read),
  // then commit the resulting data URI.
  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setError(null);
    let dataUrl: string;
    try {
      dataUrl = await downscaleImageToDataUrl(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("agents.avatar.processFailed"));
      return;
    }
    await commit(dataUrl);
  };

  // A generated one is saved as a picture, like an upload.
  const pickGenerated = async (g: Generator, seed: string) => {
    setError(null);
    let dataUrl: string;
    try {
      dataUrl = await g.avatarPng(style, seed);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("agents.avatar.processFailed"));
      return;
    }
    await commit(dataUrl);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? t("agents.avatar.title")}
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className={cn(surface, "max-h-full w-full max-w-md overflow-y-auto p-5 shadow-xl")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <AgentAvatar avatar={avatar} label={label} size={48} fallback={fallback} />
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{title ?? t("agents.avatar.title")}</h3>
            <p className={cn(muted, "text-xs")}>{t("agents.avatar.savedOnChoose")}</p>
          </div>
        </div>

        <div className="mt-4 mb-1 flex items-center gap-2">
          <span className={cn(muted, "text-xs font-medium")}>{t("agents.avatar.generated")}</span>
          <div className="flex-1" />
          <button
            type="button"
            className={cn(btn, "inline-flex items-center gap-1 px-2 py-1 text-xs")}
            disabled={busy || !gen}
            onClick={() => gen && setSeeds(gen.newSeeds())}
            data-track="Avatar shuffle"
          >
            <Shuffle size={13} aria-hidden />
            {t("agents.avatar.shuffle")}
          </button>
        </div>
        {gen ? (
          <>
            <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label={t("agents.avatar.style")}>
              {gen.AVATAR_STYLES.map(({ key }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={style === key}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:opacity-50",
                    style === key ? "border-primary-600 bg-primary-600 text-white" : "border-stone-300 hover:bg-stone-100 dark:border-stone-600 dark:hover:bg-stone-700",
                  )}
                  disabled={busy}
                  onClick={() => setStyle(key)}
                  data-track={`Avatar style ${key}`}
                >
                  {t(`agents.avatar.styles.${key}`)}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {seeds.map((seed, i) => (
                <button
                  key={seed}
                  type="button"
                  className="overflow-hidden rounded-lg bg-stone-100 transition-transform hover:scale-105 disabled:opacity-50 dark:bg-stone-800"
                  aria-label={t("agents.avatar.useGenerated", { n: i + 1 })}
                  disabled={busy}
                  onClick={() => void pickGenerated(gen, seed)}
                >
                  <img src={gen.previewUrl(style, seed)} alt="" className="aspect-square w-full" />
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className={cn(muted, "py-6 text-center text-xs")}>{t("agents.common.loading")}</div>
        )}

        <div className={cn(muted, "mt-4 mb-1 text-xs font-medium")}>{t("agents.avatar.emoji")}</div>
        <div className="grid grid-cols-8 gap-1">
          {AVATAR_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-md text-xl transition-colors hover:bg-stone-100 disabled:opacity-50 dark:hover:bg-stone-700",
                emoji === avatar && "ring-2 ring-primary-600",
              )}
              title={emoji}
              aria-label={t("agents.avatar.useEmoji", { emoji })}
              disabled={busy}
              onClick={() => void commit(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>

        <div className={cn(muted, "mt-4 mb-1 text-xs font-medium")}>{t("agents.avatar.otherEmoji")}</div>
        <div className="flex items-center gap-2">
          <input
            className={cn(inputBase, "w-24 text-center")}
            placeholder="🤖"
            aria-label={t("agents.avatar.avatarEmoji")}
            maxLength={12}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (text.trim()) void commit(text.trim());
              }
            }}
          />
          <button
            type="button"
            className={btn}
            disabled={busy || !text.trim()}
            onClick={() => void commit(text.trim())}
          >
            {t("agents.avatar.use")}
          </button>
        </div>

        <div className={cn(muted, "mt-4 mb-1 text-xs font-medium")}>{t("agents.avatar.image")}</div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPickFile}
          />
          <button
            type="button"
            className={btn}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {t("agents.avatar.upload")}
          </button>
          {avatar.trim() && (
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={() => void commit("")}
            >
              {t("agents.avatar.useDefault")}
            </button>
          )}
        </div>

        {error && <div className={cn(errorBanner, "mt-3 text-xs")}>{error}</div>}

        <div className="mt-4 flex items-center justify-end gap-2">
          {busy && <span className={cn(muted, "mr-auto text-xs")}>{t("agents.common.saving")}</span>}
          <button type="button" className={btn} onClick={onClose} disabled={busy}>
            {t("agents.common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
