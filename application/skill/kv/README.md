# Skill 本地数据层（application/skill/kv）

给技能生态用的、宿主托管、按域隔离的本地存储。模型通过一组 `kv_*` 原语存取，
**只能给逻辑域名**，物理键 / namespace / dbName 全部由宿主写死；敏感域的值
永远不进入模型上下文。

## 分层与扩展点

| 层 | 文件 | 职责 | 加新场景时要不要改 |
|---|---|---|---|
| 契约 | `KvTypes.ts` | `KvDriver` / `KvDomainDescriptor` / 能力枚举 / 工具名表 | 只有**新增能力种类**时加一个枚举值 + 工具名 |
| 驱动 | `KvDrivers.ts` | 包 `infrastructure/storage` 里现成适配器 | **要**：加一个驱动 |
| 域注册 | `KvDomains.ts` | 把域名绑到驱动 + 可见性/写入/配额策略 | **要**：加一条描述符 |
| 内核 | `KvService.ts` | 参数校验、物理键映射、策略裁决、能力分派 | **不要** |
| 工具 | `KvPrimitives.ts` | 按能力并集生成 `kv_*` 定义、system 说明 | 新增能力时加一条工具素材 |
| 装配 | `KvKit.ts` + `ChatPage` / `ChatUseCase` | 一键注入 | **不要** |

**加一类存储（例：全文检索 / 大文件）只需要三步**：

1. 在 `KvDrivers.ts` 写一个驱动，包现有适配器（大文件用
   `IndexedDBFileAdapter` / `IFileStorage`，已支持 Blob、`readChunk`、`listFiles`；
   检索可用 `IndexedDBAdapter.find({where})` 或自建索引），声明额外能力
   （`query` / `blob`）并实现 `invoke()`；
2. 在 `createDefaultKvDomains()` 加一条 `KvDomainDescriptor`；
3. 若是全新能力种类，在 `KvTypes.ts` 的 `KvCapability`、`KV_TOOL_NAMES` 与
   `KvPrimitives.ts` 的 `KV_FACTORS` 各加一项。

`KvService` 对基础能力走 5 个固定 case，其余能力**一律委派给
`driver.invoke()`**，没有 per-capability 分支；`createKvPrimitives()` 按
`capabilities()` 并集动态生成工具，所以新驱动声明 `query` → `kv_query` 自动出现。
单测 `KvFramework.test.ts` 用「模拟检索驱动」验证过这条扩展路径。

## 复用现有基础设施

- `LocalStorageAdapter`（命名空间 `weiqi-bot-kv`，与其它模块的 `weiqi-bot`
  命名空间物理隔离）→ `prefs` / `secrets`
- `IndexedDBAdapter`（专属 `weiqi-skill-kv` 库）→ `checkpoints` 大对象
- 未来：`IndexedDBFileAdapter`（`IFileStorage`）、`LocalStorageCacheAdapter`（TTL）、
  `LibraryChunkStore`（分块回收范式）、`StoragePluginRegistry`（注册范式）
- `CONTEXT_LIMITS.maxCharsPerMessage` → 观察文本预算与 `prefs` 单条上限
  （唯一数值出处，见下）

## 域策略

| 域 | 后端 | visibility | writableBy | 说明 |
|---|---|---|---|---|
| `prefs` | localStorage | readable | model | 自选股、默认分类等使用偏好；模型可读写 |
| `secrets` | localStorage | **opaque** | **host** | 敏感数据（不止密钥）：模型读不到值、不能写/删，只有面板可录入 |
| `checkpoints` | IndexedDB | readable | model | 长会话 compact 摘要 / 任务状态，大值用 `kv_slice` 分页 |

`opaque` 是**通用敏感策略**，不限于 API key：任何域标成 opaque，模型经
`read`/`list`/`slice`/`query` 都拿不到值，只回元信息。宿主代码用
`KvService.readRaw() / put() / remove() / listMeta()` 消费明文（面板录入、P2
直连认证拼 header），那条路径不经过模型、不写进会话历史。

## 数值来源（项目铁律）

框架里唯一的数值是 `prefs` 单条上限 = `CONTEXT_LIMITS.maxCharsPerMessage`
（一条偏好必须能完整放进一条观察）。它是宿主具名常量，不是验证集扫出来的
经验值；`kv_slice` 的分页预算同源。后端容量（localStorage ~5MB / IndexedDB 配额）
交给基础设施自身，不另设 magic number。

## 边界

- key 限 `[A-Za-z0-9_.-]{1,128}`，杜绝 `../`、`:` 等路径玩法；
- 模型参数里没有 namespace / dbName / 任意物理键，碰不到其它模块的存储；
- 写入失败（受限 / 超上限 / 后端不可用）如实回执，不谎报已保存；
- `kv_read` 超观察上限时明确提示改用 `kv_slice`，不静默截断；
- 只读操作 `preparatory=true`，不消耗 ToolLoop 自主决策预算。

## 尚未做（后续分期）

- **P1 用户面板**：「🧠 技能」或设置页列出 / 编辑 / 删除各域条目；`secrets` 只在
  此录入。宿主接口已备好（`put / readRaw / remove / listMeta`）。
- **P2 直连鉴权**：带 Authorization 的 REST 由端侧直连（不经代理），宿主用
  `readRaw()` 取凭据拼 header；工具侧不暴露密钥。
- **P3 compact / checkpoint**：`ChatUseCase` 在窗口裁剪前后写
  `checkpoints` 域，属宿主内部行为，不必暴露给模型。
