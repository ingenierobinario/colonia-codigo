import { Button, Icons } from "@colonia/ui";
import { useRef, useState } from "react";
import { setSurfaceFlags } from "../data/actions.ts";
import { useT } from "../i18n/index.ts";

export function ArtifactLogo({ logo }: { logo?: string | undefined }) {
  return logo ? <img src={logo} width={18} height={18} alt="" /> : <Icons.LayoutGrid size={16} />;
}

async function thumbnail(file: File): Promise<string> {
  if (file.size > 8_000_000 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error();
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    for (const size of [48, 32]) {
      canvas.width = canvas.height = size;
      const scale = size / Math.max(bitmap.width, bitmap.height);
      const width = bitmap.width * scale;
      const height = bitmap.height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error();
      ctx.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
      const png = canvas.toDataURL("image/png");
      if (png.length <= 8192) return png;
    }
    throw new Error();
  } finally {
    bitmap.close();
  }
}

export function ArtifactLogoEditor({ id, logo }: { id: string; logo?: string | undefined }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function change(file?: File) {
    setBusy(true);
    setError(false);
    try {
      await setSurfaceFlags(id, { logo: file ? await thumbnail(file) : null });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="artprops__logo">
      <ArtifactLogo logo={logo} />
      <Button disabled={busy} onClick={() => input.current?.click()}>
        {t("artifact.logo.change")}
      </Button>
      {logo && (
        <Button disabled={busy} onClick={() => void change()}>
          {t("artifact.logo.clear")}
        </Button>
      )}
      <input
        type="file"
        hidden
        ref={input}
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) void change(file);
        }}
      />
      {error && <span role="alert">{t("artifact.logo.error")}</span>}
    </div>
  );
}
