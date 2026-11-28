# Workflow 算子与执行标准

## 1. 核心原则

Workflow 是声明式执行图。Runner 负责流程控制、数据连线和资源预算；算子只负责单一、明确的能力。

1. 配方以 JSON 保存和传输，节点之间传递原生结构化值。
2. 宿主能力必须通用，不绑定具体网站、账号或业务。
3. 通用 JSON / regex 纯计算由宿主内置 Workflow 算子承担；业务领域计算才使用受限插件。
4. 插件声明数据契约不代表获得宿主权限。
5. 不让 LLM 自己协调分页、循环、批量抓取或数据拼装。

## 2. 算子契约

OperatorSpec 必须声明 name、description、inputSchema、outputSchema、kind、idempotent 和 run。kind 只能是 pure、io、effect。inputSchema 根类型必须是 object；outputSchema 描述 value，不描述 effects。成功结果必须包含 value；无业务数据时返回 null。

Binding 只做路径引用，不做数据转换。普通节点失败默认短路，不自动重试。

## 3. Workflow 控制结构

### forEach

- from/path 读取前序节点的数组。
- 每项执行时提供 item 与 index 作用域变量。
- 默认 onError=fail，单项失败会终止整个循环。
- onError=continue 时失败项记录为 {ok:false,error}，成功项记录为 {ok:true,value}，继续处理后续项。
- 循环结果按输入顺序自动收集，不需要额外 collect 算子。

### repeat

- 每轮提供 state 作用域。
- initialState 声明初始状态。
- stateFrom 从本轮内部节点结果更新下一轮状态。
- until 必须引用本轮内部节点产出的 boolean。
- maxIterations 是每个 repeat 的最大轮数。
- 输出为 {items,state,stopped}；items 自动收集每轮最后一个节点的 value。

### ifElse

- condition 必须引用前序节点的 boolean value，不执行任意表达式。
- 只运行选中的 then 或 else 分支；分支内可以继续嵌套控制结构。
- 输出为 {condition,value}，value 是选中分支最后一个节点的结果。

### 预算与作用域

- 单个循环最多 100 次；Workflow 总循环预算最多 500 次，嵌套循环共享预算。
- 默认串行执行，不引入隐式并发。
- item、index、state 只在对应循环作用域内有效。
- URL 参数需要编码时使用 {{urlencode.input.xxx}}、{{urlencode.item.xxx}} 或 {{urlencode.state.xxx}}；不支持任意表达式。

## 4. 数据传递

Runner 直接传递 JS 原生对象、数组、字符串、数字、布尔值和 null。禁止在算子之间把 JSON 字符串当作数据协议。

- from 必须引用更靠前的节点。
- path 是受限属性路径，$ 表示整个上游 value。
- bindings 在静态 args 之后应用，绑定值覆盖同名静态参数。
- 找不到路径、属性不存在或命中危险属性时，节点失败，不得注入 undefined。
- 不支持函数、表达式或隐式类型转换。

## 5. 宿主能力边界

宿主 Workflow 提供通用流程控制、网络、展示、导航与本地偏好存储能力：

| 能力 | 职责 |
|---|---|
| forEach | 遍历数组、执行子流程、收集结果 |
| repeat | 根据状态与停止条件重复执行 |
| ifElse | 根据 boolean 结果选择分支 |
| web_fetch | 单次受控网络请求 |
| web_cache_read | 读取宿主管理的网页缓存 |
| display | 展示任意 JSON 结构或 Markdown |
| navigate_to | 生成站内导航链接 |
| storage.get / storage.set / storage.delete | 读写或删除宿主管理的用户偏好；复用 KvService 域策略，不开放 opaque / host-only 域 |

不提供业务专用抓取算子，也不提供通用 fetch_batch。批量请求由 forEach + web_fetch 组合。PDF/图片解析不属于本轮 Workflow 宿主能力。

display 只负责展示：字符串按 Markdown 渲染；数组自动生成列表或表格；对象按层级生成 Markdown。结构化数据通过宿主展示旁路交付，不进入 LLM 上下文。

## 6. 宿主数据算子与领域插件边界

JSON 与 regex 是宿主内置的纯计算 Workflow 算子，名称分别为 `json.<action>` 与 `regex.<action>`。它们直接消费上游原生值，不启动 QuickJS Worker、不需要安装插件，也不访问网络、缓存、存储、时钟或 DOM。

- JSON 算子提供 parse/stringify/get/set/select/pluck/concat/unique/append/groupCount/sortBy/take/isEmpty/assert/flatten/toString。
- regex 算子提供 match/extract/replace；宿主限制输入长度、模式长度、匹配数量，并拒绝常见灾难性回溯模式，避免同步正则长时间阻塞主线程。
- `calendar`、`circle` 等业务领域算子仍通过 `workflow-operator` 插件注册，方法名为 `slug.method`，仅处理输入数据，不得把网络访问或宿主权限藏进插件。
- 技能依赖扫描只为领域插件生成自动安装依赖；`json.*`、`regex.*` 与 `storage.*` 是宿主能力，不弹插件安装界面。
- 每个 exposes 项声明 inputSchema、outputSchema、kind、idempotent；插件提供 smoke 样例。
- 技能安装器递归扫描普通节点、forEach、repeat、ifElse 分支中的插件依赖，按资源 ID 去重；已安装插件不重复安装。

## 7. QuickJS 沙箱生命周期

- 每次插件算子调用创建独立 Worker、QuickJS Runtime 与 Context。
- 调用成功、失败、超时或 Worker 消息异常后立即 terminate Worker；不跨算子复用执行环境。
- dispose 是幂等释放边界；迟到消息不得影响后续调用。

## 8. 错误与 effects

- 未注册算子、输入校验失败、运行失败、输出校验失败必须可区分。
- 不把异常堆栈、凭据或敏感响应体回灌模型。
- value 是下游可绑定的数据；effects 是宿主展示/动作通道，下游不能读取 effects。
- idempotent=false 表示重复执行可能改变状态或产生重复副作用；Runner 不得据此自行重试。
