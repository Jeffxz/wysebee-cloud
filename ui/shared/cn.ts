import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class lists, de-duplicating conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Shared utility-class strings for primitives reused across many components.
// These are plain Tailwind utilities (not semantic CSS), kept here so the look
// stays consistent without copy-pasting long class lists.

export const btn =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700";

export const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-primary-700 bg-primary-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50";

/** Clickable surface card used by the list views. */
export const card =
  "block w-full rounded-lg border border-stone-200 bg-white p-3.5 text-left transition-colors hover:border-stone-400 dark:border-stone-700 dark:bg-stone-800 dark:hover:border-stone-500";

/** Static (non-clickable) surface card. */
export const surface =
  "rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800";

export const inputBase =
  "w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-stone-800 outline-none focus:border-primary-600 focus:ring-1 focus:ring-primary-600 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100";

export const codeBlock =
  "my-1 overflow-x-auto whitespace-pre-wrap wrap-break-word rounded-md bg-black/5 p-2 font-mono text-xs dark:bg-white/10";

export const muted = "text-stone-500 dark:text-stone-400";

/** Two-column key/value row used by the detail views. */
export const kvRow = "my-1 grid grid-cols-[110px_1fr] gap-1.5 text-xs";
export const kvKey = "font-semibold text-stone-500 dark:text-stone-400";

export const loading = "p-4 text-center text-stone-500 dark:text-stone-400";

export const errorBanner =
  "mb-3 rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-red-700 dark:text-red-300";

