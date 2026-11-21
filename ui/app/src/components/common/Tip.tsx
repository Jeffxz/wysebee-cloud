/**
 * A tooltip for an icon-only button, shown at once on hover or keyboard focus — unlike the
 * browser's `title`, which waits a second and never shows on a disabled button. Put it inside
 * the button, which needs `relative group` and its own `aria-label` (this is only for the eye).
 */
export function Tip({ text }: { text: string }) {
  return (
    <span
      aria-hidden
      data-tip
      className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-stone-900 px-1.5 py-0.5 text-xs font-normal text-white opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-stone-100 dark:text-stone-900"
    >
      {text}
    </span>
  );
}
