import { ACTIVITY_CHANGED, fetchNotifications, fetchUnreadNotifications } from "./api";
import { agentsNow } from "./agents";

/**
 * Browser notifications for Activity (2026-11-15): while the person has them on (the switch on
 * the Activity page, remembered in this browser) and the browser allows them, a notification
 * their AI app sends shows as a system notification when this tab is not in front — named for
 * its agent, with its title and the start of its text. Clicking one brings Wysebee forward on
 * Activity. Driven by the change feed's unread count (`ACTIVITY_CHANGED`), so nothing polls; a
 * notification's id is its tag, so two open tabs show it once.
 */
const KEY = "activityBrowserNotifications";
/** At most this many shown at once, when several came together. */
const MAX_AT_ONCE = 5;
const BODY_MAX = 180;

export function browserNotifySupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    // Storage blocked: off.
    return false;
  }
}

function store(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Storage blocked: it stays as it was.
  }
}

/** On: asked for here, and allowed by the browser. */
export function browserNotifyOn(): boolean {
  return browserNotifySupported() && Notification.permission === "granted" && stored();
}

/** Ask the browser (once it is asked, it answers from the person's choice), and remember. */
export async function turnOnBrowserNotify(): Promise<NotificationPermission> {
  const permission = await Notification.requestPermission();
  store(permission === "granted");
  return permission;
}

export function turnOffBrowserNotify(): void {
  store(false);
}

/** Markdown as one line of plain text, cut short. */
export function plain(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > BODY_MAX ? `${text.slice(0, BODY_MAX - 1)}…` : text;
}

let last: number | null = null;

async function announce(count: number, open: () => void): Promise<void> {
  const { notifications } = await fetchNotifications(Math.min(count, MAX_AT_ONCE));
  for (const n of notifications.filter((x) => !x.read).reverse()) {
    const agent = n.agent ? agentsNow()?.find((a) => a.name === n.agent) : undefined;
    const shown = new Notification(agent?.label ?? (n.agent ? `@${n.agent}` : "Wysebee"), {
      body: [n.title, plain(n.body)].filter(Boolean).join("\n"),
      tag: n.id,
      icon: "/app/icon.png",
    });
    shown.onclick = () => {
      window.focus();
      open();
      shown.close();
    };
  }
}

/** Listen for the life of the page; `open` shows the Activity page. Answers how to stop. */
export function startBrowserNotify(open: () => void): () => void {
  let alive = true;
  fetchUnreadNotifications().then(
    (r) => {
      if (alive && last === null) last = r.unread;
    },
    () => {},
  );
  const changed = (e: Event) => {
    const unread = (e as CustomEvent<{ unread: number }>).detail.unread;
    const came = unread - (last ?? unread);
    last = unread;
    if (came <= 0 || !browserNotifyOn()) return;
    // In front: the badge says it already.
    if (document.visibilityState === "visible" && document.hasFocus()) return;
    announce(came, open).catch(() => {});
  };
  window.addEventListener(ACTIVITY_CHANGED, changed);
  return () => {
    alive = false;
    last = null;
    window.removeEventListener(ACTIVITY_CHANGED, changed);
  };
}
