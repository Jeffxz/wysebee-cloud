import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

/**
 * An (i) that says more: help kept out of the way of a field. Its text shows on hover, on
 * focus and on a click (a tap, on a phone), and goes on a click elsewhere, Escape, or when the
 * pointer or focus leaves. A button of its own, so a click on it inside a field's <label>
 * opens it instead of focusing the field.
 */
export function Hint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span ref={box} className="relative inline-flex shrink-0" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="inline-flex cursor-help rounded-full text-stone-400 hover:text-stone-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:text-stone-200"
        aria-label={text}
        aria-expanded={open}
        onClick={(e) => {
          // Inside a <label>: open the hint, never focus or toggle the field. (Opened, not
          // toggled: the press has focused it, which opened it already.)
          e.preventDefault();
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <Info size={16} aria-hidden />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-full z-30 mt-1.5 w-72 max-w-[80vw] -translate-x-1/2 rounded-md border border-stone-200 bg-white px-3 py-2 text-xs font-normal leading-relaxed text-stone-700 shadow-lg dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
        >
          {text}
        </span>
      )}
    </span>
  );
}
