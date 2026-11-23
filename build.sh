#!/bin/sh
set -eu

# ============================================================
# FunctionWeb 部署构建脚本
# 由远程 Node 20 builder 执行，输出产物目录 dist/
# 运行时工作目录会切换到 dist/，所以所有运行时依赖都要复制进去
# ============================================================

export NPM_CONFIG_REGISTRY='https://registry.npmjs.org/'

# 1. 安装依赖（远程构建环境，使用 lockfile）
if [ -f package-lock.json ]; then
  npm ci --registry='https://registry.npmjs.org/' --no-audit --no-fund --loglevel=error
else
  npm install --registry='https://registry.npmjs.org/' --no-audit --no-fund --loglevel=error --omit=dev
fi

# 2. 修剪掉 dev 依赖（如果有的话）
npm prune --omit=dev || true

# 3. 创建产物目录
mkdir -p dist

# 4. 复制运行时入口 & 静态资源
cp server.js dist/
cp run.sh dist/
chmod 755 dist/run.sh
cp -R public dist/public

# 5. 复制生产依赖（关键！runtime artifact 只有 dist/）
cp -R node_modules dist/node_modules

# 6. 复制 package 元数据（server.js 可能会读 package.json，保险起见）
cp package.json dist/

echo "build OK -> dist/ has $(find dist -type f | wc -l) files"
