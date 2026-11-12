// 可选映射：只接受调用方已经拿到的 https 签名地址。不包含服务密钥，也不接 HGhub。
export function optionalPoster(signedUrl) {
  let url;
  try { url = new URL(signedUrl); } catch { return {}; }
  if (url.protocol !== "https:") return {};
  if (!url.searchParams.get("exp") || !url.searchParams.get("sig")) return {};
  return { posterPath: url.toString() };
}
