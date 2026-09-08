# KataGo Android 编译指南

> **最后更新**: 2026-09-08
> **当前版本**: v1.16.5 (OpenCL)
> **编译服务器**: `ubuntu@10.1.4.6`

---

## 一、概述

Android 端的 KataGo 以 `libkatago.so` (ELF PIE executable, arm64-v8a) 形式打包在 APK 的 `jniLibs` 中，通过 `ProcessBuilder` 启动子进程运行。

### 运行架构

```
APK jniLibs/arm64-v8a/
├── libkatago.so        # KataGo 可执行文件（~5MB，OpenCL 后端）
├── libOpenCL.so        # termux clvk（~85MB，OpenCL→Vulkan 桥接）
└── libc++_shared.so    # NDK libc++（~2MB）
```

**原理**: KataGo 动态链接 `libOpenCL.so`（termux clvk），clvk 将 OpenCL 调用转译为 Vulkan API，绕过设备厂商的 OpenCL 驱动问题（如 PowerVR namespace 限制）。

### 为什么用 clvk 而不是系统 OpenCL

- 荣耀 HNABR-M (天玑 MT6855 + PowerVR) 上系统 `libPVROCL.so` 是 symlink → `mt6855/` 子目录，被 Android linker namespace 拦截
- clvk 直接走 Vulkan，不依赖厂商 OpenCL 驱动，兼容性更好
- termux 社区预编译的 clvk 自带 clspv 编译器，可直接运行 KataGo 的 OpenCL kernel

---

## 二、编译环境

### 编译服务器

| 项目 | 值 |
|------|-----|
| SSH | `ssh ubuntu@10.1.4.6` |
| OS | Ubuntu 22.04 |
| Android SDK | `~/android-sdk` |
| NDK | `~/android-sdk/ndk/27.1.12297006` |

### 已验证的 NDK 版本

| NDK 版本 | 用途 | 备注 |
|----------|------|------|
| 25.2.9519653 | clvk 编译 | 不能用 27.x，libclc 不兼容 |
| 27.1.12297006 | KataGo 编译 | 当前使用 |

### 目录说明

| 目录 | 说明 |
|------|------|
| `/home/ubuntu/KataGo-verify2/` | KataGo v1.16.5 源码（无 .git，手动解压） |
| `/home/ubuntu/KataGo-verify-build/cpp/` | 编译工作目录（CMakeLists 有 Android 补丁） |
| `/home/ubuntu/OpenCL-Headers/` | OpenCL 头文件 |
| `/home/ubuntu/opencl-stub/` | OpenCL stub 库（编译时占位，运行时加载真实 libOpenCL.so） |

---

## 三、源码修改

### CMakeLists.txt 补丁

对 KataGo 源码 `cpp/CMakeLists.txt` 需要两处修改：

#### 修改 1: Android 字节序宏

在 `project(katago)` 的 `endif()` 后添加：

```cmake
if(ANDROID)
  set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -DBYTE_ORDER=1234 -DLITTLE_ENDIAN=1234 -DBIG_ENDIAN=4321")
endif()
```

**原因**: Android NDK 的 sysroot 不定义 `BYTE_ORDER` / `LITTLE_ENDIAN` / `BIG_ENDIAN` 宏，KataGo 代码依赖这些宏。

#### 修改 2: OpenCL 动态链接

将 OpenCL 分支改为 Android 动态链接。

**原代码** (约第 451-468 行):

```cmake
elseif(USE_BACKEND STREQUAL "OPENCL")
  target_compile_definitions(katago PRIVATE USE_OPENCL_BACKEND)
  
  find_package(OpenCL)
  if(NOT OpenCL_FOUND)
    message(WARNING "OpenCL not found, ...")
    find_package(CUDAToolkit)
    if(NOT CUDAToolkit_FOUND)
      message(FATAL_ERROR "OpenCL installation not found")
    else()
      message(WARNING "OpenCL not found, but found CUDA, ...")
    endif()
    include_directories(${OpenCL_INCLUDE_DIRS})
    include_directories(SYSTEM ${CUDAToolkit_INCLUDE_DIRS})
    target_link_libraries(katago CUDA::OpenCL)
  else()
    include_directories(${OpenCL_INCLUDE_DIRS})
    link_directories(${OpenCL_LIBRARY})
    target_link_libraries(katago ${OpenCL_LIBRARY})
  endif()
```

**修改后**:

