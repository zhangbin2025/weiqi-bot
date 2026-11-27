/**
 * Skill 本地数据层 —— 模型可见原语（工具集按能力并集动态生成）
 * @module application/skill/kv/KvPrimitives
 *
 * 生成逻辑：
 * - 工具表 KV_FACTORS 按 KvCapability 索引，每个能力一条工具定义素材；
 * - createKvPrimitives() 取 KvService.capabilities() 的并集，只为「已注册域实际具备」
 *   的能力生成工具。于是加一个声明 'query' 的驱动 → kv_query 自动出现，装配代码不动；
 * - 所有工具通过同一个 KvService.execute(capability, args) 分派，工具定义里不写业务策略，
 *   domain 清单由 domainsText 动态拼进 description（模型注册工具时即看到可用域）。
 *
 * 边界写进工具定义（不是只靠 system prompt）：
 * - domain 只给逻辑名，物理键 / namespace / dbName 由宿主写死；
 * - 敏感域（opaque）任何工具都拿不到值、不能由模型写入；
 * - 大值分页读按 offset/length，观察不超过宿主具名常量，鼓励继续翻页而不是凭预览编造。
 */

import type { SkillPrimitive, PrimitiveResult } from '@application/skill/SkillTypes';
import type { ModelToolDefinition } from '@application/model/IModelGateway';
import type { KvCapability, KvToolFactor, KvServiceLike, KvOutcome, KvDomainDescriptor } from './KvTypes';
import { KV_TOOL_NAMES } from './KvTypes';

/**
 * 域清单文本：让模型在注册工具那一刻就知道有哪些域、各自放什么、能不能写。
 * 可读性与写权限都从域描述符直接取（单一出处），不把「哪些域不能写」写死在
 * 某个工具描述里 —— 否则改 `writableBy` 后工具说明会悄悄过期。
 */
export function renderDomains(domains: readonly KvDomainDescriptor[]): string {
  if (domains.length === 0) return '（当前没有可用域）';
  return domains.map((d) => {
    const read = d.visibility === 'opaque' ? '敏感值不回显' : '值可回显';
    const write = d.writableBy === 'model'
      ? '模型可读写'
      : (d.writableBy === 'host' ? '仅宿主可写，模型只读' : '模型与宿主均可写');
    return `- ${d.name}：${d.summary}（${read}；${write}）`;
  }).join('\n');
}

/** 所有工具共用的 domain 参数说明 */
function domainProperty(): Record<string, unknown> {
  return { type: 'string', description: '域名（见工具说明里的可用域清单），不是物理键' };
}
function keyProperty(desc = '键名，1~128 位字母数字 _ . -'): Record<string, unknown> {
  return { type: 'string', description: desc };
}

/** 能力 → 工具定义素材。新增能力在此加一条即可（KvService / 装配都不用改）。 */
export const KV_FACTORS: Readonly<Record<KvCapability, KvToolFactor>> = {
  read: {
    definition: (domains) => ({
      name: KV_TOOL_NAMES.read,
      description:
        '从本地数据层按键读取一条值。只给 domain 与 key，物理存储位置由宿主决定。'
        + '敏感域（opaque）永远不回显值，只回「存在 + 大小 + 更新时间」。'
        + '\n可用域：\n' + domains,
      parameters: {
        type: 'object',
        properties: { domain: domainProperty(), key: keyProperty() },
        required: ['domain', 'key'], additionalProperties: false,
      },
    }),
  },
  write: {
    definition: (domains) => ({
      name: KV_TOOL_NAMES.write,
      description:
        '把一条可 JSON 序列化的值保存到本地数据层（覆盖同键）。domain 只给逻辑名。'
        + '仅「模型可读写」的域可写；宿主独占域（如 secrets 凭据、checkpoints 摘要）由宿主/用户面板维护，'
        + '模型写入一律被拒绝，不要试图写到别的域绕过。'
        + '值必须能放进单条观察（超出该域声明的上限会被拒绝，如实告知用户，不要改域）。'
        + '\n可用域：\n' + domains,
      parameters: {
        type: 'object',
        properties: {
          domain: domainProperty(),
          key: keyProperty(),
          value: { description: '任意可 JSON 序列化的值（字符串 / 数字 / 数组 / 对象）' },
        },
        required: ['domain', 'key', 'value'], additionalProperties: false,
      },
    }),
  },
  remove: {
    definition: (domains) => ({
      name: KV_TOOL_NAMES.remove,
      description:
        '删除本地数据层里的一条。仅「模型可读写」的域可删；宿主独占域模型删除会被拒绝。'
        + '\n可用域：\n' + domains,
      parameters: {
        type: 'object',
        properties: { domain: domainProperty(), key: keyProperty() },
        required: ['domain', 'key'], additionalProperties: false,
      },
    }),
  },
  list: {
    definition: (domains) => ({
      name: KV_TOOL_NAMES.list,
      description:
        '列出某个域的键名与元信息（大小 / 更新时间），**不返回值**。'
        + '敏感域也可列，但只看得到键名。可用 prefix 做键名前缀过滤。'
        + '\n可用域：\n' + domains,
      parameters: {
        type: 'object',
        properties: { domain: domainProperty(), prefix: keyProperty('可选：键名前缀过滤') },
        required: ['domain'], additionalProperties: false,
      },
    }),
  },
  slice: {
    definition: (domains) => ({
      name: KV_TOOL_NAMES.slice,
      description:
        '大值分页读：把一条值按字符区间读出，用于 checkpoint / 长文本。'
        + '不给 length 时按宿主单条观察上限自动推导；观察尾部会提示是否到末尾，'
        + '未到末尾就用 offset 继续翻页，绝不凭预览编造后面的内容。'
        + '敏感域不回显内容，只给元信息。'
        + '\n可用域：\n' + domains,
      parameters: {
        type: 'object',
        properties: {
          domain: domainProperty(),
          key: keyProperty(),
          offset: { type: 'number', description: '起始字符偏移（0 起），不传为 0' },
          length: { type: 'number', description: '本次读多少字符；不传按观察上限推导' },
        },
        required: ['domain', 'key'], additionalProperties: false,
      },
    }),
  },
  query: {
    definition: (domains) => ({
      name: KV_TOOL_NAMES.query,
      description:
        '检索本地数据层（语义由该域的驱动实现，如全文 / 标签 / 向量）。'
        + '只有声明了检索能力的域可用；命中结果不含值，敏感域连片段都不回显。'
        + '\n可用域：\n' + domains,
      parameters: {
        type: 'object',
        properties: {
          domain: domainProperty(),
          pattern: { type: 'string', description: '检索表达式，语义由域驱动解释' },
          tags: { type: 'array', items: { type: 'string' }, description: '可选：标签过滤' },
          skip: { type: 'number', description: '跳过前 N 条命中（翻页）' },
          limit: { type: 'number', description: '本次最多回多少条命中' },
        },
        required: ['domain'], additionalProperties: false,
      },
    }),
  },
  blob: {
    definition: (domains) => ({
      name: KV_TOOL_NAMES.blob,
      description:
        '大文件能力（语义由该域的驱动实现，如分块上传 / 下载 / 列目录）。'
        + '只有声明了文件能力的域可用；参数由驱动解释。'
        + '\n可用域：\n' + domains,
      parameters: {
        type: 'object',
        properties: {
          domain: domainProperty(),
          key: keyProperty('文件路径 / 句柄名'),
          action: { type: 'string', description: '动作，语义由域驱动解释' },
          args: { type: 'object', description: '附加参数（由驱动解释）', additionalProperties: true },
        },
        required: ['domain', 'action'], additionalProperties: false,
      },
    }),
  },
};

