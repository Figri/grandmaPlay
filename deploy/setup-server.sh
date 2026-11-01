#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 奶奶的游戏屋 —— 服务器一键安装（阿里云 ECS，美国/香港等无需备案的地域）
#
# 在服务器上以 root 运行（阿里云控制台 → 实例 → 远程连接 → Workbench）：
#   curl -fsSL https://raw.githubusercontent.com/Figri/grandmaPlay/ccr-7e69b40d-3yrkbk/deploy/setup-server.sh | bash -s -- figri.me 你的邮箱
#
# 会自动完成：安装 Node.js 22 / Nginx / git → 下载代码并构建 → 注册开机自启服务
#            → 配置 Nginx 反向代理（含 WebSocket）→ 申请 Let's Encrypt 证书（自动续期）→ 启用 HTTPS
# 可以重复运行（例如域名解析生效后再跑一次来申请证书）。
# 支持 Alibaba Cloud Linux 3 / CentOS / Rocky / Ubuntu / Debian，x86_64 与 ARM。
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# 整个脚本包在函数里：通过 curl | bash 运行时，bash 会先读完全部内容再执行
main() {

DOMAIN="${1:-}"
EMAIL="${2:-}"
REPO="${REPO:-https://github.com/Figri/grandmaPlay.git}"
BRANCH="${BRANCH:-ccr-7e69b40d-3yrkbk}"
APP_ROOT="${APP_ROOT:-/opt/grandma-play}"
PORT="${PORT:-3000}"

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
ok() { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;31m! %s\033[0m\n' "$*"; }

if [ -z "$DOMAIN" ]; then
  echo "用法：bash setup-server.sh 你的域名 [邮箱]   例如：bash setup-server.sh figri.me me@example.com"
  exit 1
fi
[ -n "$EMAIL" ] || EMAIL="admin@$DOMAIN"
[ "$(id -u)" = 0 ] || { warn "请用 root 运行（先执行 sudo -i）"; exit 1; }

# ───────────── 1. 基础软件 ─────────────
say "1/7 安装基础软件（nginx、git、curl）"
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y nginx git curl tar xz-utils socat cron ca-certificates
  systemctl enable --now cron >/dev/null 2>&1 || true
else
  PM=$(command -v dnf || command -v yum)
  $PM install -y nginx git curl tar xz socat cronie ca-certificates
  systemctl enable --now crond >/dev/null 2>&1 || true
fi
ok "基础软件已安装"

# ───────────── 2. Node.js 22 ─────────────
say "2/7 安装 Node.js 22"
if node -v 2>/dev/null | grep -Eq '^v(2[2-9]|[3-9][0-9])\.'; then
  ok "已有 Node.js $(node -v)"
else
  case "$(uname -m)" in
    x86_64) NARCH=x64 ;;
    aarch64 | arm64) NARCH=arm64 ;;
    *) warn "不支持的 CPU 架构：$(uname -m)"; exit 1 ;;
  esac
  BASE=https://nodejs.org/dist/latest-v22.x
  FILE=$(curl -fsSL "$BASE/SHASUMS256.txt" | awk '{print $2}' | grep "linux-$NARCH.tar.xz$" | head -1)
  curl -fsSL "$BASE/$FILE" -o /tmp/node.tar.xz
  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
  rm -f /tmp/node.tar.xz
  hash -r
  ok "已安装 Node.js $(node -v)"
fi
NODE_BIN="$(command -v node)"

# 小内存机器构建时容易内存不足：没有交换空间就加 2G
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 2000 ] && [ -z "$(swapon --show 2>/dev/null)" ]; then
  say "内存只有 ${MEM_MB}MB，添加 2G 交换空间"
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  ok "交换空间已启用"
fi

# ───────────── 3. 代码与构建 ─────────────
say "3/7 下载代码并构建（分支 $BRANCH）"
id grandma >/dev/null 2>&1 || useradd -r -s /sbin/nologin -d "$APP_ROOT" grandma
mkdir -p "$APP_ROOT/data" /var/www/acme
if [ -d "$APP_ROOT/app/.git" ]; then
  git -C "$APP_ROOT/app" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_ROOT/app" reset --hard FETCH_HEAD
else
  git clone --depth 1 -b "$BRANCH" "$REPO" "$APP_ROOT/app"
fi
cd "$APP_ROOT/app"
npm ci --no-audit --no-fund
npm run build
chown -R grandma:grandma "$APP_ROOT/data"
ok "构建完成"

# ───────────── 4. 系统服务 ─────────────
say "4/7 注册开机自启服务 grandma-play"
cat >/etc/systemd/system/grandma-play.service <<EOF
[Unit]
Description=Grandma Play family game server
After=network.target

[Service]
Type=simple
User=grandma
WorkingDirectory=$APP_ROOT/app
ExecStart=$NODE_BIN $APP_ROOT/app/dist/server.cjs
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
Environment=TRUST_PROXY=1
Environment=DATA_DIR=$APP_ROOT/data
Restart=always
RestartSec=2
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable grandma-play >/dev/null 2>&1
systemctl restart grandma-play
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null || { warn "服务没有启动成功，查看日志：journalctl -u grandma-play -n 50"; exit 1; }
ok "游戏服务已运行"

