import { useEffect, useState } from "react";
import { ACTIVITY_CHANGED, fetchUnreadNotifications } from "./api";

/**
 * How many of the person's notifications they have not seen (apps/cloud/notifications.py), for
 * the rail's Activity badge: read when shown and when the window comes back, then kept current
 * by the change feed (`event: activity`, cloud/events.ts) and by Activity reading them — both
 * as `ACTIVITY_CHANGED` with `{unread}`. No polling.
 */
export function useUnread(): number {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchUnreadNotifications().then(
        (r) => alive && setUnread(r.unread),
        // Offline or signed out: the badge stays as it was.
        () => {},
      );
    };
    const changed = (e: Event) => setUnread((e as CustomEvent<{ unread: number }>).detail.unread);
    load();
    window.addEventListener(ACTIVITY_CHANGED, changed);
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.removeEventListener(ACTIVITY_CHANGED, changed);
      window.removeEventListener("focus", load);
    };
  }, []);
  return unread;
}
