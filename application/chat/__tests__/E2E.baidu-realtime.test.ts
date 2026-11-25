/**
 * 端到端调试回归：「正则匹配插件」+「百度热搜」技能（22:11 用户授权端到端调试）
 *
 * 全链路走生产代码，不用 mock 糊：
 *   真 QuickJS 沙箱（QuickJsExecutor + 真 wasm）
 *   → 真 plugin_write（跑 smoke[] 自检、落 InMemoryPluginArtifactStore）
 *   → 真 plugin_toggle（人工启用闸门）
 *   → 真 createOperatorRegistry（内置原语 + 插件算子适配）
 *   → 真 skill_write（纯声明 workflow DAG 落 UserSkillStore）
 *   → 真 buildWorkflowToolParts + run_workflow debug:true
 *   → 真 web_fetch(storeOnly) / regex.extractAll / display_json_list
 *
 * 网络层只把 fetchImpl 换成本地字节（内联代表性 HTML + 真实百度页面快照），
 * 其余全是生产实现。目的有两个：
 *   1. 复现「此前搞很久没搞出来」的真卡点：插件默认停用 → 算子未注册；
 *   2. 证明 toggle 启用后整条 DAG 能真跑出列表。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createOperatorRegistry } from '../../plugin/OperatorRegistry';
import { createPluginToolKit } from '../../plugin/PluginTools';
import { createExtensionPointBehaviors } from '../../plugin/behaviors';
import { PluginArtifactService } from '../../plugin/PluginArtifactService';
import { PluginContextProvider } from '../../plugin/PluginContextProvider';
import { InMemoryPluginArtifactStore } from '../../../infrastructure/plugin/InMemoryPluginArtifactStore';
import { QuickJsExecutor } from '../../../infrastructure/plugin-vm/QuickJsExecutor';
import { PluginValidator } from '../../../domain/plugin/PluginValidator';
import type { IPluginRuntime } from '@domain/plugin/types';
import { createSkillRegistry } from '../../skill/SkillRegistry';
import { createBasicPrimitives } from '../../skill/primitives/BasicPrimitives';
import { createSkillDevKit } from '../../skill/dev/SkillDevTools';
import { UserSkillStore } from '../../skill/dev/UserSkillStore';
import { buildWorkflowToolParts, RUN_WORKFLOW_TOOL_NAME } from '../../skill/WorkflowTool';
import { runWorkflow } from '../../skill/WorkflowRunner';

// ---------------------------------------------------------------- 真沙箱

const wasmPath = resolve(
  process.cwd(),
  'node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm',
);
function loadWasm(): ArrayBuffer {
  const buf = readFileSync(wasmPath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
/** 直接把 QuickJsExecutor 包成 IPluginRuntime：引擎与线上完全一致，只是不经 Worker 外壳 */
function makeRuntime(): IPluginRuntime {
  const ex = new QuickJsExecutor({ wasmBinary: loadWasm() });
  return {
    run: async (code, input, spec) => ex.execute({ code, input, spec }),
    dispose: async () => undefined,
  };
}

// ---------------------------------------------------------------- 可交付产物 ①：正则匹配插件

/**
 * 源码里不能出现 PluginValidator 的浏览器全局禁词（fetch/window/document/self/…），
 * 注释一律中文。零能力沙箱：只用 RegExp / String / Array / Object 基础能力。
 * 参数全部由调用方明说，无经验阈值：
 *   text / pattern        —— 源文本与正则源字符串（必填）
 *   flags                  —— 缺省 'g'；若不含 g 自动补，避免 exec 原地死循环
 *   group                  —— 缺省 0（正则引擎的原始命中文本，无业务假设）
 *   key                    —— 缺省 'value'（输出对象的字段名）
 *   dedupe                 —— 缺省 false；true = 按出现顺序去重（业务明说的规则）
 */
