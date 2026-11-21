import { useMemo } from "react";
import qrcode from "qrcode-generator";

/** The modules (dark squares) of `text`'s QR code, error correction M, the smallest version
 * that holds it: a row of booleans per module row. */
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => qr.isDark(y, x)));
}

/** `text` as a QR code: black on white whatever the theme (a camera reads it best so), with
 * the standard four-module quiet zone, drawn as one path. */
export function QrCode({ text, label, size = 184 }: { text: string; label: string; size?: number }) {
  const modules = useMemo(() => qrModules(text), [text]);
  const quiet = 4;
  const span = modules.length + quiet * 2;
  const d = modules.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x + quiet} ${y + quiet}h1v1h-1z`] : []))).join("");
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${span} ${span}`} shapeRendering="crispEdges" className="rounded-md">
      <rect width={span} height={span} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
