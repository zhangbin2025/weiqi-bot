/**
 * 宿主通用原语：4 个 web 工具（含 web_cache_read）+ navigate_to 指路原语。
 * @module application/skill/primitives/BasicPrimitives
 *
 * 全部复用现有 web 工具的 definition 与执行器，不新造能力、不引入依赖。
 * navigate_to 只生成站内链接文本（宿主不自动跳转），路径做最小合法性校验。
 *
 * 契约前移（2026-11-16 用户实测）：「宿主注入链接、模型绝不写 URL」这条约束
 * 原先只写在 navigateToObservation（工具执行后才回喂），模型在决定 tool_calls
 * 那一刻看不到；引用 navigate_to 的用户自建技能于是会自己拼一个外站网址
 * （实测 https://example.com/play/index.html）。现在把同一条契约写进工具定义
 * 的 description —— 模型注册工具时即读到，内置 / 在线 / 自建技能口径一致。
 * 这不是新规则，只是把既有契约放到正确的时机。
 */

import {
  WEB_FETCH_TOOL, WEB_FETCH_TOOL_NAME, executeWebFetch, type WebFetchToolDeps,
} from '@application/chat/WebFetchTool';
import {
  WEB_READ_PDF_TOOL, WEB_READ_PDF_TOOL_NAME, WEB_READ_IMAGE_TOOL, WEB_READ_IMAGE_TOOL_NAME,
  executeWebReadPdf, executeWebReadImage,
} from '@application/chat/WebResourceTools';
import {
  WEB_CACHE_READ_TOOL, WEB_CACHE_READ_TOOL_NAME, executeWebCacheRead,
} from '@application/chat/WebFetchCache';
import type { ModelToolDefinition } from '@application/model/IModelGateway';
import type { SkillPrimitive, PrimitiveResult } from '@application/skill/SkillTypes';
import {
  buildNavigateToPath, isValidNavigateToPath, sanitizeNavigateToQuery,
  navigateToObservation,
} from './NavigateToPath';

/** navigate_to 工具名（与 definition.name 一致） */
export const NAVIGATE_TO_TOOL_NAME = 'navigate_to';

/** §7.7：站内绝对路径指路，不自动跳转 */
export const NAVIGATE_TO_TOOL: ModelToolDefinition = {
  name: NAVIGATE_TO_TOOL_NAME,
  description:
    '指路到站内页面（不自动跳转）：只传站内绝对路径与可选的语义化 query 参数，' +
    '真实链接由宿主直接渲染成按钮显示在这条回复下方，URL 编码也由宿主完成。' +
    '模型永远不接触、也绝不能在回复里写任何链接 / 网址 / markdown 链接 / 括号里的地址；' +
    '只写一句简短引导语然后停笔，不要编造域名（如 https://example.com/...）。' +
    '需要给目标页传条件时用 query 传语义化键值对（键值都必须是字符串）。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '站内绝对路径，如 /puzzle/index.html' },
      label: { type: 'string', description: '链接显示文字' },
      query: {
        type: 'object',
        description:
          '可选：站内链接的查询参数，键与值都必须是字符串；宿主负责 URL 编码。' +
          '例：{"type":"手筋","difficulty":"8K"}',
        additionalProperties: { type: 'string' },
      },
    },
    required: ['path', 'label'],
    additionalProperties: false,
  },
};

/** tool 执行结果 → 原语结果：三个必填字段 + 可选宿主注入链接 + 只读准备标记 */
function toPrimitiveResult(r: {
  observation: string; ok: boolean; detail: string;
  actionLink?: { url: string; label: string };
  preparatory?: boolean;
}): PrimitiveResult {
  const out: PrimitiveResult = { observation: r.observation, ok: r.ok, detail: r.detail };
  if (r.actionLink) out.actionLink = r.actionLink;
  if (r.preparatory) out.preparatory = true;
  return out;
}

/**
 * 构造 5 个通用原语：web_fetch / web_cache_read / web_read_pdf / web_read_image / navigate_to。
 * webDeps 由上层（接线方）注入，与 createWebToolKit 用的是同一份依赖。
 */
export function createBasicPrimitives(webDeps: WebFetchToolDeps): SkillPrimitive[] {
  return [
    {
      name: WEB_FETCH_TOOL_NAME,
      definition: WEB_FETCH_TOOL,
      execute: async (argsJson) => toPrimitiveResult(await executeWebFetch(argsJson, webDeps)),
    },
    {
      name: WEB_CACHE_READ_TOOL_NAME,
      definition: WEB_CACHE_READ_TOOL,
      execute: async (argsJson) => toPrimitiveResult(
        executeWebCacheRead(argsJson, webDeps.cache),
      ),
    },
    {
      name: WEB_READ_PDF_TOOL_NAME,
      definition: WEB_READ_PDF_TOOL,
      execute: async (argsJson) => toPrimitiveResult(await executeWebReadPdf(argsJson, webDeps)),
    },
    {
      name: WEB_READ_IMAGE_TOOL_NAME,
      definition: WEB_READ_IMAGE_TOOL,
      execute: async (argsJson) => toPrimitiveResult(await executeWebReadImage(argsJson, webDeps)),
    },
    {
      name: NAVIGATE_TO_TOOL_NAME,
      definition: NAVIGATE_TO_TOOL,
      execute: async (argsJson): Promise<PrimitiveResult> => {
        let path = '';
        let label = '';
        let query: Record<string, string> = {};
        try {
          const args = JSON.parse(argsJson) as {
            path?: unknown; label?: unknown; query?: unknown;
          };
          if (typeof args.path === 'string') path = args.path.trim();
          if (typeof args.label === 'string') label = args.label.trim();
          query = sanitizeNavigateToQuery(args.query);
        } catch {
          // 交给下面的合法性判定统一报「路径不合法」
        }
        if (!isValidNavigateToPath(path)) {
          const observation = 'navigate_to：路径不合法，请给出以 / 开头的站内绝对路径（不含 :// 或 ..）。';
          return { observation, ok: false, detail: '路径不合法' };
        }
        // 真实带参路径由宿主直接渲染成 <a> 并随消息落历史（actionLink）。
        // 模型既看不到 URL，也不该在回复里写链接 —— 规避多轮会话里照抄历史旧链接。
        const finalPath = buildNavigateToPath(path, query);
        const safeLabel = label || path;
        return {
          observation: navigateToObservation(safeLabel, finalPath),
          ok: true,
          detail: `指路 ${finalPath}`,
          actionLink: { url: finalPath, label: safeLabel },
        };
      },
    },
  ];
}
