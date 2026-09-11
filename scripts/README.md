# Scripts

构建和资源管理脚本。

## 可用脚本

### build-assets.mjs

构建后资源拷贝和版本文件生成。将 shared 组件、TF.js WASM、模型文件、棋盘图片、KataGo 配置等拷贝到 dist-web/，并生成 version.json。

### build-cli.sh

CLI 打包为单一可执行文件（Node.js SEA）。通过 esbuild bundle → SEA blob → 注入 Node 二进制，产出无需安装 Node.js 的独立可执行文件。

### generate-joseki-tree.mjs

定式 Trie 树数据生成。从 ~/.weiqi-joseki/database.json 读取定式，构建 Trie 树，按前缀裁剪导出索引、子树和做题数据到 clients/web/shared/assets/data/joseki/。

### help.mjs

列出所有可用的 npm 命令，按构建、测试、开发、数据生成、发布、清理分组展示。

### patch_cmake_android.py

KataGo Android 编译补丁。修改 CMakeLists.txt，修复 Android 字节序宏定义并为 OpenCL 后端添加动态链接支持。

### patch_wmma_skip.py

KataGo WMMA 跳过补丁。在 FP16 Tensor Core 调试阶段检测设备是否支持 cl_arm_matrix_ops 扩展，不支持则跳过 WMMA 调参，避免非 Mali OpenCL 实现（如 clvk）崩溃。

### update-rankings.js

更新月度榜单数据。

### upgrade-katago-android.sh

升级 Android 端 KataGo 版本。自动下载源码、应用 Android 补丁、交叉编译 arm64-v8a、strip、验证产物并集成到 jniLibs。

Usage:

  npm run upgrade:katago -- 1.18.0
  ./scripts/upgrade-katago-android.sh 1.18.0
  ./scripts/upgrade-katago-android.sh 1.18.0 --skip-clvk
  ./scripts/upgrade-katago-android.sh 1.18.0 --dry-run
  ./scripts/upgrade-katago-android.sh 1.18.0 --keep-source
