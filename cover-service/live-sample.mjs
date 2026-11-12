import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createCoverApp, listen } from "./server.mjs";
import { loadFormatMaterial } from "./decode.mjs";
import { verifyJpeg } from "./image.mjs";
import { mediaSourcePath } from "./paths.mjs";
import { fetchCoverBytes, resolveCover } from "./source.mjs";

const id = "12";
const secret = "live-sample-secret-16";
const checkedAt = new Date().toISOString();
const material = loadFormatMaterial(mediaSourcePath());
let guestStatus = 0;
let coverStatus = 0;
let restored = Buffer.alloc(0);
try {
  const guest = await fetch("https://huangguoai.com/api/edge/request", {
    method: "POST",
    redirect: "manual",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Referer: "https://huangguoai.com/",
    },
    body: JSON.stringify({ method: "GET", path: `/api/videos/${id}`, body: "", content_type: "" }),
  });
  guestStatus = guest.status;
  if (guestStatus === 401 || guestStatus === 403) throw new Error("guest access denied");
  const payload = await guest.json();
  if (!payload || payload.status !== 1 || !payload.data || typeof payload.data.cover !== "string") {
    throw new Error("guest cover missing");
  }
  const response = await fetch(payload.data.cover, {
    redirect: "manual",
    headers: { Accept: "*/*", Referer: "https://huangguoai.com/" },
  });
  coverStatus = response.status;
  if (coverStatus === 401 || coverStatus === 403) throw new Error("cover access denied");
  if (coverStatus !== 200) throw new Error("cover unavailable");
  const raw = Buffer.from(await response.arrayBuffer());
  const { decodeCover } = await import("./decode.mjs");
  const plain = decodeCover(raw, material);
  if (!plain) throw new Error("cover did not restore");
  restored = Buffer.from(plain);
} catch (error) {
  const denied = /access denied/.test(String(error && error.message));
  console.log(JSON.stringify({
    checkedAt,
    id: Number(id),
    guestHttpStatus: guestStatus,
    coverHttpStatus: coverStatus,
    stopped: denied ? "upstream denied" : "unavailable",
    imageStored: false,
    offlineReproduction: false,
  }));
  process.exit(denied ? 3 : 2);
}

const decoded = verifyJpeg(restored);
const directory = mkdtempSync(join(tmpdir(), "cover-"));
const imagePath = join(directory, "sample.jpg");
let independent = { command: "", output: "", status: 1 };
try {
  writeFileSync(imagePath, restored);
  const ran = spawnSync("python3", ["-c", "from PIL import Image; import sys; image=Image.open(sys.argv[1]); image.load(); print(image.format, image.size[0], image.size[1])", imagePath], { encoding: "utf8" });
  independent = {
    command: "python3 -c 'from PIL import Image; image=Image.open(path); image.load(); print(image.format, image.size[0], image.size[1])'",
    output: `${ran.stdout || ""}${ran.stderr || ""}`.trim(),
    status: ran.status ?? 1,
  };
  if (ran.status !== 0) process.exitCode = 2;
} finally {
  rmSync(directory, { recursive: true, force: true });
}

const app = createCoverApp({ secret, material, resolveCover, fetchCover: fetchCoverBytes });
const server = await listen(app, 0);
const port = server.address().port;
let signedStatus = 0;
let unsignedStatus = 0;
let serviceSha = "";
try {
  const signed = new URL(app.sign(id, 240, "https://img-2c812d1bf79fee03e88d.linpika.com"));
  const signedResponse = await fetch(`http://127.0.0.1:${port}${signed.pathname}${signed.search}`);
  signedStatus = signedResponse.status;
  const signedBody = Buffer.from(await signedResponse.arrayBuffer());
  if (signedStatus === 200) serviceSha = createHash("sha256").update(signedBody).digest("hex");
  unsignedStatus = (await fetch(`http://127.0.0.1:${port}/v1/v/${id}.png`)).status;
} finally {
  server.close();
}
const restoredSha = createHash("sha256").update(restored).digest("hex");
const summary = {
  checkedAt,
  id: Number(id),
  guestHttpStatus: guestStatus,
  coverHttpStatus: coverStatus,
  restoredSha256: restoredSha,
  format: decoded && decoded.format,
  width: decoded && decoded.width,
  height: decoded && decoded.height,
  bytes: restored.length,
  independentDecoder: independent,
  signedServiceStatus: signedStatus,
  signedServiceSha256: serviceSha,
  unsignedServiceStatus: unsignedStatus,
  imageStored: false,
  offlineReproduction: false,
};
if (!decoded || independent.status !== 0 || signedStatus !== 200 || serviceSha !== restoredSha || unsignedStatus !== 403) {
  process.exitCode = 2;
}
console.log(JSON.stringify(summary));
