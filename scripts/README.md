# Scripts

构建和资源管理脚本。

## 可用脚本

### build-assets.mjs

构建后资源拷贝和版本文件生成。将 shared 组件、TF.js WASM、模型文件、棋盘图片、KataGo 配置等拷贝到 dist-web/，并生成 version.json。

### generate-joseki-tree.mjs

定式 Trie 树数据生成。从 `~/.weiqi-joseki/database.json` 读取定式，构建 Trie 树，按前缀裁剪导出索引、子树和做题数据到 `clients/web/shared/assets/data/joseki/`。

```bash
node scripts/generate-joseki-tree.mjs [--threshold 1000] [--db <path>] [--output <path>]
```

### update-rankings.js

更新月度榜单数据。
