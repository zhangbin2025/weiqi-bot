#!/bin/bash
# weiqi-bot CLI 打包为单一可执行文件 (Node.js SEA)
# 输出: dist/weiqi-bot (Linux x64 单文件, 无需安装 Node.js)
#
# 原理: esbuild bundle → Node SEA blob → 注入到 Node 二进制 → 单一可执行文件
# 依赖: 运行时只需 playwright (用于直播棋谱 Sniffer 抓取，可选)

set -e
cd "$(dirname "$0")/.."

OUTDIR="dist"
OUTJS="$OUTDIR/weiqi-bot-sea.js"
OUTBLOB="$OUTDIR/weiqi-bot-sea.blob"
OUTBIN="$OUTDIR/weiqi-bot"
NODE=$(which node)

echo "📦 打包 weiqi-bot CLI (Single Executable Application)..."

# 1. esbuild 打包为单文件 (CJS 格式，SEA 要求)
echo "  [1/5] esbuild bundle..."
npx esbuild clients/cli/index.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --format=cjs \
  --outfile="$OUTJS" \
  --external:playwright \
  --external:playwright-core \
  --external:chromium-bidi \
  --external:puppeteer \
  --allow-overwrite

# 2. 生成 SEA blob
echo "  [2/5] 生成 SEA blob..."
cat > "$OUTDIR/sea-config.json" << EOF
{
  "main": "$OUTJS",
  "output": "$OUTBLOB",
  "disableExperimentalSEAWarning": true
}
EOF
$NODE --experimental-sea-config "$OUTDIR/sea-config.json"

# 3. 复制 Node 二进制
echo "  [3/5] 复制 Node 二进制..."
cp "$NODE" "$OUTBIN"
chmod +x "$OUTBIN"

# macOS 需要移除签名
if [[ "$(uname)" == "Darwin" ]]; then
  codesign --remove-signature "$OUTBIN" 2>/dev/null || true
fi

# 4. 自动检测 sentinel fuse 并注入 blob
echo "  [4/5] 注入 SEA blob..."
SEA_FUSE=$(strings "$OUTBIN" | grep -o 'NODE_SEA_FUSE_[0-9a-f]*' | head -1)
if [ -z "$SEA_FUSE" ]; then
  echo "❌ 无法检测 sentinel fuse，SEA 打包失败"
  exit 1
fi
echo "  检测到 fuse: $SEA_FUSE"
npx postject "$OUTBIN" NODE_SEA_BLOB "$OUTBLOB" --sentinel-fuse "$SEA_FUSE"

# 5. 清理临时文件
echo "  [5/5] 清理..."
rm -f "$OUTJS" "$OUTBLOB" "$OUTDIR/sea-config.json"

SIZE=$(ls -lh "$OUTBIN" | awk '{print $5}')
echo ""
echo "✅ 打包完成: $OUTBIN ($SIZE)"
echo ""
echo "使用方式:"
echo "  $OUTBIN --help"
echo "  $OUTBIN player query 柯洁 --format text"
echo "  $OUTBIN fetch download <url>"
echo "  $OUTBIN joseki --date 2026-07-28"
echo "  $OUTBIN opponent analyze 柯洁"
echo "  $OUTBIN decision --date 2026-07-28"
