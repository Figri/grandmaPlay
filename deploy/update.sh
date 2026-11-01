#!/usr/bin/env bash
# 在服务器上更新到 GitHub 上的最新代码：
#   sudo bash /opt/grandma-play/app/deploy/update.sh
# 正在进行的对局会保存下来，大家的页面会自动重连回原来的座位。
set -euo pipefail
APP_ROOT="${APP_ROOT:-/opt/grandma-play}"
cd "$APP_ROOT/app"
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"

echo "==> 拉取最新代码（$BRANCH）"
git fetch --depth 1 origin "$BRANCH"
OLD=$(git rev-parse --short HEAD)
git reset --hard FETCH_HEAD
NEW=$(git rev-parse --short HEAD)
echo "    $OLD → $NEW"

echo "==> 安装依赖并构建"
npm ci --no-audit --no-fund
npm run build

echo "==> 重启服务"
systemctl restart grandma-play
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS http://127.0.0.1:${PORT:-3000}/healthz >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS http://127.0.0.1:${PORT:-3000}/healthz && echo && echo "✔ 更新完成"
