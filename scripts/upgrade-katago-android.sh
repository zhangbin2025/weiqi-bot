#!/bin/bash
# upgrade-katago-android.sh — 升级 Android 端 KataGo 版本
#
# 用法:
#   ./scripts/upgrade-katago-android.sh <version> [options]
#
# 参数:
#   version    KataGo 版本号，如 1.18.0
#
# 选项:
#   --skip-clvk        跳过 clvk libOpenCL.so 更新（默认只更新 KataGo）
#   --clvk-version     指定 termux clvk deb 版本号（默认自动最新）
#   --skip-strip       跳过 strip 步骤（调试用）
#   --keep-source      保留下载的源码目录（默认编译后删除）
#   --dry-run          只打印步骤，不实际执行
#
# 示例:
#   ./scripts/upgrade-katago-android.sh 1.18.0
#   ./scripts/upgrade-katago-android.sh 1.18.0 --skip-clvk
#   ./scripts/upgrade-katago-android.sh 1.18.0 --dry-run
#
# 产物:
#   clients/app/android/app/src/main/jniLibs/arm64-v8a/libkatago.so      (KataGo 二进制)
#   clients/app/android/app/src/main/jniLibs/arm64-v8a/libOpenCL.so      (clvk, 可选)
#   clients/app/android/app/src/main/jniLibs/arm64-v8a/libc++_shared.so  (NDK libc++)

set -euo pipefail

# ============================================================================
# 配置
# ============================================================================

# 项目根目录 (脚本所在目录的上级)
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 编译环境路径
ANDROID_SDK="$HOME/android-sdk"
NDK_VERSION="27.1.12297006"
NDK_CLVK="25.2.9519653"  # clvk 编译用的 NDK（如需重编译 clvk）
OPENCL_HEADERS="$HOME/OpenCL-Headers"
OPENCL_STUB="$HOME/opencl-stub/libOpenCL.so"

# jniLibs 目标目录
JNILIBS="$PROJECT_ROOT/clients/app/android/app/src/main/jniLibs/arm64-v8a"

# termux clvk 下载地址
CLVK_BASE_URL="https://packages.termux.dev/apt/termux-main/pool/main/c/clvk"

# ============================================================================
# 颜色输出
# ============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }
step()  { echo -e "${BLUE}[STEP]${NC} $*"; }

# ============================================================================
# 参数解析
# ============================================================================

VERSION=""
SKIP_CLVK=false
CLVK_VERSION=""
SKIP_STRIP=false
KEEP_SOURCE=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-clvk)      SKIP_CLVK=true; shift ;;
    --clvk-version)   CLVK_VERSION="$2"; shift 2 ;;
    --skip-strip)     SKIP_STRIP=true; shift ;;
    --keep-source)    KEEP_SOURCE=true; shift ;;
    --dry-run)        DRY_RUN=true; shift ;;
    -h|--help)
      head -25 "$0" | tail -23
      exit 0
      ;;
    *)
      if [[ -z "$VERSION" ]]; then
        VERSION="$1"
      else
        error "未知参数: $1"
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  error "请指定 KataGo 版本号，例如: $0 1.18.0"
  exit 1
fi

# 去掉可能的 v 前缀
VERSION="${VERSION#v}"
GIT_TAG="v${VERSION}"

info "升级 KataGo Android → v${VERSION}"
info "项目目录: $PROJECT_ROOT"
if [[ "$DRY_RUN" == true ]]; then
  warn "DRY RUN 模式：只打印步骤，不实际执行"
fi

# ============================================================================
# 前置检查
# ============================================================================

step "1/7 前置检查"

check_path() {
  if [[ ! -e "$1" ]]; then
    error "不存在: $1"
    return 1
  fi
  return 0
}

NDK_PATH="$ANDROID_SDK/ndk/$NDK_VERSION"
STRIP_TOOL="$NDK_PATH/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip"

for p in "$NDK_PATH" "$OPENCL_HEADERS" "$OPENCL_STUB" "$ANDROID_SDK/platform-tools"; do
  if [[ "$DRY_RUN" == true ]]; then
    echo "  检查: $p $(check_path "$p" 2>/dev/null && echo '✅' || echo '❌')"
  else
    check_path "$p" || exit 1
    echo "  ✅ $p"
  fi
done

# 检查 jniLibs 目录
if [[ ! -d "$JNILIBS" ]]; then
  error "jniLibs 目录不存在: $JNILIBS"
  exit 1
fi

# ============================================================================
# 下载源码
# ============================================================================

step "2/7 下载 KataGo 源码"

SOURCE_DIR="$HOME/KataGo-${VERSION}"
BUILD_DIR="$SOURCE_DIR/cpp/build-android-opencl"