const REGEX_CODE = `
/**
 * 通用正则提取算子：对文本做全局匹配，取指定捕获组或整体命中，
 * 输出 [{ [key]: 命中文本 }] 数组，可直接交给列表展示算子。
 */
function extractAll(spec) {
  if (!spec || typeof spec.text !== 'string' || typeof spec.pattern !== 'string') {
    throw new Error('缺少 text 或 pattern');
  }
  var flags = typeof spec.flags === 'string' ? spec.flags : 'g';
  if (flags.indexOf('g') === -1) flags = flags + 'g';
  var group = typeof spec.group === 'number' ? spec.group : 0;
  var key = typeof spec.key === 'string' && spec.key ? spec.key : 'value';
  var dedupe = spec.dedupe === true;
  var re = new RegExp(spec.pattern, flags);
  var out = [];
  var seen = [];
  var m;
  while ((m = re.exec(spec.text)) !== null) {
    if (m[0] === '') { re.lastIndex = re.lastIndex + 1; continue; }
    var v = m[group];
    if (v === undefined) v = '';
    if (dedupe && seen.indexOf(v) !== -1) continue;
    seen.push(v);
    var row = {};
    row[key] = v;
    out.push(row);
  }
  return out;
}

function call(input) {
  if (!input || typeof input.method !== 'string') throw new Error('缺少 method');
  if (!Array.isArray(input.args) || input.args.length !== 1) throw new Error('args 必须是含一个参数对象的数组');
  if (input.method === 'extractAll') return extractAll(input.args[0]);
  throw new Error('不支持的方法：' + input.method);
}
`;

/** exposes[]：一个方法；params 原样进宿主算子表条目 */
const EXPOSES = [{
  name: 'extractAll',
  description: '对文本做正则全局匹配，按捕获组或整体命中提取，输出对象数组',
  params: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '源文本' },
      pattern: { type: 'string', description: '正则源字符串（JSON 字符串里反斜杠按 JSON 规则转义）' },
      flags: { type: 'string', description: '正则标志；缺省 g，不含 g 时自动补' },
      group: { type: 'integer', description: '取第几个捕获组；缺省 0 = 整体匹配' },
      key: { type: 'string', description: '输出对象的字段名；缺省 value' },
      dedupe: { type: 'boolean', description: '是否按出现顺序去重；缺省 false' },
    },
    required: ['text', 'pattern'],
  },
}];

/** smoke[]：确定性输入，不依赖时间/随机数，宿主逐条跑沙箱与 expect 逐字段比对 */
const SMOKE = [
  {
    method: 'extractAll',
    args: [{ text: 'a {"word":"甲"} b {"word":"乙"}', pattern: '"word"\\s*:\\s*"([^"]+)"', group: 1, key: 'word' }],
    expect: [{ word: '甲' }, { word: '乙' }],
  },
  {
    method: 'extractAll',
    args: [{ text: '"word":"甲","word":"甲","word":"乙"', pattern: '"word"\\s*:\\s*"([^"]+)"', group: 1, key: 'word', dedupe: true }],
    expect: [{ word: '甲' }, { word: '乙' }],
  },
  {
    method: 'extractAll',
    args: [{ text: 'ab12 cd34', pattern: '[a-z]+\\d+', group: 0, key: 'raw' }],
    expect: [{ raw: 'ab12' }, { raw: 'cd34' }],
  },
];

const SLUG = 'regex';
const OP_NAME = `${SLUG}.extractAll`;

// ---------------------------------------------------------------- 可交付产物 ②：「百度热搜」技能配方

/** 真实页面结构：HTML 里嵌 "word":"…"（见 /tmp/baidu_proxy.html 实测 52 命中 / 51 去重） */
const BAIDU_URL = 'https://top.baidu.com/board?tab=realtime';
const BAIDU_PATTERN = '"word"\\s*:\\s*"([^"]+)"';

const BAIDU_RECIPE = {
  name: '百度热搜',
  summary: '抓取百度实时热搜榜页面，用正则插件提取热搜关键字，并由宿主以列表直接展示',
  routeHint: ['百度热搜', '热搜榜', '实时热搜'],
  primitives: [],
  prompt: '已把百度实时热搜关键字以列表展示给用户；如实告知任务已完成、结果见宿主呈现，不要复述或补写数据内容。',
  workflow: {
    steps: [
      {
        id: 'fetch', call: 'web_fetch', yield: true,
        args: { url: BAIDU_URL, storeOnly: true },
      },
      {
        id: 'extract', call: OP_NAME, yield: true,
        args: { pattern: BAIDU_PATTERN, group: 1, key: 'word', dedupe: true },
        bindings: [{ from: 'fetch', path: '$', as: 'text' }],
      },
      {
        id: 'render', call: 'display_json_list',
        args: { format: 'list', fields: [{ key: 'word' }], note: '数据来源：百度热搜榜（实时）' },
        bindings: [{ from: 'extract', path: '$', as: 'value' }],
      },
    ],
  },
};

