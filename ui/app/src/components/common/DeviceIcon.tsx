import { Cloud, MonitorSmartphone, Server, Smartphone } from "lucide-react";

export type DeviceKind = "mac" | "windows" | "linux" | "android" | "ios" | "cloud" | "chrome" | "other";

// A paired device's agent type key (`paired_kind`) → how it shows.
const TYPES: Record<string, { name: string; kind: DeviceKind }> = {
  "wysebee-browser-chrome": { name: "Browser extension", kind: "chrome" },
  "wysebee-osx": { name: "Mac", kind: "mac" },
  "wysebee-windows": { name: "Windows PC", kind: "windows" },
  "wysebee-linux": { name: "Linux machine", kind: "linux" },
  "wysebee-android": { name: "Android phone", kind: "android" },
};

/** The device an agent works on, to show: by its paired device's type (`device`, the type key),
 * or, for an agent from before types, the browser extension's browser (`browser`); none for any
 * other, which lives in Wysebee Cloud. */
export function agentDevice(browser = false, device?: string | null): { name: string; kind: DeviceKind } | null {
  return (device && TYPES[device]) || (browser ? TYPES["wysebee-browser-chrome"] : null);
}

// lucide has no brand marks, so the three systems' are drawn here, in the text's colour.
const MARKS: Partial<Record<DeviceKind, string>> = {
  mac: "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701",
  windows: "M0 3.449 9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801",
  chrome: "M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257c.206.01.413.016.621.016 6.627 0 12-5.373 12-12 0-1.54-.29-3.011-.818-4.364zM12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728Z",
  // The robot's head with its eyes cut out, and its antennae.
  android: "M2 19a10 10 0 0 1 20 0ZM7.5 14a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5ZM16.5 14a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5ZM6.2 4.6l1-.6 2.3 4-1 .6ZM17.8 4.6l-1-.6-2.3 4 1 .6Z",
};
// A Linux machine is often a server or a cloud VM: drawn as one.
const OUTLINES = { ios: Smartphone, cloud: Cloud, linux: Server, other: MonitorSmartphone };

/** A device's kind as an icon, its name shown on hover. */
export function DeviceIcon({ name, kind, size = 15, tone = "text-stone-500 dark:text-stone-400" }: { name: string; kind: DeviceKind; size?: number; tone?: string }) {
  const mark = MARKS[kind];
  const Outline = OUTLINES[kind as keyof typeof OUTLINES];
  return (
    <span className={`inline-flex shrink-0 ${tone}`} title={name} role="img" aria-label={name} data-device-kind={kind}>
      {mark ? (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden>
          <path d={mark} />
        </svg>
      ) : (
        <Outline size={size} aria-hidden />
      )}
    </span>
  );
}
