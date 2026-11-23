#!/bin/sh
set -eu
# 前台启动服务（FunctionWeb runtime 要求，不能 daemonize）
# PORT 由运行时注入，server.js 会读取 process.env.PORT
exec node server.js
