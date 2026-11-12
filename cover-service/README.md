# 自管 Linux 封面服务

这是演示用的签名 PNG 服务，不是 HGhub 海报解密。0.2.1 播放模块没有改。密文封面适配器没有接上。

本地检查：

```bash
node cover-service/test.mjs
```

启动前要自己填两个空项，脚本不会替你写域名：

```bash
export COVER_PUBLIC_ORIGIN='https://你的子域名'
export PORT=8787
sh cover-service/bin/cover-start.sh
sh cover-service/bin/cover-health.sh
COVER_PUBLIC_ORIGIN="$COVER_PUBLIC_ORIGIN" COVER_SIGNING_SECRET="$(cat cover-service/run/secret)" sh cover-service/bin/cover-sign.sh
sh cover-service/bin/cover-stop.sh
```

`cover-sign.sh` 的标准输出只有一行 URL。密钥在 `run/secret`，不进入仓库。

停服用 `cover-stop.sh`。若安装时保留了上一份目录，把 `COVER_ROOT` 指到含 `current` 符号链接和 `previous` 目录的位置，再执行 `cover-rollback.sh`。systemd 单元和 nginx `location` 模板在 `deploy/`。把 `__INSTALL_DIR__` 和 `__COVER_SERVER_NAME__` 换成这台机器上的真实值，并沿用现有的 TLS，不另装一套。这些模板没有在 systemd 或公网证书上运行过。

上线前只需要三样已经存在的事实：能登录的目标主机、要挂上的 HTTPS 子域名，以及仍然缺少的合法明文封面输出。没有第三样时，服务只能发这张演示 PNG。
