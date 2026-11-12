import { lookup } from "node:dns/promises";
import https from "node:https";
import { BlockList, isIP } from "node:net";

export const API_ORIGIN = "https://huangguoai.com";
export const COVER_HOST = "pic.drleao.cn";
export const MAX_COVER_BYTES = 2_000_000;

const blockedAddresses = new BlockList();
for (const [subnet, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) blockedAddresses.addSubnet(subnet, prefix, "ipv4");
blockedAddresses.addAddress("255.255.255.255", "ipv4");
blockedAddresses.addAddress("::", "ipv6");
blockedAddresses.addAddress("::1", "ipv6");
blockedAddresses.addSubnet("fc00::", 7, "ipv6");
blockedAddresses.addSubnet("fe80::", 10, "ipv6");
blockedAddresses.addSubnet("ff00::", 8, "ipv6");

export function isPublicAddress(address) {
  if (typeof address !== "string") return false;
  const text = address.trim().toLowerCase();
  if (text.startsWith("::ffff:")) return isPublicAddress(text.slice(7));
  const family = isIP(text);
  if (family === 0) return false;
  return !blockedAddresses.check(text, family === 4 ? "ipv4" : "ipv6");
}

export async function resolvePublicAddresses(hostname, resolveImpl = lookup) {
  const records = await resolveImpl(hostname, { all: true, verbatim: true });
  const addresses = (Array.isArray(records) ? records : [records])
    .map((record) => (typeof record === "string" ? record : record.address))
    .filter(Boolean);
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) {
    throw fail(502, "cover address rejected");
  }
  return addresses;
}

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

const coverHeaders = {
  Accept: "*/*",
  Referer: `${API_ORIGIN}/`,
  "User-Agent": "HGhubCover/0.3 (personal)",
};

function pinnedRequest(url, address) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: address,
      servername: url.hostname,
      family: address.includes(":") ? 6 : 4,
      method: "GET",
      path: `${url.pathname}${url.search}`,
      headers: { ...coverHeaders, Host: url.hostname },
      timeout: 8_000,
    }, (response) => {
      const chunks = [];
      let total = 0;
      response.on("data", (chunk) => {
        total += chunk.length;
        if (total > MAX_COVER_BYTES) {
          req.destroy();
          reject(fail(502, "cover too large"));
        } else {
          chunks.push(chunk);
        }
      });
      response.on("end", () => {
        if (total > MAX_COVER_BYTES) return;
        const location = response.headers.location;
        resolve({
          status: response.statusCode,
          headers: { get: (name) => (name.toLowerCase() === "location" ? (Array.isArray(location) ? location[0] : location || null) : null) },
          arrayBuffer: async () => Buffer.concat(chunks),
        });
      });
    });
    req.on("error", () => reject(fail(502, "cover unavailable")));
    req.on("timeout", () => {
      req.destroy();
      reject(fail(502, "cover unavailable"));
    });
    req.end();
  });
}

export async function fetchCoverBytes(raw, fetchImpl = globalThis.fetch, resolveImpl) {
  let current = coverUrl(raw);
  if (!current) throw fail(502, "cover source rejected");
  const checkAddress = Boolean(resolveImpl) || fetchImpl === globalThis.fetch;
  const resolver = resolveImpl || resolvePublicAddresses;
  for (let hop = 0; hop < 3; hop += 1) {
    let pinned = "";
    if (checkAddress) {
      const addresses = await resolver(current.hostname);
      if (!Array.isArray(addresses) || !addresses.length || addresses.some((address) => !isPublicAddress(address))) {
        throw fail(502, "cover address rejected");
      }
      pinned = addresses[0];
    }
    const response = fetchImpl === globalThis.fetch
      ? await pinnedRequest(current, pinned)
      : await fetchImpl(current.href, { pinned });
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

export async function resolveCover(id, fetchImpl = globalThis.fetch, resolveImpl) {
  if (!/^[1-9]\d{0,8}$/.test(id)) throw fail(400, "bad id");
  if (fetchImpl === globalThis.fetch) {
    await resolvePublicAddresses(new URL(API_ORIGIN).hostname, resolveImpl || lookup);
  }
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
