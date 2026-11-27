# Workflow 算子标准（v1）

> 状态：第一版规范基线。先统一契约和演进规则；未声明新契约的旧算子继续按 legacy 方式运行，不因升级规范而失效。

## 1. 目标与原则

Workflow 是声明式 DAG。算子负责明确能力，Runner 负责调度和数据连线。

1. 配方以 JSON 保存和传输；运行时节点之间传递原生结构化值，不把 JSON 字符串当作数据协议。
2. 连线只传 value；effects 是宿主副作用通道，不参与下游数据绑定。
3. 新算子必须声明输入和输出 Schema；旧算子迁移期可暂缺。
4. binding 只做引用，不做转换；转换交给明确的数据处理算子。
5. 通用内置算子不得依赖具体网站、围棋业务术语或业务规则。
6. 插件声明数据契约不等于获得宿主权限。

## 2. 命名与分类

| 类别 | 命名 | 责任 |
|---|---|---|
| 宿主通用算子 | snake_case | 通用数据处理、宿主提供的通用 I/O |
| 插件算子 | <slug>.<method> | 可独立安装/启用的扩展能力 |
| Workflow 节点 | step.id | DAG 节点身份，不是算子名 |

每个算子还应声明 kind：
- pure：纯计算，不访问外部资源。
- io：读取外部资源，依赖宿主注入的受控能力。
- effect：产生外部可见动作或状态变化。

UI 展示、导航链接等宿主动作通过 effects 表达，不伪装成普通数据输出。

## 3. 统一算子契约

标准化后的逻辑接口：

```ts
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

interface OperatorSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  kind: 'pure' | 'io' | 'effect';
  idempotent: boolean;
  run(args: Record<string, unknown>, context: OperatorContext): Promise<OperatorResult>;
}

interface OperatorResult {
  value: JsonValue;
  effects?: WorkflowEffect[];
}

interface OperatorContext {
  signal?: AbortSignal;
  // 宿主注入的受控能力，不是插件可自行申请的权限。
}
```

约定：
- value 必须存在；没有业务数据时返回 null，不用 undefined 表示成功。
- v1 的 value 必须是 JSON 值。二进制、大文件、超长正文后续通过宿主管理的 Handle 扩展。
- inputSchema 描述完整参数对象，根类型必须为 object。
- outputSchema 描述 value，不描述 effects。
- Schema 采用 JSON Schema Draft 7 兼容子集。首期支持 type、properties、required、items、enum、additionalProperties、description 等常用关键字；未实现的关键字不得被静默当作已校验。
- 新契约字段迁移期可选；新建/新发布算子必须完整声明。

## 4. 数据传递与 bindings

示例：

```json
{
  "id": "render",
  "call": "display_json_list",
  "bindings": [
    { "from": "fetch", "path": "$.items", "as": "items" }
  ]
}
```

- from 必须引用更靠前的节点。
- path 是受限属性路径，不是表达式；$ 表示整个 value。
- as 是目标输入参数名。
- bindings 在静态 args 之后应用，绑定值覆盖同名静态参数。
- 同一节点内不允许多个 binding 写入同一个 as；解析期应拒绝。
- 找不到路径、遇到危险属性或属性不存在时，节点失败，不得静默注入 undefined。
- 不支持函数、表达式、隐式类型转换、数组展开或条件判断。

### 运行时与校验

Runner 内部直接传递 JS 原生对象、数组、字符串、数字、布尔值和 null。禁止每经过一个节点就 JSON.stringify/parse。

JSON 序列化只允许发生在真实边界：
- workflow 配方持久化或网络传输；
- 插件 QuickJS 沙箱输入/输出；
- 明确的外部协议边界。

内置算子逐步从旧 execute(argsJson: string) 迁移为对象参数接口。迁移完成前，旧接口只允许存在于兼容适配层。

- 安装/解析阶段：检查 Schema 声明本身、算子名（有可用注册表时）、binding 来源节点及路径的基本合法性。
- 运行阶段：调用前按 inputSchema 校验合并后的 args；调用成功后按 outputSchema 校验 value。
- 旧算子没有 Schema 时按 legacy 模式运行并标记未标准化；不得伪造宽松 Schema 冒充已校验。
- 类型不匹配时指出算子名、参数/输出路径、期望类型和实际类型。

## 5. 错误标准

内部统一错误结构：

```ts
interface OperatorError {
  code: string;
  message: string;
  retryable: boolean;
  details?: {
    path?: string;
    expected?: string;
    actual?: string;
    [key: string]: unknown;
  };
}
```

- Runner 默认失败短路，不自动重试。
- 不把异常堆栈、凭据、完整敏感响应体回灌模型。
- 未注册算子、输入校验失败、算子运行失败、输出校验失败必须可区分。

## 6. Effects、副作用与幂等性

value 是数据；effects 是宿主可见副作用，二者分离。首期保留现有宿主展示效果（Markdown 展示、导航链接），但统一为可扩展的带类型结构。Runner 只收集 effects，由宿主负责渲染/执行；下游 binding 永远不能读取 effects。

- pure 算子不得访问网络、时钟、存储或 UI。
- io 算子只能使用宿主明确注入的 I/O 能力。
- effect 算子必须明确声明副作用类别。
- idempotent=false 表示重复执行可能改变结果或产生重复副作用；Runner 不得据此自行重试。
- 插件运行环境继续默认零权限；Schema、kind、effects 声明都不能替代宿主权限检查。

## 7. 插件契约

Workflow 插件继续使用 workflow-operator 扩展点和 <slug>.<method> 命名。每个 expose 方法逐步标准化为：

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
  "outputSchema": {
    "type": "object",
    "properties": { "items": { "type": "array" } },
    "required": ["items"]
  },
  "kind": "pure",
  "idempotent": true
}
```

- 旧 exposes[].params 暂作为 inputSchema 的兼容别名读取。
- 新插件使用 inputSchema/outputSchema；params 不再被视为完整的双向契约。
- 沙箱入口仍为 call({ method, args })，宿主对外统一表现为对象参数 run(args)。
- 插件输出必须是 JSON 值；沙箱边界负责序列化和配额限制。

## 8. 内置算子边界

内置算子只保留跨网站、跨业务可复用的通用能力，以及必须由宿主掌控的环境能力。

- 通用数据处理：JSON 提取、正则、数组/对象映射、过滤、排序、分组、文本和格式转换。
- 宿主 I/O 能力：HTTP 获取、缓存读取、PDF/图片读取、浏览器采集。
- 宿主 effects：站内导航、列表/表格展示。
- 具体网站采集、网站专用分页协议、棋手关系业务规则、排名算法：业务插件，不属于通用内置算子。

不要求把完整业务动作拆成几十个基础算子。通用层提供稳定、可组合的原语；业务插件可以封装网站特有的完整采集流程，并输出标准化数据。

## 9. 兼容与迁移顺序

1. 契约文档与类型：确立统一类型、Schema 约定、错误和 effects 模型。
2. 注册表兼容层：OperatorSpec 统一对象参数执行；旧 SkillPrimitive 由 adapter 包装。
3. Schema 校验：注册时检查声明，运行时校验输入/输出；legacy 算子暂不阻断运行。
4. 插件升级：新插件使用 inputSchema/outputSchema；旧 params 兼容读取。
5. 内置算子迁移：逐个补 Schema、移除内部 JSON 字符串往返。
6. 业务算子迁移：将网站/围棋业务算子迁到业务插件，最后移除兼容代码。

每一步都应保持既有配方 JSON 和现有 workflow 行为兼容；本轮标准化不顺手改变业务流程或算子边界。