if [[ -d "$SOURCE_DIR" ]]; then
  warn "源码目录已存在: $SOURCE_DIR"
  if [[ "$DRY_RUN" != true ]]; then
    read -p "  删除并重新下载? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      rm -rf "$SOURCE_DIR"
    else
      info "  使用已有源码目录"
    fi
  fi
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  if [[ "$DRY_RUN" == true ]]; then
    echo "  git clone https://github.com/lightvector/KataGo.git $SOURCE_DIR"
    echo "  git checkout $GIT_TAG"
  else
    git clone https://github.com/lightvector/KataGo.git "$SOURCE_DIR"
    cd "$SOURCE_DIR"
    git checkout "$GIT_TAG"
  fi
fi

# ============================================================================
# 应用 CMakeLists.txt 补丁
# ============================================================================

step "3/7 应用 Android 补丁到 CMakeLists.txt"

CMAKELISTS="$SOURCE_DIR/cpp/CMakeLists.txt"

# 检查是否已经打过补丁
if grep -q "if(ANDROID)" "$CMAKELISTS" 2>/dev/null && \
   grep -q "dynamic linking libOpenCL.so" "$CMAKELISTS" 2>/dev/null; then
  info "  CMakeLists.txt 已包含 Android 补丁，跳过"
else
  if [[ "$DRY_RUN" == true ]]; then
    echo "  将应用两处补丁:"
    echo "    1. 字节序宏 (BYTE_ORDER/LITTLE_ENDIAN/BIG_ENDIAN)"
    echo "    2. OpenCL 动态链接 (Android 分支)"
  else
    # 补丁 1: 字节序宏 — 在 project(katago) 的 endif() 后插入
    # 找到第一个 endif() 之后的位置
    python3 "$PROJECT_ROOT/scripts/patch_cmake_android.py" "$CMAKELISTS"
  fi
fi

# ============================================================================
# 编译
# ============================================================================

step "4/7 编译 KataGo (arm64-v8a, OpenCL)"

if [[ "$DRY_RUN" == true ]]; then
  echo "  mkdir -p $BUILD_DIR && cd $BUILD_DIR"
  echo "  cmake .. -DCMAKE_TOOLCHAIN_FILE=... -DUSE_BACKEND=OPENCL ..."
  echo "  make -j\$(nproc)"
else
  mkdir -p "$BUILD_DIR"
  cd "$BUILD_DIR"

  cmake .. \
    -DCMAKE_TOOLCHAIN_FILE="$NDK_PATH/build/cmake/android.toolchain.cmake" \
    -DANDROID_ABI=arm64-v8a \
    -DANDROID_PLATFORM=android-24 \
    -DCMAKE_BUILD_TYPE=Release \
    -DUSE_BACKEND=OPENCL \
    -DUSE_AVX2=0 \
    -DNO_GIT_REVISION=0 \
    -DOpenCL_INCLUDE_DIR="$OPENCL_HEADERS" \
    -DOpenCL_LIBRARY="$OPENCL_STUB"

  make -j"$(nproc)"
fi

# ============================================================================
# Strip
# ============================================================================

step "5/7 Strip 二进制"

OUTPUT_SO="$BUILD_DIR/katago"  # cmake 产物名是 katago
TARGET_KATAGO="$JNILIBS/libkatago.so"

if [[ "$SKIP_STRIP" == true ]]; then
  warn "跳过 strip"
  OUTPUT_SO="$BUILD_DIR/katago"
else
  if [[ "$DRY_RUN" == true ]]; then
    echo "  $STRIP_TOOL $BUILD_DIR/katago -o $BUILD_DIR/libkatago.so"
    OUTPUT_SO="$BUILD_DIR/libkatago.so"
  else
    "$STRIP_TOOL" "$BUILD_DIR/katago" -o "$BUILD_DIR/libkatago.so"
    OUTPUT_SO="$BUILD_DIR/libkatago.so"
    info "  strip 完成: $(ls -lh "$OUTPUT_SO" | awk '{print $5}')"
  fi
fi

# ============================================================================
# 验证产物
# ============================================================================

step "6/7 验证产物"

if [[ "$DRY_RUN" == true ]]; then
  echo "  file $OUTPUT_SO  (应为 ELF 64-bit ARM aarch64)"
  echo "  readelf -d $OUTPUT_SO | grep NEEDED  (应包含 libOpenCL.so)"
else
  # 检查文件类型
  FILE_TYPE=$(file "$OUTPUT_SO")
  if echo "$FILE_TYPE" | grep -q "ARM aarch64"; then
    info "  ✅ 架构正确: ARM aarch64"
  else
    error "  ❌ 架构错误: $FILE_TYPE"
    exit 1
  fi

  # 检查依赖
  DEPS=$(readelf -d "$OUTPUT_SO" | grep NEEDED)
  if echo "$DEPS" | grep -q "libOpenCL.so"; then
    info "  ✅ 依赖 libOpenCL.so"
  else
    error "  ❌ 缺少 libOpenCL.so 依赖"
    echo "$DEPS"
    exit 1
  fi
  info "  依赖列表:"
  echo "$DEPS" | sed 's/^/    /'
fi

# ============================================================================
# 集成到项目
# ============================================================================

step "7/7 集成到 jniLibs"

if [[ "$DRY_RUN" == true ]]; then
  echo "  cp $OUTPUT_SO → $TARGET_KATAGO"
