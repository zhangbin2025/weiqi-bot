# Scripts

构建和资源管理脚本。

## 可用脚本

### build-assets.mjs

构建后资源拷贝和版本文件生成。将 shared 组件、TF.js WASM、模型文件、棋盘图片、KataGo 配置等拷贝到 dist-web/，并生成 version.json。

### generate-joseki-tree.mjs

定式 Trie 树数据生成。从 ~/.weiqi-joseki/database.json 读取定式，构建 Trie 树，按前缀裁剪导出索引、子树和做题数据到 clients/web/shared/assets/data/joseki/。

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