# ───────────── 5. 防火墙 / SELinux ─────────────
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
  setsebool -P httpd_can_network_connect 1 || true
fi
if systemctl is-active --quiet firewalld 2>/dev/null; then
  firewall-cmd --permanent --add-service=http --add-service=https >/dev/null && firewall-cmd --reload >/dev/null
fi
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
fi

# ───────────── 6. Nginx（先只开 HTTP） ─────────────
say "5/7 配置 Nginx"
PUBLIC_IP=$(curl -fsS --max-time 3 http://100.100.100.200/latest/meta-data/eipv4 2>/dev/null || curl -fsS --max-time 6 https://api.ipify.org 2>/dev/null || echo "")
resolve() { getent ahostsv4 "$1" 2>/dev/null | awk '{print $1; exit}'; }
NAMES="$DOMAIN"
WWW_OK=0
if [ -n "$PUBLIC_IP" ] && [ "$(resolve "www.$DOMAIN")" = "$PUBLIC_IP" ]; then NAMES="$DOMAIN www.$DOMAIN"; WWW_OK=1; fi

PROXY_BLOCK="
    location /socket.io/ {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \"upgrade\";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }"

CONF=/etc/nginx/conf.d/grandma-play.conf
SSL_DIR=/etc/nginx/ssl/$DOMAIN
if [ ! -s "$SSL_DIR/fullchain.pem" ]; then
  cat >"$CONF" <<EOF
# 由 setup-server.sh 生成（HTTP 阶段）
server {
    listen 80;
    server_name $NAMES;
    location /.well-known/acme-challenge/ { root /var/www/acme; }
$PROXY_BLOCK
}
EOF
fi
nginx -t
systemctl enable nginx >/dev/null 2>&1
systemctl restart nginx
ok "Nginx 已运行"

# ───────────── 7. HTTPS 证书 ─────────────
say "6/7 检查域名解析"
DNS_IP="$(resolve "$DOMAIN")"
echo "服务器公网 IP：${PUBLIC_IP:-未知}    $DOMAIN 解析到：${DNS_IP:-（还没有解析）}"
if [ -z "$PUBLIC_IP" ] || [ "$DNS_IP" != "$PUBLIC_IP" ]; then
  warn "域名还没有解析到这台服务器，暂时跳过 HTTPS。"
  echo "  请在域名解析里添加 A 记录：主机记录 @ → ${PUBLIC_IP:-服务器公网IP}（可再加一条 www → 同一个 IP）"
  echo "  解析生效后（通常几分钟），再运行一次本脚本即可自动启用 HTTPS。"
  echo "  现在可以先用 http://${PUBLIC_IP:-服务器公网IP} 访问（需要安全组放行 80 端口）。"
  exit 0
fi

say "7/7 申请 HTTPS 证书并启用"
if [ ! -x "$HOME/.acme.sh/acme.sh" ]; then
  if ! curl -fsSL https://get.acme.sh | sh -s email="$EMAIL"; then
    # 备用：直接从 GitHub 安装
    rm -rf /tmp/acme.sh-src
    git clone --depth 1 https://github.com/acmesh-official/acme.sh.git /tmp/acme.sh-src
    (cd /tmp/acme.sh-src && ./acme.sh --install -m "$EMAIL")
  fi
fi
ACME="$HOME/.acme.sh/acme.sh"
"$ACME" --set-default-ca --server letsencrypt >/dev/null
DARGS="-d $DOMAIN"
[ "$WWW_OK" = 1 ] && DARGS="$DARGS -d www.$DOMAIN"
set +e
# shellcheck disable=SC2086
"$ACME" --issue $DARGS -w /var/www/acme --keylength ec-256
RC=$?
set -e
if [ "$RC" -ne 0 ] && [ "$RC" -ne 2 ]; then
  warn "证书申请失败。请确认阿里云安全组已放行 80 和 443 端口，然后重新运行本脚本。"
  exit 1
fi
mkdir -p "$SSL_DIR"
"$ACME" --install-cert -d "$DOMAIN" --ecc \
  --key-file "$SSL_DIR/key.pem" \
  --fullchain-file "$SSL_DIR/fullchain.pem" \
  --reloadcmd "systemctl reload nginx"

cat >"$CONF" <<EOF
# 由 setup-server.sh 生成（HTTPS）
server {
    listen 80;
    server_name $NAMES;
    location /.well-known/acme-challenge/ { root /var/www/acme; }
    location / { return 301 https://$DOMAIN\$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name $NAMES;

    ssl_certificate     $SSL_DIR/fullchain.pem;
    ssl_certificate_key $SSL_DIR/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
$PROXY_BLOCK
}
EOF
nginx -t
systemctl reload nginx
ok "全部完成！打开 https://$DOMAIN 就能玩了"
echo "以后更新程序：sudo bash $APP_ROOT/app/deploy/update.sh"
}

main "$@"
