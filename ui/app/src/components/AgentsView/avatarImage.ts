import i18n from "../../i18n";

// Downscale a picked image file to a small square data URI for use as an agent
// avatar. Cover-fits into a `size`x`size` canvas and re-encodes as JPEG so the
// stored string stays small (avatars live inline in the agent's config blob).
export async function downscaleImageToDataUrl(
  file: File,
  size = 96,
  quality = 0.85,
): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(i18n.t("agents.avatar.readFailed")));
      el.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(i18n.t("agents.avatar.canvasUnavailable"));

    // Cover-fit: scale so the shorter side fills the square, center-crop the rest.
    const scale = Math.max(size / img.width, size / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
