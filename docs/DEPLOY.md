# 部署：阿里云美国（硅谷）服务器 + figri.me

硅谷属于海外地域，**不需要 ICP 备案**，域名解析好就能直接用 HTTPS。

最终效果：家人打开 **https://figri.me** 玩，邀请链接形如 **https://figri.me/r/8888**。

整个过程分 4 步，大约 15 分钟，全部在网页上操作，**不需要在自己电脑上装任何软件**。

---

## 第 1 步：阿里云安全组放行端口

阿里云控制台 → **云服务器 ECS** → 左上角地域选 **美国（硅谷）** → 实例 → 点进你的服务器 → **安全组** → 配置规则 → **入方向** → 手动添加：

| 端口 | 授权对象 | 用途 |
| --- | --- | --- |
| 80/80 | 0.0.0.0/0 | 网页（申请证书也要用） |
| 443/443 | 0.0.0.0/0 | HTTPS 网页 + 联机 |
| 22/22 | 0.0.0.0/0（通常已有） | 远程登录 |

同一页面记下服务器的 **公网 IP**（下文写作 `服务器IP`）。

## 第 2 步：域名解析

figri.me 在哪里买的，就去哪里改解析（在阿里云买的：控制台 → **云解析 DNS** → figri.me → 解析设置）。添加两条记录：

| 记录类型 | 主机记录 | 记录值 |
| --- | --- | --- |
| A | `@` | 服务器IP |
| A | `www` | 服务器IP |

> 如果 figri.me 已经用来放别的网站，可以改用子域名，比如主机记录填 `game`，下面的命令里把 `figri.me` 换成 `game.figri.me` 即可。

解析一般几分钟生效。可以在自己电脑上 `ping figri.me` 看是不是返回服务器IP。

## 第 3 步：登录服务器，粘贴一条命令

阿里云控制台 → 实例 → 点 **远程连接** → 选 **通过 Workbench 远程连接** → 登录（用 root 账号）。

在出现的黑色命令窗口里粘贴下面这一行（把邮箱换成你的，用于证书到期提醒），回车：

```bash
curl -fsSL https://raw.githubusercontent.com/Figri/grandmaPlay/ccr-7e69b40d-3yrkbk/deploy/setup-server.sh | bash -s -- figri.me 你的邮箱@example.com
```

脚本会自动完成（约 5–10 分钟）：

1. 安装 Nginx、git、Node.js 22（内存小于 2G 会自动加交换空间，防止构建失败）
2. 从 GitHub 下载代码、安装依赖、构建
3. 注册开机自启的服务 `grandma-play`（崩溃自动重启，只监听本机 3000 端口）
4. 配置 Nginx 反向代理（包含 WebSocket 升级，联机走 WSS）
5. 检查域名是否已经解析到这台服务器
6. 申请 Let's Encrypt 免费证书（acme.sh，**到期前自动续期**），启用 HTTPS，HTTP 自动跳转 HTTPS

最后看到绿色的 **“全部完成！打开 https://figri.me 就能玩了”** 就成功了。

> 如果提示“域名还没有解析到这台服务器”：说明第 2 步还没生效。等几分钟后**再粘贴运行一次同样的命令**即可（脚本可以重复运行）。在此期间可以先用 `http://服务器IP` 访问试玩。

## 第 4 步：验证

用手机打开 https://figri.me ，右上角小圆点是**绿色**表示已连上服务器。建一个五子棋房间，把邀请链接发到微信群，让家人用另一台手机点开试一局。

---

## 以后更新程序

我（或下一位开发者）把新功能推送到 GitHub 后，在服务器 Workbench 里运行：

```bash
sudo bash /opt/grandma-play/app/deploy/update.sh
```

会拉取最新代码、构建、重启。正在进行的对局会保存，大家页面上会闪一下“正在重新连接…”，然后自动回到原来的座位。

## 常用命令

| 做什么 | 命令 |
| --- | --- |
| 看服务状态 | `systemctl status grandma-play` |
| 看实时日志 | `journalctl -u grandma-play -f` |
| 重启服务 | `systemctl restart grandma-play` |
| 健康检查 | `curl http://127.0.0.1:3000/healthz` |
| 查看证书 | `~/.acme.sh/acme.sh --list` |
| Nginx 配置 | `/etc/nginx/conf.d/grandma-play.conf`（脚本生成） |

## 文件位置

| 路径 | 内容 |
| --- | --- |
| `/opt/grandma-play/app` | 代码（git 仓库）与构建产物 `dist/` |
| `/opt/grandma-play/data/state.json` | 房间与临时身份（没有隐私数据，丢了只是正在进行的房间消失） |
| `/etc/systemd/system/grandma-play.service` | 系统服务 |
| `/etc/nginx/ssl/figri.me/` | HTTPS 证书 |

## 关于从国内访问美国服务器

- 五子棋、斗地主这类回合制游戏对延迟不敏感，跨太平洋 150–250ms 的延迟感觉不到。
- 晚高峰国际线路偶尔会慢或短暂断开：程序会自动重连回原座位，不会判负、不会丢牌局。
- 如果以后觉得某些家人那边经常卡，可以考虑换到阿里云**香港**地域（同样不需要备案，离国内更近），部署方法完全一样。

## 环境变量（一般不用改）

在 `/etc/systemd/system/grandma-play.service` 里修改后执行 `systemctl daemon-reload && systemctl restart grandma-play`。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | 3000 | 监听端口 |
| `HOST` | 127.0.0.1 | 只让 Nginx 访问 |
| `DATA_DIR` | /opt/grandma-play/data | 数据目录 |
| `TRUST_PROXY` | 1 | 在 Nginx 后面，从 X-Forwarded-For 取真实 IP（限流用） |
| `ROOM_IDLE_HOURS` | 6 | 全员离线多久后关闭房间 |
| `ROOM_MAX_IDLE_HOURS` | 24 | 无任何动静多久后关闭房间 |
| `PING_INTERVAL_MS` / `PING_TIMEOUT_MS` | 15000 / 10000 | 心跳间隔 / 超时（决定多快显示“离线”） |

## 排查

| 现象 | 处理 |
| --- | --- |
| 证书申请失败 | 安全组是否放行 80；域名是否已解析到本机；重新运行安装命令 |
| 网页能开，一直“正在连接” | `journalctl -u grandma-play -n 50` 看报错；`nginx -t` 检查配置 |
| 打不开网页 | 安全组 443；`systemctl status nginx` |
| 很多人提示“操作太频繁” | 确认服务里有 `TRUST_PROXY=1` |
