import { existsSync } from "node:fs";

export function mediaSourcePath() {
  if (process.env.MEDIA_SOURCE) return process.env.MEDIA_SOURCE;
  const candidates = [
    new URL("./.build/media.rs", import.meta.url),
    new URL("../src-tauri/src/media.rs", import.meta.url),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("media format material missing");
}

export function widgetSourcePath() {
  const candidates = [
    new URL("./rex/hghub.widget.js", import.meta.url),
    new URL("../rex/hghub.widget.js", import.meta.url),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("widget missing");
}