/** 内联代表性页面片段：真实结构 + 首尾重复 + 中文引号 + 别处有 HTML 实体 */
const INLINE_HTML = '<div data-x="{&quot;a&quot;:1}">'
  + '{"appUrl":"https://www.baidu.com/s?wd=x","word":"培养更多高技能人才和大国工匠","isTop":true},'
  + '{"word":"上海市委书记陈吉宁被查"},'
  + '{"word":"太平洋暖得“失控”了"},'
  + '{"word":"新娘提1341次分手新郎回1342次不行"},'
  + '{"word":"培养更多高技能人才和大国工匠"}'
  + '</div>';

// ---------------------------------------------------------------- 装配 helper

function memAdapter() {
  const data = new Map<string, unknown>();
  return {
    initialize: async () => {},
    read: async <T>(key: string) => (data.has(key) ? (data.get(key) as T) : null),
    write: async <T>(key: string, value: T) => { data.set(key, value); },
    delete: async (key: string) => { data.delete(key); },
  };
}

/** 生产 web_fetch 只把网络层换成给定字节；其余（缓存/storeOnly/value 透传）全真 */
function webDepsFor(body: string) {
  return {
    proxyUrl: 'https://api.weiqi.lol',
    timeoutMs: 60_000,
    fetchImpl: (async () => ({
      status: 200, statusText: 'OK', ok: true,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
      text: async () => body,
    })) as unknown as typeof fetch,
  };
}

interface Assembled {
  pluginKit: ReturnType<typeof createPluginToolKit>;
  artifacts: PluginArtifactService;
  runtime: IPluginRuntime;
  pluginId: string;
  users: UserSkillStore;
  devKit: ReturnType<typeof createSkillDevKit>;
  primitives: ReturnType<typeof createSkillRegistry>;
  savedId: string;
  recipes: readonly { id: string; workflow?: unknown; inputs?: unknown }[];
}

/** 一次完整装配：plugin_write → skill_write，返回各处句柄 */
async function assemble(body: string): Promise<Assembled> {
  const persist = new Map<string, string>();
  const store = new InMemoryPluginArtifactStore(persist);
  const artifacts = new PluginArtifactService(store);
  const snapshot = new PluginContextProvider(store);
  const validator = new PluginValidator();
  const runtime = makeRuntime();
  const pluginKit = createPluginToolKit({
    artifacts, runtime, validator, snapshot,
    applySelection: async () => {},
    behaviors: createExtensionPointBehaviors(),
  });

  // 真 plugin_write：内部真跑 3 条 smoke 自检（QuickJS）、真落库、默认 enabled:false
  const written = await pluginKit.executors['plugin_write']!(JSON.stringify({
    name: '正则提取算子',
    intent: '通用正则匹配/提取工作流算子，供百度热搜等技能按 pattern 抽取文本并列表展示',
    pointId: 'workflow-operator',
    slug: SLUG,
    code: REGEX_CODE,
    exposes: EXPOSES,
    smoke: SMOKE,
  }));
  expect(written.ok).toBe(true);

  const all = await artifacts.list();
  expect(all).toHaveLength(1);
  const pluginId = all[0]!.id;
  expect(all[0]!.enabled).toBe(false); // 人工闸门：新建恒停用
  expect(all[0]!.slug).toBe(SLUG);

  // 真 skill_write：纯声明 workflow DAG 落 UserSkillStore
  const users = new UserSkillStore({ localStorage: memAdapter() as never });
  const primitives = createSkillRegistry(createBasicPrimitives(webDepsFor(body)));
  const devKit = createSkillDevKit({ users, primitives });
  const saved = await devKit.executors['skill_write']!(JSON.stringify(BAIDU_RECIPE));
  expect(saved.ok).toBe(true);
  const entries = await users.list();
  expect(entries).toHaveLength(1);
  const recipe = entries[0]!.recipe;
  expect(recipe.workflow).toBeDefined();
  const savedId = recipe.id;

  return {
    pluginKit, artifacts, runtime, pluginId, users, primitives, savedId, devKit,
    recipes: [recipe] as unknown as Assembled['recipes'],
  };
}

