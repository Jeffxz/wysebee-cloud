import { UserRound } from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";

/** The first letter of a name, for a picture-less avatar. */
export const initialOf = (name: string) => name.trim().charAt(0).toUpperCase();

/**
 * The person's picture (profile.ts): their image or emoji, else their initial, else a
 * person icon. On their chat messages, the rail and the Profile page.
 */
export function PersonAvatar({ avatar, name, size = 36, className }: { avatar?: string | null; name: string; size?: number; className?: string }) {
  const initial = initialOf(name);
  return (
    <AgentAvatar
      avatar={avatar}
      label={name}
      size={size}
      className={className}
      fallback={
        <span className="flex h-full w-full items-center justify-center bg-primary-100 font-semibold text-primary-700 dark:bg-primary-900 dark:text-primary-200" style={{ fontSize: Math.round(size * 0.4) }}>
          {initial || <UserRound size={Math.round(size / 2)} aria-hidden />}
        </span>
      }
    />
  );
}