```cmake
elseif(USE_BACKEND STREQUAL "OPENCL")
  target_compile_definitions(katago PRIVATE USE_OPENCL_BACKEND)
  
  if(ANDROID)
    # Android: 动态链接，运行时加载 libOpenCL.so
    message(STATUS "Android: dynamic linking libOpenCL.so")
    include_directories(SYSTEM ${OpenCL_INCLUDE_DIR})
  else()
    find_package(OpenCL)
    if(NOT OpenCL_FOUND)
      message(WARNING "OpenCL not found, attempting to see if CUDA exists and has OpenCL since sometimes CUDA may provide OpenCL where cmake can't find it.")
      find_package(CUDAToolkit)
      if(NOT CUDAToolkit_FOUND)
        message(FATAL_ERROR "OpenCL installation not found")
      else()
        message(WARNING "OpenCL not found, but found CUDA, attempting to use OpenCL via CUDA.")
      endif()
      include_directories(${OpenCL_INCLUDE_DIRS})
      include_directories(SYSTEM ${CUDAToolkit_INCLUDE_DIRS})
      target_link_libraries(katago CUDA::OpenCL)
    else()
      include_directories(${OpenCL_INCLUDE_DIRS})
      link_directories(${OpenCL_LIBRARY})
      target_link_libraries(katago ${OpenCL_LIBRARY})
    endif()
  endif()
```

**说明**: Android 编译时只需要 OpenCL 头文件，用 stub 库提供链接符号。运行时通过 `LD_LIBRARY_PATH` 加载真实的 clvk `libOpenCL.so`。

> ⚠️ **升级注意**: 新版本 KataGo 的 CMakeLists.txt 可能有新增内容（如 v1.18.0 新增 ROCm/ONNX 后端），补丁需确认 OpenCL 分支位置是否变化，手动调整。

---

## 四、编译步骤

### 步骤 1: 下载 KataGo 源码

```bash
cd /home/ubuntu
git clone https://github.com/lightvector/KataGo.git KataGo-<VERSION>
cd KataGo-<VERSION>
git checkout v<VERSION>   # 如 v1.16.5、v1.18.0
```

### 步骤 2: 应用 CMakeLists.txt 补丁

手动编辑 `cpp/CMakeLists.txt`，应用上述两处修改。

或从之前的编译目录复制已修改的版本：

```bash
cp /home/ubuntu/KataGo-verify-build/cpp/CMakeLists.txt cpp/CMakeLists.txt
# 注意检查版本差异，可能需要手动合并
```

### 步骤 3: 确认 OpenCL 头文件

```bash
# 已存在则跳过
ls /home/ubuntu/OpenCL-Headers/CL/cl.h
```

如需重新下载：

```bash
cd /home/ubuntu
git clone https://github.com/KhronosGroup/OpenCL-Headers.git
```

### 步骤 4: 确认 OpenCL stub 库

```bash
# 已存在则跳过
ls /home/ubuntu/opencl-stub/libOpenCL.so
```

stub 库用途：编译时提供 OpenCL 符号，不引入真实依赖。运行时由 clvk 的 `libOpenCL.so` 替代。

### 步骤 5: 编译

```bash
NDK=/home/ubuntu/android-sdk/ndk/27.1.12297006

cd /home/ubuntu/KataGo-<VERSION>/cpp
mkdir -p build-android-opencl
cd build-android-opencl

cmake .. \
  -DCMAKE_TOOLCHAIN_FILE=$NDK/build/cmake/android.toolchain.cmake \
  -DANDROID_ABI=arm64-v8a \
  -DANDROID_PLATFORM=android-24 \
  -DCMAKE_BUILD_TYPE=Release \
  -DUSE_BACKEND=OPENCL \
  -DUSE_AVX2=0 \
  -DNO_GIT_REVISION=0 \
  -DOpenCL_INCLUDE_DIR=/home/ubuntu/OpenCL-Headers \
  -DOpenCL_LIBRARY=/home/ubuntu/opencl-stub/libOpenCL.so

make -j$(nproc)
```

### 步骤 6: Strip

```bash
$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip katago -o libkatago.so
ls -lh libkatago.so
```

### 步骤 7: 验证产物

```bash
# 检查架构
file libkatago.so
# 应为: ELF 64-bit LSB pie executable, ARM aarch64

# 检查依赖
readelf -d libkatago.so | grep NEEDED
# 应包含: libOpenCL.so, libz.so, libm.so, libdl.so, libc.so
```

### 步骤 8: 集成到项目

```bash
cp libkatago.so \
   ~/weiqi-build/weiqi-bot/clients/app/android/app/src/main/jniLibs/arm64-v8a/libkatago.so
```

---

## 五、libOpenCL.so (clvk)

> clvk 一般不需要随 KataGo 版本更新，除非 KataGo 使用了新的 OpenCL API。

### 下载 termux clvk

