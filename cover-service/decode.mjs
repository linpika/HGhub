import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";

export function formatMaterial(source) {
  const key = /const IMG_KEY: &\[u8\] = b"([^"]+)";/.exec(source);
  const iv = /const IMG_IV: &\[u8\] = b"([^"]+)";/.exec(source);
  if (!key || !iv || Buffer.byteLength(key[1]) !== 16 || Buffer.byteLength(iv[1]) !== 16) {
    throw new Error("media format material missing");
  }
  return { key: Buffer.from(key[1], "utf8"), iv: Buffer.from(iv[1], "utf8") };
}

export function loadFormatMaterial(path) {
  return formatMaterial(readFileSync(path, "utf8"));
}

function kind(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  return "";
}

function unpad(buf) {
  if (!buf.length) return null;
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 16 || pad > buf.length) return null;
  for (let i = 0; i < pad; i += 1) {
    if (buf[buf.length - 1 - i] !== pad) return null;
  }
  return buf.subarray(0, buf.length - pad);
}

export function decodeCover(bytes, material) {
  if (kind(bytes) === "image/jpeg") return Buffer.from(bytes);
  if (!bytes.length || bytes.length % 16 !== 0) return null;
  const decipher = createDecipheriv("aes-128-cbc", material.key, material.iv);
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(bytes), decipher.final()]);
  const plain = unpad(padded);
  if (!plain || kind(plain) !== "image/jpeg") return null;
  return Buffer.from(plain);
}