/** KvOutcome → PrimitiveResult（preparatory 同源传递） */
function toPrimitive(r: KvOutcome): PrimitiveResult {
  const out: PrimitiveResult = { observation: r.observation, ok: r.ok, detail: r.detail };
  if (r.preparatory) out.preparatory = true;
  return out;
}

/**
 * 按 service 的能力并集生成全部 kv_* 原语。
 * 装配方只需把它展开进 createSkillRegistry 的 primitive 列表（与 web 原语同一份注册表）。
 */
export function createKvPrimitives(service: KvServiceLike): SkillPrimitive[] {
  const domainsText = renderDomains(service.domains());
  const out: SkillPrimitive[] = [];
  for (const capability of service.capabilities()) {
    const factor = KV_FACTORS[capability];
    if (!factor) continue; // 声明了能力但缺工具素材：跳过而不是崩溃，便于渐进扩展
    const definition: ModelToolDefinition = factor.definition(domainsText);
    out.push({
      name: definition.name,
      definition,
      execute: async (args: Record<string, unknown>): Promise<PrimitiveResult> => {
        return toPrimitive(await service.execute(capability, args));
      },
    });
  }
  return out;
}

/** 追加到 system 的说明片段：只讲工作机制与边界，不复述各工具参数 */
export function buildKvSystemSuffix(service: KvServiceLike): string {
  const names = [...service.capabilities()].map((c) => KV_TOOL_NAMES[c]).join('、');
  return [
    '【本地数据层】',
    '本机有一套由宿主托管、按域隔离的本地存储，可用工具：' + names + '。',
    'domain 只填逻辑域名（见各工具说明），宿主决定它落在哪个物理键；'
    + '你无法、也不要试图读取或改写其它 localStorage / IndexedDB 键。',
    // 2026-11-19 收窄：旧措辞把「读 prefs」写成命中技能时的默认动作，模型于是把读偏好
    // 当成每个技能的第一步（用户实测：用户明明已明确指定查询对象，仍先读空的偏好列表，
    // 再拿配方里的示例值凑数）。现按业务规则收窄：只有配方明确要求、或用户主动提到
    // 自选 / 偏好 / 记住时才读；用户已明确指定查询对象就直接按该输入查询，不先读偏好。
    '仅在配方明确要求、或用户主动提到「自选 / 我的 / 偏好 / 记住 / 以后默认 / 历史设置」时，'
    + '才用 kv_read 读取对应偏好，避免让用户每次重新列一遍；'
    + '用户已明确指定查询对象时，直接按该输入查询，不要先读偏好。'
    + '用户明确说「记住 / 加入自选 / 以后默认」时用 kv_write 保存并回执。',
    '敏感域（API key / token / 任何凭据）由用户在设置面板录入，模型既读不到值也不能写入；'
    + '需要带鉴权访问时由宿主直连消费，不要向用户索要明文、也不要把凭据写进任何消息。',
    '长会话 / 长期任务的状态与 compact 摘要由**宿主内部**生成并放进 checkpoints 域，'
    + '该域模型只读：可用 kv_read / kv_slice 分页查看，不要写入或删除、也不要自己编造一份摘要；'
    + '大值未读完就继续翻页，绝不凭预览编造。',
    '写入失败（受限 / 超上限 / 后端不可用）如实说明，不要谎报已保存。',
  ].join('\n');
}
