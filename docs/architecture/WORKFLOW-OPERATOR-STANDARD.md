# Workflow 算子标准

## 1. 核心原则

Workflow 是声明式 DAG。算子负责明确能力，Runner 负责调度和数据连线。

1. 配方以 JSON 保存和传输；运行时节点之间传递原生结构化值。
2. 每个算子必须声明输入 Schema、输出 Schema、kind 和幂等性。
3. binding 只做路径引用，不做转换；转换交给明确的数据处理算子。
4. 通用内置算子不得依赖具体网站、平台或围棋业务规则。
5. 插件声明数据契约不等于获得宿主权限。

## 2. 命名与分类

| 类别 | 命名 | 责任 |
|---|---|---|
| 宿主通用算子 | snake_case | 通用数据处理及宿主提供的通用 I/O |
| 插件算子 | <slug>.<method> | 独立安装、启用的扩展能力 |
| Workflow 节点 | step.id | DAG 节点身份 |

kind 必须是以下之一：

- `pure`：纯计算，不访问外部资源。
- `io`：读取外部资源，只能使用宿主提供的受控能力。
- `effect`：产生外部可见动作或状态变化。

## 3. 统一契约

```ts
type OperatorKind = 'pure' | 'io' | 'effect';

interface OperatorSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  kind: OperatorKind;
  idempotent: boolean;
  run(args: Record<string, unknown>): Promise<StepResult>;
}

interface StepResult {
  value: JsonValue;
  effects?: WorkflowEffect[];
}
```

- 所有字段必填，不存在 legacy 或兼容入口。
- inputSchema 描述完整参数对象，根类型必须是 object。
- outputSchema 描述 value，不描述 effects。
- 成功结果必须包含 value；无业务数据时返回 null。
- 首期 JSON Schema 支持 `type`、`properties`、`required`、`items`、`enum`、`additionalProperties`、`description`、`minLength`、`maxLength`、`minimum`、`maximum`。未支持的关键字在注册时直接拒绝。
- 注册时校验 Schema 声明；执行前校验输入，执行后校验输出。

## 4. 数据传递

Runner 直接传递 JS 原生对象、数组、字符串、数字、布尔值和 null。禁止在算子之间执行 JSON.stringify/JSON.parse。

模型 Tool Calling 的参数是 JSON 文本，因此只在 Tool Calling 入口解析一次，再把对象交给同一个 primitive 执行器。Workflow 直接把 binding 合并后的对象交给执行器。

JSON 序列化只用于真实边界，例如配方持久化、网络传输和 QuickJS 沙箱消息，不得成为算子间的数据协议。

Binding 规则：

- from 必须引用更靠前的节点。
- path 是受限属性路径，`$` 表示整个上游 value。
- bindings 在静态 args 之后应用，绑定值覆盖同名静态参数。
- 找不到路径、属性不存在或命中危险属性时，节点失败，不得注入 undefined。
- 不支持函数、表达式、隐式类型转换、数组展开或条件判断。

## 5. 错误与 effects

- 未注册算子、输入校验失败、运行失败、输出校验失败必须可区分。
- Runner 默认失败短路，不自动重试。
- 不把异常堆栈、凭据或敏感响应体回灌模型。
- value 是下游可绑定的数据；effects 是宿主展示/动作通道，下游不能读取 effects。
- idempotent=false 表示重复执行可能改变状态或产生重复副作用；Runner 不得据此自行重试。

## 6. 插件契约

`workflow-operator` 工件的每个 exposes 项必须声明：

```json
{
  "name": "normalize",
  "description": "Normalize records",
  "inputSchema": {
    "type": "object",
    "properties": { "records": { "type": "array" } },
    "required": ["records"],
    "additionalProperties": false
  },
  "outputSchema": { "type": "object" },
  "kind": "pure",
  "idempotent": true
}
```

插件算子注册名为 `<slug>.<method>`。沙箱入口继续使用 `call({ method, args })`，宿主适配器负责把单个参数对象映射到插件入口。插件运行权限由宿主 PluginSpec 决定，Schema 和 kind 不授予权限。

旧 `exposes[].params` 已删除，不再读取。

## 7. 内置算子边界

内置算子只保留跨网站、跨业务可复用的能力：

- 通用数据处理：JSON 提取、正则、文本和格式转换。
- 通用宿主 I/O：HTTP 获取、缓存读取、PDF/图片读取、浏览器采集。
- 宿主 effects：站内导航、列表/表格展示。

具体网站采集、网站专用分页协议、棋手关系业务规则和排名算法不得进入通用内置算子，应归属技能描述或业务插件。

宿主提供通用 `fetch_batch` I/O 算子：输入为 `requests[]`，每项包含公开 URL 和可选字符串 query 参数；宿主负责 URL 安全校验、并发抓取、超时与结果顺序，返回每个请求的结构化结果。它不识别网站、业务字段、棋手身份或网站专用分页协议。

技能描述负责解释业务参数及其映射关系，并根据用户输入生成请求列表。例如野狐技能可以声明昵称如何解析成 UID、哪些 UID 需要抓取、分页 URL 如何组成，再把最终 URL 列表交给 `fetch_batch`。其它网站技能可以使用完全不同的业务参数和 URL 规则，但共用同一个宿主算子。需要动态游标分页时，由技能按返回结果继续构造下一批请求；宿主不内置任何站点分页逻辑。
