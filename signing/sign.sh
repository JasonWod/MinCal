#!/usr/bin/env bash
# 用法: ./sign.sh <要签名的 exe 路径>
# 用本目录的自签名证书给 Windows exe 签名 (in->临时文件->覆盖)
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/mingw/bin:$PATH"
PASS=$(cat "$DIR/password.txt")
EXE="$1"
[ -z "$EXE" ] && { echo "用法: $0 <exe路径>"; exit 1; }
[ -x "$HOME/mingw/bin/osslsigncode" ] || { echo "找不到 osslsigncode (需先编译, 见构建笔记)"; exit 1; }
osslsigncode sign -pkcs12 "$DIR/mincal-cs.pfx" -pass "$PASS" -n "MinCal" \
  -in "$EXE" -out "$EXE.signed"
mv "$EXE.signed" "$EXE"
echo "已签名: $EXE"
osslsigncode verify -in "$EXE" 2>&1 | grep -E "Issuer|Number of verified" || true
