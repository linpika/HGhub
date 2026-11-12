# 自管封面服务

个人非商业使用。服务只向 `https://huangguoai.com/api/edge/request` 取游客详情，只下载主机名为 `pic.drleao.cn` 的封面，再用仓库里已有的图片格式处理把它还原成 JPEG。它不接收任意 URL，不携带登录凭据，401/403 直接失败。图片权利不因代码许可证而改变。

Rex 模块 0.2.2 的 `posterPath` 是：

```text
https://img-2c812d1bf79fee03e88d.linpika.com/v1/v/{编号}.png
```

播放链路仍是 0.2.1 的游客接口。

离线检查和真实样本要分开跑：

```bash
node cover-service/test.mjs
node cover-service/live-sample.mjs
node rex/test-widget.mjs
```

`test.mjs` 不访问网络。`live-sample.mjs` 只处理编号 12 的一张封面，并打印解码后的格式和尺寸。这两项都不是 Rex 真机验收。

这台机器没有 Node 和 nginx。80 与 8443 已由 Caddy 使用，443 已由 xray 使用。部署文件只把容器发布到 `127.0.0.1:8787`：

```bash
sh cover-service/deploy/cover-up.sh
sh cover-service/deploy/cover-rollback.sh
```

`deploy/caddy-snippet.caddy` 要放进现有站点，不能新监听上述端口。Docker 镜像、公网 TLS 和 Rex 真机都还没有在这里跑过。
