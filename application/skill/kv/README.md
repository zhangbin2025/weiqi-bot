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
| `prefs` | localStorage | readable | model | 自选股、默认分类等使用偏好；模型可读写（`stock.quote` v3 自选股池即存这里的 `stock.watchlist`） |
| `secrets` | localStorage | **opaque** | **host** | 敏感数据（不止密钥）：模型读不到值、不能写/删，只有宿主凭据弹框 / 直连链路可录入 |
| `checkpoints` | IndexedDB | readable | **host** | 宿主内部生成的长会话 compact 摘要 / 任务状态；模型只可 `kv_read` / `kv_slice` 分页查看，不可写/删，大值用 `kv_slice` 分页 |

`opaque` 是**通用敏感策略**，不限于 API key：任何域标成 opaque，模型经
`read`/`list`/`slice`/`query` 都拿不到值，只回元信息。宿主代码用
`KvService.readRaw() / put() / remove() / listMeta()` 消费明文（凭据弹框录入、
`http_fetch_auth` 直连认证拼 header），那条路径不经过模型、不写进会话历史。

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

## 分期状态

- **P1 独立「本地数据」面板 —— 已否定并撤除**：用户明确不要一个可浏览 / 编辑各域条目的
  常驻面板。凭据只在「要用它的那一刻」由 LLM 贴一条 `secret-prompt:<key>` 链接、
  宿主弹框录入，保存后自动回灌继续请求。宿主接口（`put / readRaw / remove / listMeta`）
  保留给弹框与直连链路使用，不再做 UI 列表。
- **P2 通用直连鉴权 —— 已落地**：`http_fetch_auth` 由宿主按配方 `secrets` 纯声明规格
  （`allowedHosts` / header 拼法 / `reauthStatuses`）查表执行，端侧直连（不经代理），
  `readRaw()` 取凭据拼 header；模型只给 `url` + `secretKey`，永远接触不到明文。
  接入新的认证 API = 加一条配方声明，不改内核 / 工具签名 / 弹框。
- **P2' 使用偏好（自选股池）—— 已落地**：`prefs` 域的第一个真实场景，与 `secrets`
  刻意做成镜像。配方 `stock.quote` v3 在报价后附一条
  `[添加到自选](stock-watch-add:<代码>)` markdown 链接；宿主 `ChatPage.bindPrefLinks()`
  用 document 事件委托接管，**一行存储都不写**，只回灌一条正常用户消息
  （`watchAddUserMessage`），由 LLM 按配方指令自己调 `kv_read('prefs','stock.watchlist')`
  → 去重 → `kv_write` 保存并回执。用户说「查询自选股票当前股价」时同样由 LLM 读回
  代码列表、一次 `web_fetch` 多代码查询、按列表播报。
  - 宿主不托管写入，是为了模型上下文里始终有这份偏好，不会出现「宿主偷偷写了、
    模型下一轮却不知道」的劈叉；也与 `secrets` 的「宿主独占写、明文不过模型」形成对照。
  - 链接只带一个经形状校验的股票代码（`PrefLink.ts` 的 `STOCK_CODE_RE`），
    不携带待写入的值 / URL / JSON，脏 href 静默忽略。
  - **没有新增原语**：`kv_*` 是 chat 角色恒定挂载的通用能力，配方直接引用即可；
    这也验证了「加场景不改内核 / 工具签名 / 装配」的扩展点。
- **P3 compact / checkpoint —— 已落地（P3a）**：`ConversationCompactor` 在每轮
  `ChatUseCase.runTurn()` 前**同步**执行（用户 2026-11-19 决策①）：
  `planConversationWindow()` 算出「完整历史里被窗口丢掉的旧消息」，只要真有丢弃就
  触发；没有丢弃不触发。触发判据是**可观测事实**，不是「快满了」的比例阈值，
  不引入新 magic number，只消费既有 `CONTEXT_LIMITS`。
  - 摘要走 `chat.compact` 旁路纯文本调用（同 `generateSessionTitle()` 范式）：不挂工具、
    不入历史、不进过程块、不进会话历史；**增量蒸馏**（只喂上一版摘要 + 新增被丢消息），
    不把全量历史反复喂给端点。
  - 每次 compact **追加**一条 checkpoint（`version / seq / sessionId / summary /
    firstKeptIndex / fromTs / toTs / reason / createdAt`），链与「最新 seq」指针留在
    `checkpoints` 域；当前会话只注入最新一条。完整历史不删，仍在
    `ChatHistoryManager` / `FavoriteService`。
  - 下一轮上下文 = `[主 system] + [摘要 system] + [最近 kept（含当前句）]`。摘要是
    独立 system 消息，避免被 ToolLoop 的 `systemPrompt` 替换制冲掉。
  - `checkpoints` 域 **`writableBy:'host'`（决策②）**：checkpoint 是宿主对「模型本轮
    所见上下文」的内部快照，不是模型可自己编造/改写的业务数据；模型仍可读、可分页。
    域清单与工具描述已同步为「仅宿主可写，模型只读」，并有单测锁住。
  - 会话 id 形如 `session:1690000000000:abc123`（含冒号），不符合 `KV_KEY_RE`；
    用 `md5(sessionId)` 的确定性短前缀做键，不新增常量、不改会话 id 生成规则。
  - 摘要请求**不带图片 / PDF base64**，只带 `describeAttachment()` 的文字描述；
    旧附件本体仍留在完整历史里。摘要输出按 `CONTEXT_LIMITS.maxCharsPerMessage`
    硬截断兜底（宿主已有的单条上限，不是新阈值）。
  - 失败静默降级：摘要失败 / 存储不可用 / gateway 未就绪 → 退回现有窗口裁剪，
    对话照常，不抛错、不提示、不重试。
  - 溢出恢复：端点报上下文超限 → 同一 turn **封顶重试 1 次**，窗口收到最小
    （主 system + 摘要 + 当前句），不改任何窗口常量；普通错误照旧渲染失败提示。
  - 暂未做（P3b）：wire 层精确溢出错误识别（当前是保守文案匹配 + 可注入钩子）、
    手动 `/compact`、UI 显示「已压缩 N 轮」。跨会话 / 向量检索 / 记忆外置 /
    模型自主决定 compact 不在本期范围。
