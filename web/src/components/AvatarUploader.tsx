import React, { useEffect, useRef, useState } from "react";
import { imagekitAuth, setAvatar } from "@/lib/profile";

type Props = {
  initialUrl?: string | null;
  onUploaded: (url: string) => void;
};

export default function AvatarUploader({ initialUrl, onUploaded }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);

  const SIZE = 240;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (!img) return;

    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const baseScale = Math.max(SIZE / iw, SIZE / ih);
    const s = baseScale * zoom;
    const w = iw * s;
    const h = ih * s;
    const x = SIZE / 2 + offset.x - w / 2;
    const y = SIZE / 2 + offset.y - h / 2;

    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, x, y, w, h);
  }, [img, zoom, offset]);

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => {
      setImg(im);
      setOffset({ x: 0, y: 0 });
      setZoom(1);
    };
    im.src = url;
  }

  function startDrag(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    setDragging(true);
  }
  function endDrag() { setDragging(false); }
  function move(e: React.MouseEvent | React.TouchEvent) {
    if (!dragging) return;
    const p = ("touches" in e ? e.touches[0] : e) as any;
    setOffset(o => ({ x: o.x + (p.movementX || 0), y: o.y + (p.movementY || 0) }));
  }

  async function upload() {
    if (!canvasRef.current) return;
    setBusy(true);
    try {
      const blob: Blob = await new Promise((res) =>
        canvasRef.current!.toBlob(b => res(b as Blob), "image/jpeg", 0.92)!
      );

      const { token, signature, expire, publicKey, folder } = await imagekitAuth();

      const form = new FormData();
      form.append("file", await blobToBase64(blob));
      form.append("fileName", `avatar_${Date.now()}.jpg`);
      form.append("token", token);
      form.append("signature", signature);
      form.append("expire", String(expire));
      if (publicKey) form.append("publicKey", publicKey);
      if (folder) form.append("folder", folder);

      const r = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
        method: "POST",
        body: form,
      });
      if (!r.ok) throw new Error("Falha no upload");
      const data = await r.json();
      const url = data?.url as string;
      if (!url) throw new Error("URL não retornada pelo ImageKit");

      await setAvatar(url);
      onUploaded(url);
      alert("Avatar atualizado!");
    } catch (e: any) {
      alert(e?.message || "Falha ao enviar avatar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="avatar-uploader">
      <div className="avatar-uploader__row">
        <div className="avatar-uploader__preview">
          <canvas
            ref={canvasRef}
            width={SIZE}
            height={SIZE}
            onMouseDown={startDrag}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
            onMouseMove={move}
            onTouchStart={startDrag}
            onTouchEnd={endDrag}
            onTouchMove={move}
          />
          {!img && initialUrl && <img src={initialUrl} alt="" className="avatar-uploader__placeholder" />}
          {!img && !initialUrl && <div className="avatar-uploader__placeholder empty">Sem imagem</div>}
        </div>

        <div className="avatar-uploader__controls">
          <div className="field">
            <label>Imagem</label>
            <input ref={fileRef} type="file" accept="image/*" onChange={pickFile} />
          </div>
          <div className="field">
            <label>Zoom</label>
            <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          </div>
          <div className="muted">Arraste para posicionar. O recorte final é quadrado.</div>
          <div className="actions">
            <button className="primary" disabled={!img || busy} onClick={upload}>
              {busy ? "Enviando…" : "Salvar avatar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

async function blobToBase64(b: Blob): Promise<string> {
  const buf = await b.arrayBuffer();
  const bin = String.fromCharCode(...new Uint8Array(buf));
  return `data:image/jpeg;base64,${btoa(bin)}`;
}
