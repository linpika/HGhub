# 自管封面服务

个人非商业使用。服务只向游客接口取封面，只下载 `pic.drleao.cn` 的公网地址，并复用客户端已有的图片格式处理。无签名、空查询、过期或错误签名都返回 403，而且发生在读取缓存之前。401/403 不换地址。

公开模块 `rex/hghub.widget.js` 里的 `COVER_SIGNING_SECRET` 必须保持空字符串。未配置时不返回 `posterPath`，播放请求保持原样。不要把密钥提交进仓库，也不要开放匿名签发接口。

私有副本的配置：

1. 在服务器上让容器把密钥写进卷里的 `/data/secret`。部署脚本不会打印它。
2. 复制一份模块到仓库以外，只在那份副本里把 `var COVER_SIGNING_SECRET = "";` 换成与 `/data/secret` 相同的值。
3. 把这份私有副本导入 Rex。公开的 raw 链接仍然没有海报。

签名有效期约 4 分钟。Rex 若缓存列表更久，海报地址会过期，需要重新打开列表。

解开本包后：

```bash
npm ci
npm test
umask 077
mkdir -p run
openssl rand -base64 32 | tr -d '\n' > run/secret
COVER_SIGNING_SECRET="$(cat run/secret)" COVER_PUBLIC_ORIGIN='https://img-2c812d1bf79fee03e88d.linpika.com' sh bin/cover-sign.sh 12
```

`npm test` 不访问网络。真实封面要用 `node live-sample.mjs`，它会写脱敏记录，不保存图片。记录不能用来离线复原那张图。

## 部署

默认不启动。80、443、8443 不会被占用，也不会改现有的 Caddy 或 xray。

反代若和封面服务不在同一网络命名空间，容器里的 `127.0.0.1:8787` 不是宿主机。两条路径都要自己选，并且 `TRUST_PROXY` 必须是反代的一个精确地址。缺了它，脚本会失败，避免所有人挤进同一个每分钟 30 次的计数。

宿主机网络，或反代本身也使用 host 网络：

```bash
COVER_NETWORK=host TRUST_PROXY=127.0.0.1 sh deploy/cover-up.sh
```

片段是 `deploy/caddy-host.caddy`，反代到 `127.0.0.1:8787`。

反代容器已经连在某个 Docker 网络上：

```bash
COVER_NETWORK=shared COVER_DOCKER_NETWORK=已有网络名 TRUST_PROXY=该网络中反代的精确地址 sh deploy/cover-up.sh
```

网络必须已经存在。脚本不会创建网络，也不会把现有容器接进去。片段是 `deploy/caddy-shared.caddy`，反代到 `hghub-cover:8787`。

回滚使用同一组变量：

```bash
COVER_NETWORK=host TRUST_PROXY=127.0.0.1 sh deploy/cover-rollback.sh
```

这里没有构建镜像，也没有在公网或 Rex 真机上验证。
