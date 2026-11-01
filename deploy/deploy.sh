#!/usr/bin/env bash
# 一键发布：本地构建 → 上传到阿里云服务器 → 重启服务
# 用法：SERVER=root@1.2.3.4 ./deploy/deploy.sh
# 前提：服务器已按 docs/DEPLOY.md 完成一次性初始化（Node、Nginx、systemd 服务）
set -euo pipefail

SERVER="${SERVER:?请设置 SERVER，例如 SERVER=root@1.2.3.4}"
REMOTE_DIR="${REMOTE_DIR:-/opt/grandma-play}"

cd "$(dirname "$0")/.."
echo "==> 运行测试"
npm test
echo "==> 构建"
npm run build

echo "==> 上传到 $SERVER:$REMOTE_DIR"
ssh "$SERVER" "mkdir -p $REMOTE_DIR/releases"
STAMP=$(date +%Y%m%d-%H%M%S)
tar -czf /tmp/grandma-play-dist.tgz dist
scp /tmp/grandma-play-dist.tgz "$SERVER:$REMOTE_DIR/releases/$STAMP.tgz"

echo "==> 切换版本并重启"
ssh "$SERVER" bash -s <<REMOTE
set -euo pipefail
cd $REMOTE_DIR
rm -rf dist.new && mkdir dist.new && tar -xzf releases/$STAMP.tgz -C dist.new --strip-components=1
[ -d dist ] && rm -rf dist.old && mv dist dist.old
mv dist.new dist
mkdir -p data
chown -R grandma:grandma $REMOTE_DIR/dist $REMOTE_DIR/data 2>/dev/null || true
systemctl restart grandma-play
sleep 1
curl -fsS http://127.0.0.1:3000/healthz && echo
# 只保留最近 5 个版本包
ls -1t releases/*.tgz | tail -n +6 | xargs -r rm -f
REMOTE
echo "==> 发布完成"
