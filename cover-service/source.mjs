export const API_ORIGIN = "https://huangguoai.com";
export const COVER_HOST = "pic.drleao.cn";
export const MAX_COVER_BYTES = 2_000_000;

export function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function coverUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (url.hostname !== COVER_HOST) return null;
  if (url.pathname.includes("\\") || url.pathname.split("/").includes("..")) return null;
  return url;
}

async function readLimited(response, max) {
  if (!response.body || typeof response.body.getReader !== "function") {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > max) throw fail(502, "cover too large");
    return buf;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > max) throw fail(502, "cover too large");
    chunks.push(Buffer.from(step.value));
  }
  return Buffer.concat(chunks);
}

export async function fetchCoverBytes(raw, fetchImpl = globalThis.fetch) {
  let current = coverUrl(raw);
  if (!current) throw fail(502, "cover source rejected");
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await fetchImpl(current.href, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: {
        Accept: "*/*",
        Referer: `${API_ORIGIN}/`,
        "User-Agent": "HGhubCover/0.3 (personal)",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      const next = location ? coverUrl(new URL(location, current).href) : null;
      if (!next) throw fail(502, "cover redirect rejected");
      current = next;
      continue;
    }
    if (response.status === 401 || response.status === 403) throw fail(403, "cover denied");
    if (response.status !== 200) throw fail(502, "cover unavailable");
    return readLimited(response, MAX_COVER_BYTES);
  }
  throw fail(502, "cover redirect rejected");
}

export async function resolveCover(id, fetchImpl = globalThis.fetch) {
  if (!/^[1-9]\d{0,8}$/.test(id)) throw fail(400, "bad id");
  const response = await fetchImpl(`${API_ORIGIN}/api/edge/request`, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(8_000),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Referer: `${API_ORIGIN}/`,
      "User-Agent": "HGhubCover/0.3 (personal)",
    },
    body: JSON.stringify({ method: "GET", path: `/api/videos/${id}`, body: "", content_type: "" }),
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) throw fail(502, "api redirect rejected");
  if (response.status === 401 || response.status === 403) throw fail(403, "api denied");
  if (response.status !== 200) throw fail(502, "api unavailable");
  const payload = await response.json();
  const cover = payload && payload.status === 1 ? payload.data && payload.data.cover : "";
  if (!coverUrl(cover)) throw fail(502, "cover source rejected");
  return cover;
}