else
  # 备份旧版本
  if [[ -f "$TARGET_KATAGO" ]]; then
    BACKUP="$JNILIBS/libkatago.so.bak"
    cp "$TARGET_KATAGO" "$BACKUP"
    info "  已备份旧版本: $(basename "$BACKUP")"
  fi

  cp "$OUTPUT_SO" "$TARGET_KATAGO"
  chmod 755 "$TARGET_KATAGO"
  info "  ✅ libkatago.so 已更新: $(ls -lh "$TARGET_KATAGO" | awk '{print $5}')"
fi

# ============================================================================
# clvk 更新（可选）
# ============================================================================

if [[ "$SKIP_CLVK" == true ]]; then
  info "跳过 clvk 更新 (--skip-clvk)"
else
  echo ""
  step "可选: 更新 clvk libOpenCL.so"

  TARGET_OPENCL="$JNILIBS/libOpenCL.so"

  if [[ "$DRY_RUN" == true ]]; then
    echo "  下载 termux clvk deb → 解压 → 提取 libOpenCL.so"
    echo "  cp → $TARGET_OPENCL"
  else
    # 获取最新 clvk 版本号
    if [[ -z "$CLVK_VERSION" ]]; then
      info "  查询最新 clvk 版本..."
      CLVK_VERSION=$(curl -sL "$CLVK_BASE_URL/" | \
        grep -oP 'clvk_[0-9.]+_aarch64\.deb' | \
        sort -V | tail -1 | grep -oP '[0-9.]+(?=_aarch64)')
      if [[ -z "$CLVK_VERSION" ]]; then
        warn "  无法自动获取 clvk 版本，跳过 clvk 更新"
        warn "  手动更新: 查看 $CLVK_BASE_URL/"
        CLVK_VERSION=""
      fi
    fi

    if [[ -n "$CLVK_VERSION" ]]; then
      info "  clvk 版本: $CLVK_VERSION"
      CLVK_DEB="/tmp/clvk_${CLVK_VERSION}_aarch64.deb"
      CLVK_EXTRACT="/tmp/clvk-extract-$$"

      curl -sLo "$CLVK_DEB" "${CLVK_BASE_URL}/clvk_${CLVK_VERSION}_aarch64.deb"
      mkdir -p "$CLVK_EXTRACT"
      dpkg-deb -x "$CLVK_DEB" "$CLVK_EXTRACT"

      CLVK_LIB="$CLVK_EXTRACT/data/data/com.termux/files/usr/lib/clvk/libOpenCL.so"
      if [[ -f "$CLVK_LIB" ]]; then
        cp "$CLVK_LIB" "$TARGET_OPENCL"
        info "  ✅ libOpenCL.so (clvk) 已更新: $(ls -lh "$TARGET_OPENCL" | awk '{print $5}')"
      else
        warn "  clvk libOpenCL.so 未在 deb 中找到，跳过"
      fi

      rm -rf "$CLVK_EXTRACT" "$CLVK_DEB"
    fi
  fi
fi

# ============================================================================
# libc++_shared.so 同步
# ============================================================================

LIBCPP_SRC="$NDK_PATH/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib/aarch64-linux-android/libc++_shared.so"
LIBCPP_DST="$JNILIBS/libc++_shared.so"

if [[ -f "$LIBCPP_SRC" ]]; then
  if [[ "$DRY_RUN" == true ]]; then
    echo "  cp $LIBCPP_SRC → $LIBCPP_DST"
  else
    cp "$LIBCPP_SRC" "$LIBCPP_DST"
    chmod 755 "$LIBCPP_DST"
    info "  ✅ libc++_shared.so 已同步"
  fi
else
  warn "  libc++_shared.so 源文件不存在，跳过"
fi

# ============================================================================
# 清理
# ============================================================================

if [[ "$KEEP_SOURCE" == false ]] && [[ "$DRY_RUN" != true ]]; then
  echo ""
  info "清理源码目录: $SOURCE_DIR"
  rm -rf "$SOURCE_DIR"
  info "  (使用 --keep-source 保留源码)"
fi

# ============================================================================
# 完成提示
# ============================================================================

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} ✅ KataGo Android 升级完成!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "版本: v${VERSION}"
echo ""
echo "已更新的文件:"
echo "  $TARGET_KATAGO"
if [[ "$SKIP_CLVK" != true ]]; then
  echo "  $JNILIBS/libOpenCL.so (clvk)"
fi
echo "  $LIBCPP_DST"
echo ""
echo "下一步:"
echo "  1. 在设备上测试: adb shell 运行 libkatago.so version"
echo "  2. 测试 analysis 功能 (注意 tuning 可能更慢)"
echo "  3. 检查配置文件是否需要更新 (default_gtp.cfg, analysis.cfg)"
echo "  4. 构建 APK 验证: npm run build:app"
echo ""
if [[ "$DRY_RUN" == true ]]; then
  warn "以上为 DRY RUN 预览，未实际执行"
fi