function registryFor(a: Assembled, body: string) {
  return createOperatorRegistry({
    primitives: createBasicPrimitives(webDepsFor(body)),
    artifacts: a.artifacts,
    runtime: a.runtime,
  });
}

async function debugRun(a: Assembled, body: string) {
  const registry = await registryFor(a, body);
  // 接宿主内部 hooks：动态读候选 + debug 全绿后翻转启用（与 ChatUseCase 同口径）
  const parts = buildWorkflowToolParts(
    a.recipes as never, registry, undefined, true, a.devKit.workflowHooks,
  );
  return parts.executors[RUN_WORKFLOW_TOOL_NAME]!(
    JSON.stringify({ skillId: a.savedId, inputs: {}, debug: true }),
  );
}

describe('端到端：正则插件 + 百度热搜 workflow 技能', () => {
  it('① 真沙箱自检通过并落库，但默认停用 → 算子不在宿主表（真卡点）', async () => {
    const a = await assemble(INLINE_HTML);
    const reg = await registryFor(a, INLINE_HTML);
    expect(reg.specs.has(OP_NAME)).toBe(false);
    // 配方保存得下来，但 call 只是字符串、保存期不查算子表
    const rr = await runWorkflow(
      a.recipes[0]!.workflow as never, {}, reg, undefined,
      a.recipes[0]!.inputs as never, true,
    );
    expect(rr.ok).toBe(false);
    expect(JSON.stringify(rr)).toContain(OP_NAME); // 未注册算子：regex.extractAll
  });

  it('② plugin_toggle 启用后：debug:true 真跑三步，每步输出 + 最终列表都回灌', async () => {
    const a = await assemble(INLINE_HTML);
    const toggled = await a.pluginKit.executors['plugin_toggle']!(
      JSON.stringify({ artifactId: a.pluginId, enabled: true }),
    );
    expect(toggled.ok).toBe(true);
    expect((await a.artifacts.list())[0]!.enabled).toBe(true);

    const reg = await registryFor(a, INLINE_HTML);
    expect(reg.specs.has(OP_NAME)).toBe(true);

    const outcome = await debugRun(a, INLINE_HTML);
    expect(outcome.ok).toBe(true);
    expect(outcome.observation).toContain('调试模式');
    expect(outcome.observation).toContain('第 1/3 步 fetch');
    expect(outcome.observation).toContain('第 2/3 步 extract');
    expect(outcome.observation).toContain(OP_NAME);
    expect(outcome.observation).toContain('第 3/3 步 render');
    expect(outcome.observation).toContain('最终交付');
    // 去重后 4 条：首条与末条重复，按出现顺序保留一次
    expect(outcome.observation).toContain('培养更多高技能人才和大国工匠');
    expect(outcome.observation).toContain('上海市委书记陈吉宁被查');
    expect(outcome.observation).toContain('太平洋暖得“失控”了');
    expect(outcome.displayMarkdown ?? '').toContain('培养更多高技能人才和大国工匠');
    const bullets = (outcome.displayMarkdown ?? '').split('\n').filter((l) => l.startsWith('- '));
    expect(bullets).toHaveLength(4);
  });

  it('③ 对真实百度页面快照（本次实测抓取）验证：52 命中 / 51 去重 + 列表', async () => {
    const realPath = '/tmp/baidu_proxy.html';
    if (!existsSync(realPath)) return; // 只在本次有快照的编译机上跑，不阻塞移植
    const body = readFileSync(realPath, 'utf8');
    const a = await assemble(body);
    await a.pluginKit.executors['plugin_toggle']!(
      JSON.stringify({ artifactId: a.pluginId, enabled: true }),
    );
    const outcome = await debugRun(a, body);
    expect(outcome.ok).toBe(true);
    const bullets = (outcome.displayMarkdown ?? '').split('\n').filter((l) => l.startsWith('- '));
    console.log('[baidu-realtime] 真实页面去重后条数 =', bullets.length,
      '| 首条 =', bullets[0], '| 末条 =', bullets[bullets.length - 1]);
    expect(bullets.length).toBe(51); // 实测 52 命中、1 条首尾重复
    expect(bullets[0]).toContain('培养更多高技能人才和大国工匠');
  });
});
