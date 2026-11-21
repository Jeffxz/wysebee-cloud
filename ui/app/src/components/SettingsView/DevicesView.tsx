import { useTranslation } from "react-i18next";
import { cn, muted } from "@shared/cn";
import { BrowsersSection } from "./BrowsersSection";
import { DesktopsSection } from "./DesktopsSection";

/**
 * **Devices** on the rail (`#/devices`, 2026-11-04): Wysebee Cloud and the devices where the
 * person's agents run — the Macs paired with Wysebee Agent for Mac, each paired and unpaired
 * here — then the
 * **browsers** paired with the Wysebee Agent extension (2026-11-11), each with its own agent,
 * paired and unpaired here. `onOpenAgent` opens an agent's settings (one just paired);
 * `onOpenDevice` a device's page (2026-11-20; the Devices menu, DevicesNav, opens them too).
 */
export function DevicesView({ onOpenAgent, onOpenDevice }: { onOpenAgent: (name: string) => void; onOpenDevice: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="max-w-4xl">
      <p className={cn(muted, "mb-4 text-xs")}>{t("settings.connections.intro")}</p>
      <DesktopsSection onOpenAgent={onOpenAgent} onOpenDevice={onOpenDevice} />
      <BrowsersSection onOpenAgent={onOpenAgent} onOpenDevice={onOpenDevice} />
    </div>
  );
}
