import { listen } from "./server.mjs";
import { createCoverApp } from "./server.mjs";
import { loadFormatMaterial } from "./decode.mjs";
import { verifyJpeg } from "./image.mjs";

const secret = "live-sample-secret-16";
const material = loadFormatMaterial(new URL("../src-tauri/src/media.rs", import.meta.url));
const app = createCoverApp({ secret, material });
const server = await listen(app, 0);
const port = server.address().port;
let summary;
try {
  const response = await fetch(`http://127.0.0.1:${port}/v1/v/12.png`);
  const body = Buffer.from(await response.arrayBuffer());
  const image = response.status === 200 ? verifyJpeg(body) : null;
  summary = {
    id: 12,
    status: response.status,
    type: response.headers.get("content-type"),
    format: image && image.format,
    width: image && image.width,
    height: image && image.height,
    bytes: body.length,
  };
  if (response.status !== 200 || !image || image.width < 1 || image.height < 1) process.exitCode = 2;
} finally {
  server.close();
}
console.log(JSON.stringify(summary));
