# KataGo Android 编译说明

## 源码下载

```bash
git clone https://github.com/lightvector/KataGo.git
cd KataGo/cpp
```

或下载指定版本：

```bash
wget https://github.com/lightvector/KataGo/archive/refs/tags/v1.16.5.tar.gz
tar -xzf v1.16.5.tar.gz
cd KataGo-1.16.5/cpp
```

## OpenCL 头文件

```bash
git clone https://github.com/KhronosGroup/OpenCL-Headers.git
```

## CMakeLists.txt 修改

### 修改1: 添加 Android 字节序宏

在 `project(katago)` 的 `endif()` 后添加：

```cmake
if(ANDROID)
  set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -DBYTE_ORDER=1234 -DLITTLE_ENDIAN=1234 -DBIG_ENDIAN=4321")
endif()
```

### 修改2: OpenCL 链接

替换 OpenCL 分支（约第 452-468 行），让 Android 使用动态链接：

```cmake
elseif(USE_BACKEND STREQUAL "OPENCL")
  target_compile_definitions(katago PRIVATE USE_OPENCL_BACKEND)
  
  if(ANDROID)
    # Android: 动态链接，运行时加载 libOpenCL.so
    message(STATUS "Android: dynamic linking libOpenCL.so")
    include_directories(SYSTEM ${OpenCL_INCLUDE_DIR})
    # 编译时链接 termux 的 libOpenCL.so（提供符号）
    target_link_libraries(katago /path/to/libOpenCL.so)
  else()
    find_package(OpenCL)
    # ... 原有逻辑
  endif()
```

## 编译命令

```bash
export ANDROID_NDK=/path/to/ndk
mkdir build-android && cd build-android

cmake ..   -DUSE_BACKEND=OPENCL   -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK/build/cmake/android.toolchain.cmake   -DANDROID_ABI=arm64-v8a   -DANDROID_PLATFORM=android-28   -DCMAKE_BUILD_TYPE=Release   -DNO_GIT_REVISION=1   -DOpenCL_INCLUDE_DIR=/path/to/OpenCL-Headers

make -j$(nproc)

# strip
$ANDROID_NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip katago -o libkatago.so
```

**产物**: `libkatago.so`，动态依赖 `libOpenCL.so`

## 运行时依赖

### libOpenCL.so（termux clvk，带编译器）

下载: https://packages.termux.dev/apt/termux-main/pool/main/c/clvk/

```bash
dpkg-deb -x clvk_*.deb clvk-extract
cp clvk-extract/data/data/com.termux/files/usr/lib/clvk/libOpenCL.so jniLibs/arm64-v8a/
```

### libc++_shared.so

从 NDK 复制：

```bash
cp $ANDROID_NDK/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib/aarch64-linux-android/libc++_shared.so jniLibs/arm64-v8a/
```

## 整合

```
jniLibs/arm64-v8a/
├── libkatago.so
├── libOpenCL.so
└── libc++_shared.so
```

## 运行时加载

`KataGoProcess.kt`:

```kotlin
builder.environment()["LD_LIBRARY_PATH"] = context.applicationInfo.nativeLibraryDir
```
