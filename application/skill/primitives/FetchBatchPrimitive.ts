/**
 * 通用批量网页抓取算子。
 *
 * 只执行调用方提供的公开 URL 列表，不认识网站、登录态、业务字段或分页协议。
 * URL 的生成、业务参数映射和分页策略由调用该算子的技能/Workflow 描述负责。
 */
import type { ModelToolDefinition } from '@application/model/IModelGateway';
import type { SkillPrimitive, PrimitiveResult } from '@application/skill/SkillTypes';
import { executeWebFetch, type WebFetchToolDeps } from '@application/chat/WebFetchTool';

export const FETCH_BATCH_TOOL_NAME = 'fetch_batch';
const MAX_BATCH_SIZE = 50;
const MAX_CONCURRENCY = 4;

export const FETCH_BATCH_TOOL: ModelToolDefinition = {
  name: FETCH_BATCH_TOOL_NAME,
  description:
    '批量抓取公开网页文本资源。只负责按给定 URL 列表发起 GET 请求并返回结构化结果，' +
    '不理解任何网站或业务规则。请由技能根据自己的业务参数生成完整 URL 列表（包括分页、ID、查询参数），' +
    '再一次性传入 requests。每项可包含 url 和可选 query（字符串键值，会追加到 URL 查询参数）。' +
    '结果按输入顺序返回，每项包含 url、ok、detail、value；JSON 响应的 value 为解析后的 JSON，' +
    '非 JSON 响应为原始文本。只允许公开 http/https 地址，拒绝环回和私网地址。',
  parameters: {
    type: 'object',
    properties: {
      requests: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_BATCH_SIZE,
        items: {
          type: 'object',
          properties: {
            url: { type: 'string', minLength: 1 },
            query: {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
          },
          required: ['url'],
          additionalProperties: false,
        },
      },
    },
    required: ['requests'],
    additionalProperties: false,
  },
};

interface FetchBatchRequest {
  url: string;
  query?: Record<string, string>;
}

function withQuery(request: FetchBatchRequest): string {
  const url = new URL(request.url);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function createFetchBatchPrimitive(deps: WebFetchToolDeps): SkillPrimitive {
  return {
    name: FETCH_BATCH_TOOL_NAME,
    definition: FETCH_BATCH_TOOL,
    idempotent: true,
    kind: 'io',
    outputSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          ok: { type: 'boolean' },
          detail: { type: 'string' },
          value: {},
        },
        required: ['url', 'ok', 'detail', 'value'],
        additionalProperties: false,
      },
    },
    execute: async (args): Promise<PrimitiveResult> => {
      const requests = args.requests as FetchBatchRequest[];
      const results: Array<{ url: string; ok: boolean; detail: string; value: unknown }> =
        new Array(requests.length);
      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (true) {
          const index = cursor++;
          if (index >= requests.length) return;
          const request = requests[index]!;
          let url = request.url;
          try {
            url = withQuery(request);
            const result = await executeWebFetch({ url, storeOnly: true }, deps);
            results[index] = {
              url,
              ok: result.ok,
              detail: result.detail,
              value: result.value ?? null,
            };
          } catch (error) {
            results[index] = {
              url,
              ok: false,
              detail: error instanceof Error ? error.message : String(error),
              value: null,
            };
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(MAX_CONCURRENCY, requests.length) }, () => worker()),
      );
      const succeeded = results.filter((result) => result.ok).length;
      return {
        observation: `fetch_batch：完成 ${results.length} 项抓取，成功 ${succeeded} 项，失败 ${results.length - succeeded} 项。`,
        ok: succeeded === results.length,
        detail: `批量抓取 ${results.length} 项（并发上限 ${MAX_CONCURRENCY}）`,
        value: results,
      };
    },
  };
}
