import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const jpeg = require("jpeg-js");

export function verifyJpeg(bytes) {
  let image;
  try {
    image = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 20, maxMemoryUsageInMB: 64 });
  } catch {
    return null;
  }
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height)) return null;
  if (image.width < 1 || image.height < 1) return null;
  if (!image.data || image.data.length < image.width * image.height * 4) return null;
  return { format: "jpeg", width: image.width, height: image.height };
}

export function sampleJpeg(width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 20;
    data[i + 1] = 80;
    data[i + 2] = 140;
    data[i + 3] = 255;
  }
  return jpeg.encode({ data, width, height }, 90).data;
}
