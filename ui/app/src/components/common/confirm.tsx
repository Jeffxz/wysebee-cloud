import { useEffect, useId, useRef } from "react";
import { createRoot } from "react-dom/client";
import { btn, btnPrimary, cn } from "@shared/cn";
import i18n from "../../i18n";

/** What the confirming button says: "OK" unless the question is about deleting or discarding. */
export type ConfirmAction = "ok" | "delete" | "discard" | "leave" | "disconnect" | "unpair";

export type ConfirmOptions = {
  /** The confirming button's word; also makes it red unless `ok`. */
  action?: ConfirmAction;
};

const danger = "border-red-700 bg-red-700 hover:bg-red-800";

function ConfirmDialog({ message, action, onDone }: { message: string; action: ConfirmAction; onDone: (yes: boolean) => void }) {
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Something that cannot be undone starts on Cancel, so a stray Enter keeps it.
    (action === "ok" ? yes : cancel).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDone(false);
      } else if (e.key === "Tab") {
        // Keep focus on the two buttons while the dialog is open.
        e.preventDefault();
        (document.activeElement === yes.current ? cancel : yes).current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [action, onDone]);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={() => onDone(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-describedby={id}
        className="flex w-full max-w-md flex-col gap-4 rounded-xl bg-white p-5 text-stone-900 shadow-xl dark:bg-stone-800 dark:text-stone-100"
        onClick={(e) => e.stopPropagation()}
      >
        <p id={id} className="whitespace-pre-line text-sm">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button ref={cancel} type="button" className={btn} onClick={() => onDone(false)}>
            {i18n.t("common.confirm.cancel")}
          </button>
          <button ref={yes} type="button" className={cn(btnPrimary, action !== "ok" && danger)} onClick={() => onDone(true)}>
            {i18n.t(`common.confirm.${action}`)}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The app's own confirmation, in place of the browser's `window.confirm` (which shows the
 * site's address and cannot be styled): a modal asking `message`, resolving `true` when the
 * person confirms and `false` on Cancel, Escape or a click outside. It mounts itself, so it
 * works from anywhere, with no provider. Focus goes back where it was afterwards.
 *
 * Called as `dialogs.confirm(...)` so tests can stub it (`vi.spyOn(dialogs, "confirm")`).
 */
export const dialogs = {
  confirm(message: string, { action = "ok" }: ConfirmOptions = {}): Promise<boolean> {
    return new Promise((resolve) => {
      // The page body at least is always focused.
      const opener = document.activeElement as HTMLElement;
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      let answered = false;
      const done = (yes: boolean) => {
        if (answered) return;
        answered = true;
        resolve(yes);
        // Not from inside the dialog's own event: unmount once it has returned.
        queueMicrotask(() => {
          root.unmount();
          host.remove();
          opener.focus();
        });
      };
      root.render(<ConfirmDialog message={message} action={action} onDone={done} />);
    });
  },
};
