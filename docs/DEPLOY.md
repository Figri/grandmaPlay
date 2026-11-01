# 部署到阿里云（使用现有 ECS + 自己的域名）

目标：`https://你的域名` 打开游戏屋，联机走 `wss://`。不需要购买新服务。

> 构建产物只有两样东西：`dist/public/`（网页）和 `dist/server.cjs`（单文件服务端，已打包全部依赖）。
> 服务器上**只需要 Node.js**，不需要 `npm install`，避免国内服务器装依赖慢的问题。

## 0. 先确认两件事

### 0.1 域名备案（重要）

- 如果 ECS 在**中国内地**地域（华东、华北、华南等），域名**必须完成 ICP 备案**才能通过 80/443 端口访问，否则阿里云会拦截。备案在阿里云控制台“ICP 代备案管理系统”办理，个人备案一般 1–3 周。
- 如果 ECS 在**中国香港或海外**地域，不需要备案，可以直接用。
- 备案完成前的临时办法：直接用 `http://服务器公网IP:端口` 访问（在安全组里临时放行该端口，`HOST=0.0.0.0`）。游戏功能都能用（复制链接会自动退回兼容方式），只是没有 HTTPS。

### 0.2 服务器配置

最低 1 核 1G 就够家庭使用。系统以 Alibaba Cloud Linux 3 / CentOS / Ubuntu 为例。

## 1. 一次性初始化（在服务器上执行）

```bash
# 1) 安装 Node.js 22（任选一种）
# Alibaba Cloud Linux / CentOS：
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - && sudo yum install -y nodejs
# Ubuntu：
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt-get install -y nodejs
# 如果上面的源访问慢，可以用国内镜像下载二进制包：
#   https://npmmirror.com/mirrors/node/ 选 v22.x linux-x64，解压到 /usr/local 并把 bin 加入 PATH
node -v

# 2) 安装 Nginx
sudo yum install -y nginx    # 或 sudo apt-get install -y nginx
sudo systemctl enable --now nginx

# 3) 创建运行用户和目录
sudo useradd -r -s /sbin/nologin grandma || true
sudo mkdir -p /opt/grandma-play/data /opt/grandma-play/releases
sudo chown -R grandma:grandma /opt/grandma-play
```

### 1.1 阿里云安全组

ECS 控制台 → 实例 → 安全组 → 入方向：放行 **80** 和 **443**（TCP，来源 0.0.0.0/0）。**不要**放行 3000，Node 只监听本机。

### 1.2 域名解析

阿里云“云解析 DNS” → 给域名添加 A 记录，例如 `game` → 服务器公网 IP（得到 `game.你的域名.com`）。

## 2. 上传程序并注册服务

在**你自己的电脑**上（项目目录）：

```bash
npm install
npm run build
scp -r dist root@服务器IP:/opt/grandma-play/
scp deploy/grandma-play.service root@服务器IP:/etc/systemd/system/
```

在服务器上：

```bash
sudo chown -R grandma:grandma /opt/grandma-play
sudo systemctl daemon-reload
sudo systemctl enable --now grandma-play
curl http://127.0.0.1:3000/healthz      # 返回 {"ok":true,...} 即正常
journalctl -u grandma-play -f           # 查看日志
```

## 3. 配置 HTTPS 和 WSS

### 3.1 申请证书（任选一种）

**方式 A：Let's Encrypt（免费，自动续期，推荐）**

```bash
sudo mkdir -p /var/www/certbot
# Alibaba Cloud Linux / CentOS: sudo yum install -y certbot   Ubuntu: sudo apt-get install -y certbot
# 先用只有 80 端口的临时配置让验证通过：
sudo tee /etc/nginx/conf.d/grandma-play.conf >/dev/null <<'EOF'
server {
    listen 80;
    server_name game.example.com;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 200 'ok'; }
}
EOF
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/certbot -d game.example.com
# 续期由 certbot 自带的定时任务完成；续期后需要 reload nginx：
echo 'deploy-hook = systemctl reload nginx' | sudo tee -a /etc/letsencrypt/cli.ini
```

**方式 B：阿里云免费 SSL 证书**

阿里云控制台“数字证书管理服务” → 免费证书 → 申请并下载 **Nginx 格式**，把 `.pem` 和 `.key` 上传到服务器（例如 `/etc/nginx/cert/`），在下面的配置里改成对应路径。注意免费证书有效期较短，需要到期前手动更换。

### 3.2 Nginx 配置

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/conf.d/grandma-play.conf   # 文件从项目里上传过去
sudo sed -i 's/game.example.com/game.你的域名.com/g' /etc/nginx/conf.d/grandma-play.conf
sudo nginx -t && sudo systemctl reload nginx
```

关键点（配置示例里已包含）：

- `/socket.io/` 必须带 `Upgrade` / `Connection "upgrade"` 头，才能走 WebSocket（WSS）。
- `proxy_read_timeout 3600s`，避免空闲连接被 Nginx 60 秒断开。
- systemd 里设置了 `TRUST_PROXY=1`，限流才能拿到真实 IP。
- 如果 Nginx 版本较老（< 1.25）不认识 `http2 on;`，改成 `listen 443 ssl http2;`。

打开 `https://game.你的域名.com`，应该能看到游戏大厅，右上角绿点表示已连上服务器。

## 4. 以后发布新版本

在自己电脑上一条命令（会先跑测试、构建，再上传、切换、重启、健康检查）：

```bash
SERVER=root@服务器IP ./deploy/deploy.sh
```

发版重启时，正在进行的对局会保存到 `data/state.json`，大家的页面会显示“正在重新连接…”，一两秒后自动回到原来的座位和局面。

回滚：服务器上 `/opt/grandma-play/dist.old` 是上一个版本，`mv dist dist.bad && mv dist.old dist && systemctl restart grandma-play`。

## 5. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | 3000 | 监听端口 |
| `HOST` | 0.0.0.0 | 生产环境设为 127.0.0.1，只让 Nginx 访问 |
| `DATA_DIR` | `dist/../data` | 持久化目录 |
| `TRUST_PROXY` | 0 | 在 Nginx 后面设为 1 |
| `ROOM_IDLE_HOURS` | 6 | 全员离线多久后关闭房间 |
| `ROOM_MAX_IDLE_HOURS` | 24 | 无任何动静多久后关闭房间 |
| `PING_INTERVAL_MS` / `PING_TIMEOUT_MS` | 15000 / 10000 | 心跳间隔 / 超时（决定多快显示“离线”） |

## 6. 备份

只有一个数据文件：`/opt/grandma-play/data/state.json`（房间和临时身份，没有个人隐私数据）。丢了也只是正在进行的房间消失、大家重新建房，可以不备份。

## 7. 排查

| 现象 | 检查 |
| --- | --- |
| 打不开网页 | 安全组 80/443、域名解析、备案状态、`systemctl status nginx` |
| 网页能开，一直“正在连接” | Nginx `/socket.io/` 的 Upgrade 配置；`journalctl -u grandma-play` |
| 一分钟左右就断线 | Nginx `proxy_read_timeout` 没设置 |
| 很多人“操作太频繁”/“尝试次数过多” | 是否设置了 `TRUST_PROXY=1`（否则所有人都是同一个 IP 127.0.0.1） |
