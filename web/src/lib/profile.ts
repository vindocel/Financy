export async function imagekitAuth(): Promise<{ token: string; signature: string; expire: number; publicKey?: string; folder?: string; }> {
  const endpoint = (import.meta as any).env?.VITE_IMAGEKIT_AUTH_ENDPOINT || "/api/imagekit/auth";
  const res = await fetch(endpoint, { method: "GET", credentials: "include", headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error("Falha ao obter credenciais do ImageKit");
  return res.json();
}

export async function setAvatar(url: string): Promise<void> {
  const res = await fetch("/api/me", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ avatar_url: url }),
  });
  if (!res.ok) throw new Error("Falha ao salvar avatar");
}
