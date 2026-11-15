/**
 * 宿主通用原语：3 个既有 web 工具 + navigate_to 指路原语。
 * @module application/skill/primitives/BasicPrimitives
 *
 * 全部复用现有 web 工具的 definition 与执行器，不新造能力、不引入依赖。
 * navigate_to 只生成站内链接文本（宿主不自动跳转），路径做最小合法性校验。
 */

import {
  WEB_FETCH_TOOL, WEB_FETCH_TOOL_NAME, executeWebFetch, type WebFetchToolDeps,
} from '@application/chat/WebFetchTool';
import {
  WEB_READ_PDF_TOOL, WEB_READ_PDF_TOOL_NAME, WEB_READ_IMAGE_TOOL, WEB_READ_IMAGE_TOOL_NAME,
  executeWebReadPdf, executeWebReadImage,
} from '@application/chat/WebResourceTools';
import type { ModelToolDefinition } from '@application/model/IModelGateway';
import type { SkillPrimitive, PrimitiveResult } from '@application/skill/SkillTypes';

/** navigate_to 工具名（与 definition.name 一致） */
export const NAVIGATE_TO_TOOL_NAME = 'navigate_to';

/** §7.7：站内绝对路径指路，不自动跳转 */
export const NAVIGATE_TO_TOOL: ModelToolDefinition = {
  name: NAVIGATE_TO_TOOL_NAME,
  description: '生成一个站内页面链接文本，供回复里指路（不自动跳转）。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '站内绝对路径，如 /puzzle/index.html' },
      label: { type: 'string', description: '链接显示文字' },
    },
    required: ['path', 'label'],
    additionalProperties: false,
  },
};

/** 只放行以 '/' 开头、不含 '://'、不含 '..' 的站内绝对路径 */
function isValidPath(path: string): boolean {
  return path.startsWith('/') && !path.includes('://') && !path.includes('..');
}

/** tool 执行结果 → 原语结果：只取三个必填字段，其余可选字段一律不带 */
function toPrimitiveResult(r: { observation: string; ok: boolean; detail: string }): PrimitiveResult {
  return { observation: r.observation, ok: r.ok, detail: r.detail };
}

/**
 * 构造 4 个通用原语：web_fetch / web_read_pdf / web_read_image / navigate_to。
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
        try {
          const args = JSON.parse(argsJson) as { path?: unknown; label?: unknown };
          if (typeof args.path === 'string') path = args.path.trim();
          if (typeof args.label === 'string') label = args.label.trim();
        } catch {
          // 交给下面的合法性判定统一报「路径不合法」
        }
        if (!isValidPath(path)) {
          const observation = 'navigate_to：路径不合法，请给出以 / 开头的站内绝对路径（不含 :// 或 ..）。';
          return { observation, ok: false, detail: '路径不合法' };
        }
        const safeLabel = label || path;
        return {
          observation: `「${safeLabel}」请打开：${path}`,
          ok: true,
          detail: `指路 ${path}`,
        };
      },
    },
  ];
}
