# 封面服务骨架

独立的本地签名图片服务。默认不接入 0.2.1，因此不会假装 HGhub 海报已经出现。HGhub 密文适配器没有实现，源码里也没有应用密钥。

选择 Node 而不是 Workers：本地用 Node 自带的 `http`、`crypto`、`zlib` 就能测签名、缓存和限流，不必再装 Wrangler。Workers 文档里的 AES-CBC 只有在获得授权解密之后才用得上。

## 运行

密钥只从环境变量读入，不要写进命令历史以外的文件：

```bash
COVER_SIGNING_SECRET='至少十六个字符的运行时密钥' node cover-service/server.mjs
```

进程只监听本机。测试：

```bash
node cover-service/test.mjs
```

`optionalPoster` 只接受已经签好的 `https://` 地址，并返回 `{ posterPath }`。0.2.1 没有调用它。真机已经确认普通 HTTPS 的 `coverUrl` 和 `posterPath` 都能出图；data URL 不再使用。

## 上线前仍要确认

- 部署平台和域名。Cloudflare Workers 或自管 Linux 都可以，但本仓库没有替你部署。
- 允许的图片来源。现在只有程序内生成的 `demo`。HGhub 封面要等作者提供明文图片输出，或另有写明的解密依据。
- 对外必须是 HTTPS。本地测试使用 `http://127.0.0.1`，不等于已经上线。
- 把签好的 URL 放进 Rex 后，还要在真机看这一条带查询串的地址。现有真机结果只覆盖了不带本服务签名的普通 HTTPS 图片。