```bash
cd /tmp
# 查看最新版本: https://packages.termux.dev/apt/termux-main/pool/main/c/clvk/
curl -sLO 'https://packages.termux.dev/apt/termux-main/pool/main/c/clvk/clvk_<VERSION>_aarch64.deb'

# 解压
dpkg-deb -x clvk_*.deb clvk-extract

# 提取
cp clvk-extract/data/data/com.termux/files/usr/lib/clvk/libOpenCL.so \
   ~/weiqi-build/weiqi-bot/clients/app/android/app/src/main/jniLibs/arm64-v8a/libOpenCL.so
```

### libc++_shared.so

```bash
NDK=/home/ubuntu/android-sdk/ndk/27.1.12297006
cp $NDK/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib/aarch64-linux-android/libc++_shared.so \
   ~/weiqi-build/weiqi-bot/clients/app/android/app/src/main/jniLibs/arm64-v8a/libc++_shared.so
chmod 755 ~/weiqi-build/weiqi-bot/clients/app/android/app/src/main/jniLibs/arm64-v8a/libc++_shared.so
```

---

## 六、运行时配置

### KataGoProcess.kt 关键配置

文件: `clients/app/android/app/src/main/java/com/weiqi/app/katago/KataGoProcess.kt`

#### OpenCL 模式

```kotlin
enum class OpenCLMode {
    SYSTEM,    // 使用系统 OpenCL（不推荐，兼容性差）
    BUNDLED    // 使用打包的 clvk libOpenCL.so（默认）
}
```

BUNDLED 模式下 `LD_LIBRARY_PATH` 只包含 `nativeLibraryDir`：

```kotlin
val libPaths = when (openclMode) {
    OpenCLMode.BUNDLED -> listOf(context.applicationInfo.nativeLibraryDir)
    OpenCLMode.SYSTEM -> listOf(
        "/system/vendor/lib64",
        "/vendor/lib64",
        // ... 更多系统路径
        context.applicationInfo.nativeLibraryDir
    )
}
builder.environment()["LD_LIBRARY_PATH"] = libPaths.joinToString(":")
```

**重要**: BUNDLED 模式下不要包含 `/vendor/lib64` 等系统路径，会加载到不兼容的厂商库。

### 心跳机制

`KataGoProcess.kt` 内置心跳线程：

- 每 15 秒检查 stderr 活跃时间
- 超过 30 秒无 stderr 输出时推送 `katago:heartbeat` 给前端
- 前端收到心跳会重置 120 秒启动超时

### 前端超时

文件: `infrastructure/katago/KataGoNativeClient.ts`

- `startTimeoutMs = 120000` (120 秒)
- 收到 `katago_progress` 或 `katago:heartbeat` 时重置超时

---

## 七、已验证设备

| 设备 | SoC | GPU | OpenCL 模式 | 状态 |
|------|-----|-----|-------------|------|
| 荣耀 HNABR-M | 天玑 MT6855 | PowerVR BXM-8-256 | BUNDLED (clvk) | ✅ |

---

## 八、升级 KataGo 版本 Checklist

1. [ ] 下载新版本源码 `git clone` + `git checkout v<NEW>`
2. [ ] 对比新旧 `cpp/CMakeLists.txt`，确认 OpenCL 分支位置
3. [ ] 应用 Android 补丁（字节序宏 + 动态链接）
4. [ ] 编译 + strip
5. [ ] 验证 `readelf -d` 依赖
6. [ ] 替换 `jniLibs/arm64-v8a/libkatago.so`
7. [ ] 在设备上测试 `version` 命令
8. [ ] 测试 analysis 功能（注意 tuning 可能更慢）
9. [ ] 检查是否需要更新配置文件（`default_gtp.cfg` 等）

### 风险点

- **CMakeLists 冲突**: 新版本可能重构后端代码结构，补丁位置变化
- **新依赖**: 新版本可能引入新的 C++ 库依赖
- **Tuning 超时**: 新版本 tuning 步数可能增加，确认心跳机制有效
- **OpenCL API 兼容性**: 新版本可能使用新的 OpenCL 扩展，clvk 是否支持

---

## 九、参考资料

- [KataGo GitHub](https://github.com/lightvector/KataGo)
- [KataGo Compiling.md](https://github.com/lightvector/KataGo/blob/master/Compiling.md)
- [clvk GitHub](https://github.com/kpet/clvk)
- [termux clvk package](https://github.com/termux/termux-packages/tree/master/packages/clvk)
- [OpenCL Headers](https://github.com/KhronosGroup/OpenCL-Headers)
- 详细编译日志: OpenClaw memory `katago-android-build-archive.md`
- clvk 编译日志: OpenClaw memory `clvk-build-log.md`
