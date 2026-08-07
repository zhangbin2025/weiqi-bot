#!/bin/bash
# 下载 KataGo Windows OpenCL 版本
# 打包前运行：npm run download-katago 或 bash scripts/download-katago.sh

set -e

KATAGO_VERSION="v1.16.5"
KATAGO_BASE_URL="https://github.com/lightvector/KataGo/releases/download/${KATAGO_VERSION}"
KATAGO_FILE="katago-${KATAGO_VERSION}-opencl-windows-x64.zip"
KATAGO_URL="${KATAGO_BASE_URL}/${KATAGO_FILE}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
KATAGO_DIR="${DESKTOP_DIR}/katago"
ZIP_FILE="${KATAGO_DIR}/${KATAGO_FILE}"

echo "============================================"
echo "下载 KataGo ${KATAGO_VERSION} OpenCL (Windows)"
echo "============================================"
echo "URL: ${KATAGO_URL}"
echo "目标目录: ${KATAGO_DIR}"
echo ""

# 创建目录
mkdir -p "${KATAGO_DIR}"

# 检查是否已下载
if [ -f "${KATAGO_DIR}/katago.exe" ]; then
  echo "✓ KataGo 已存在，跳过下载"
  echo "  位置: ${KATAGO_DIR}/katago.exe"
  exit 0
fi

# 下载
echo "下载中..."
if command -v wget &> /dev/null; then
  wget -O "${ZIP_FILE}" "${KATAGO_URL}"
elif command -v curl &> /dev/null; then
  curl -L -o "${ZIP_FILE}" "${KATAGO_URL}"
else
  echo "✗ 错误: 需要 wget 或 curl"
  exit 1
fi

# 解压
echo "解压中..."
unzip -q -o "${ZIP_FILE}" -d "${KATAGO_DIR}"

# 清理
rm -f "${ZIP_FILE}"

# 验证
if [ -f "${KATAGO_DIR}/katago.exe" ]; then
  echo ""
  echo "✓ 下载完成！"
  echo "  katago.exe: ${KATAGO_DIR}/katago.exe"
  ls -lh "${KATAGO_DIR}" | head -10
else
  echo "✗ 错误: katago.exe 不存在"
  exit 1
fi
