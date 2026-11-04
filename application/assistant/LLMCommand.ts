/**
 * /llm 命令处理
 * @module application/assistant/LLMCommand
 *
 * ⚠️ 安全要点
 * 1. 必须在通用 sendMessage 流程「之前」拦截：那里一进来就把原文渲染 + 存历史，
 *    会导致 apiKey 明文落盘（IndexedDB）并可被 exportHistory 导出。
 * 2. 不能使用 CommandHandler.handleCommand 里的 `toLowerCase()`：会把 URL 路径和
 *    apiKey 全部转小写。本模块直接拿原始字符串，只对主命令做小写比较。
 *
 * 用法:
 *   /llm <baseUrl> <apiKey> <model>   配置并启用（模型必填，各家 ID 不同）
 *   /llm model <name>                 仅改模型名
 *   /llm timeout <秒>                 调整请求超时（5~300 秒）
 *   /llm maxtokens <数>               调整 token 预算（512~16384，默认 4096）
 *   /llm thinking on|off              开启/关闭推理模型的思考过程（默认关闭）
 *   /llm status                      查看当前配置（脱敏）
 *   /llm off                         关闭并清除凭据
 *   /llm                             显示用法
 */

import {
  saveLLMCredentials,
  loadLLMConfig,
  loadApiKey,
  clearLLMCredentials,
  maskApiKey,
  normalizeBaseUrl,
  buildChatCompletionsUrl,
  DEFAULT_LLM_MODEL,
  DEFAULT_LLM_TIMEOUT_MS,
  MIN_LLM_TIMEOUT_MS,
  MAX_LLM_TIMEOUT_MS,
  normalizeTimeoutMs,
  DEFAULT_LLM_MAX_TOKENS,
  MIN_LLM_MAX_TOKENS,
  MAX_LLM_MAX_TOKENS,
  normalizeMaxTokens,
  DEFAULT_LLM_DISABLE_THINKING,
  normalizeDisableThinking,
} from '../../infrastructure/llm/LLMCredentialStore';

export interface LLMCommandDeps {
  /** 渲染并保存到历史（复用 CommandHandler 的既有行为） */
  renderMessage: (content: string) => Promise<void>;
}

/** 是否是 /llm 命令（主命令匹配，大小写不敏感） */
export function isLLMCommand(raw: string): boolean {
  return raw.trim().split(/\s+/)[0]?.toLowerCase() === '/llm';
}

function usage(): string {
  return [
    '🤖 **LLM 接入**',
    '',
    '```',
    '/llm <baseUrl> <apiKey> <model>  配置启用（模型必填）',
    '/llm model <name>                改模型名',
    '/llm timeout <秒>                请求超时（默认 60s）',
    '/llm maxtokens <数>               token 预算（默认 4096）',
    '/llm thinking on|off              思考开关（默认 off）',
    '/llm status                      查看配置',
    '/llm off                         关闭并清除凭据',
    '```',
    '',
    'OpenAI 兼容端点（如 `https://api.x.com/v1`）。模型名按各家 ID 显式填，',
    'lkeap 用 `tc-code-latest`、OpenAI 用 `gpt-4o-mini`。启用后自然语言交 LLM，',
    '`/` 命令仍本地处理。更多用 `/llm status`。',
  ].join('\n');
}

/** 已知子命令（这些命令的第二段是子命令名，不是 apiKey，不能脱敏） */
export const LLM_SUBCOMMANDS = new Set(['model', 'status', 'off', 'timeout', 'maxtokens', 'thinking']);

/** 把用户输入的命令渲染成脱敏版本（主命令 + 参数名，不含 apiKey 明文） */
export function redactCommand(raw: string): string {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const isConfig =
    parts.length >= 3 &&
    parts[0]?.toLowerCase() === '/llm' &&
    !LLM_SUBCOMMANDS.has((parts[1] ?? '').toLowerCase());
  if (isConfig) {
    // 配置命令：/llm <baseUrl> <apiKey> <model>
    const model = parts[3];
    return `/llm ${parts[1]} ${maskApiKey(parts[2]!)}${model ? ` ${model}` : ''}`;
  }
  return raw.trim();
}

/** 处理 /llm。返回 true 表示已消费该命令。 */
export async function handleLLMCommand(raw: string, deps: LLMCommandDeps): Promise<boolean> {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const main = parts[0]?.toLowerCase();
  if (main !== '/llm') return false;

  const sub = parts[1]?.toLowerCase();

  // /llm off
  if (sub === 'off') {
    clearLLMCredentials();
    await deps.renderMessage('✅ 已关闭 LLM 并清除本地凭据。后续自然语言恢复为本地意图识别。');
    return true;
  }

  // /llm status
  if (sub === 'status') {
    const config = loadLLMConfig();
    if (!config) {
      await deps.renderMessage('ℹ️ 尚未配置 LLM。使用 `/llm <baseUrl> <apiKey> <model>` 接入。');
      return true;
    }
    const usable = loadApiKey() !== null;
    const text = [
      '🤖 **LLM 配置**',
      '',
      `- 状态：${usable ? '✅ 已启用' : '⚠️ 凭据无法解密，请重新配置'}`,
      `- baseUrl：\`${config.baseUrl}\``,
      `- 端点：\`${buildChatCompletionsUrl(config.baseUrl)}\``,
      `- 模型：\`${config.model || '（未设置，请执行 /llm model <模型名>）'}\``,
      `- 超时：${(config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS) / 1000} 秒`,
      `- token 预算：${config.maxTokens ?? DEFAULT_LLM_MAX_TOKENS}（/llm maxtokens <数> 可调）`,
      `- 思考过程：${normalizeDisableThinking(config.disableThinking) ? '已关闭 ✅' : '已开启'}（/llm thinking on|off）`,
      `- apiKey：\`${config.keyHint || '****'}\`（已加密缓存）`,
      `- 更新时间：${new Date(config.updatedAt).toLocaleString()}`,
    ].join('\n');
    await deps.renderMessage(text);
    return true;
  }

  // /llm timeout <秒>
  if (sub === 'timeout') {
    const secondsRaw = parts[2];
    if (!secondsRaw) {
      await deps.renderMessage(
        `ℹ️ 当前超时 ${(loadLLMConfig()?.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS) / 1000} 秒。` +
        `\n用法：\`/llm timeout <秒>\`（${MIN_LLM_TIMEOUT_MS / 1000}~${MAX_LLM_TIMEOUT_MS / 1000} 秒）`,
      );
      return true;
    }
    const seconds = Number(secondsRaw);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      await deps.renderMessage('❌ 超时必须是正数秒数，例如 `/llm timeout 90`');
      return true;
    }
    const config = loadLLMConfig();
    if (!config) {
      await deps.renderMessage('❌ 尚未配置 LLM，请先执行 `/llm <baseUrl> <apiKey> <model>`');
      return true;
    }
    const apiKey = loadApiKey();
    if (!apiKey) {
      await deps.renderMessage('❌ 现有凭据无法解密，请重新执行 `/llm <baseUrl> <apiKey> <model>`');
      return true;
    }
    const ms = normalizeTimeoutMs(seconds * 1000);
    // 保留已有 maxtokens，避免被默认值覆盖
    saveLLMCredentials(config.baseUrl, apiKey, config.model, ms,
      config.maxTokens ?? DEFAULT_LLM_MAX_TOKENS,
      normalizeDisableThinking(config.disableThinking));
    await deps.renderMessage(`✅ 请求超时已改为 ${ms / 1000} 秒`);
    return true;
  }

  // /llm maxtokens <数>
  if (sub === 'maxtokens') {
    const raw = parts[2];
    if (!raw) {
      await deps.renderMessage(
        `ℹ️ 当前 token 预算 ${loadLLMConfig()?.maxTokens ?? DEFAULT_LLM_MAX_TOKENS}。` +
        `\n用法：\`/llm maxtokens <数>\`（${MIN_LLM_MAX_TOKENS}~${MAX_LLM_MAX_TOKENS}）`,
      );
      return true;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      await deps.renderMessage('❌ 必须是正数，例如 `/llm maxtokens 8192`');
      return true;
    }
    const config = loadLLMConfig();
    if (!config) {
      await deps.renderMessage('❌ 尚未配置 LLM，请先执行 `/llm <baseUrl> <apiKey> <model>`');
      return true;
    }
    const apiKey = loadApiKey();
    if (!apiKey) {
      await deps.renderMessage('❌ 现有凭据无法解密，请重新执行 `/llm <baseUrl> <apiKey> <model>`');
      return true;
    }
    const tokens = normalizeMaxTokens(n);
    saveLLMCredentials(config.baseUrl, apiKey, config.model,
      config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS, tokens,
      normalizeDisableThinking(config.disableThinking));
    await deps.renderMessage(
      `✅ token 预算已改为 ${tokens}` +
      (tokens !== n ? `（已收敛到 ${MIN_LLM_MAX_TOKENS}~${MAX_LLM_MAX_TOKENS}）` : ''),
    );
    return true;
  }

  // /llm thinking on|off
  if (sub === 'thinking') {
    const arg = parts[2]?.toLowerCase();
    if (arg !== 'on' && arg !== 'off') {
      const cur = normalizeDisableThinking(loadLLMConfig()?.disableThinking);
      await deps.renderMessage(
        `ℹ️ 当前思考过程：${cur ? '已关闭' : '已开启'}。\n` +
        '用法：`/llm thinking off` 关闭（默认，简单对话更快）、`/llm thinking on` 开启',
      );
      return true;
    }
    const config = loadLLMConfig();
    if (!config) {
      await deps.renderMessage('❌ 尚未配置 LLM，请先执行 `/llm <baseUrl> <apiKey> <model>`');
      return true;
    }
    const apiKey = loadApiKey();
    if (!apiKey) {
      await deps.renderMessage('❌ 现有凭据无法解密，请重新执行 `/llm <baseUrl> <apiKey> <model>`');
      return true;
    }
    // off = 关闭思考 = disableThinking true
    const disableThinking = arg === 'off';
    saveLLMCredentials(config.baseUrl, apiKey, config.model,
      config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
      config.maxTokens ?? DEFAULT_LLM_MAX_TOKENS, disableThinking);
    await deps.renderMessage(
      `✅ 思考过程已${disableThinking ? '关闭' : '开启'}` +
      (disableThinking ? '（简单意图解析更快、更省 token）' : '（推理模型会先生成思考过程）'),
    );
    return true;
  }

  // /llm model <name>
  if (sub === 'model') {
    const model = parts[2];
    if (!model) {
      await deps.renderMessage('❌ 用法：`/llm model <模型名>`');
      return true;
    }
    const config = loadLLMConfig();
    if (!config) {
      await deps.renderMessage('❌ 尚未配置 LLM，请先执行 `/llm <baseUrl> <apiKey> <model>`');
      return true;
    }
    const apiKey = loadApiKey();
    if (!apiKey) {
      await deps.renderMessage('❌ 现有凭据无法解密，请重新执行 `/llm <baseUrl> <apiKey> <model>`');
      return true;
    }
    // 保留已有超时与 maxtokens，不要被 saveLLMCredentials 的默认值覆盖
    saveLLMCredentials(config.baseUrl, apiKey, model,
      config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
      config.maxTokens ?? DEFAULT_LLM_MAX_TOKENS,
      normalizeDisableThinking(config.disableThinking));
    await deps.renderMessage(`✅ 模型已改为 \`${model.trim()}\``);
    return true;
  }

  // /llm （无参数）
  if (!sub) {
    await deps.renderMessage(usage());
    return true;
  }

  // /llm <baseUrl> <apiKey> [model]
  const baseUrl = parts[1]!;
  const apiKey = parts[2];
  const model = parts[3];
  if (!apiKey) {
    await deps.renderMessage(`❌ 缺少 apiKey。\n\n${usage()}`);
    return true;
  }
  if (!model) {
    await deps.renderMessage(
      '⚠️ 未指定模型名，各家端点只认自己的模型 ID（腾讯云 lkeap 用 `tc-code-latest`）。\n' +
      '请补上模型：`/llm ' + baseUrl + ' ' + maskApiKey(apiKey) + ' <model>`，或稍后 `/llm model <model>`。',
    );
    return true;
  }

  try {
    const normalized = normalizeBaseUrl(baseUrl);
    const config = saveLLMCredentials(normalized, apiKey, model);
    const text = [
      '✅ **LLM 已接入**',
      '',
      `- baseUrl：\`${config.baseUrl}\``,
      `- 端点：\`${buildChatCompletionsUrl(config.baseUrl)}\``,
      `- 模型：\`${config.model}\``,
      `- 超时：${(config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS) / 1000} 秒`,
      `- token 预算：${config.maxTokens ?? DEFAULT_LLM_MAX_TOKENS}`,
      `- 思考过程：${config.disableThinking ? '已关闭 ✅' : '已开启'}`,
      `- apiKey：\`${config.keyHint}\`（已加密缓存到 localStorage）`,
      '',
      '后续自然语言将由 LLM 解析；命令（`/` 开头）仍本地处理。',
      '可用 `/llm status` 查看、`/llm off` 关闭。',
    ].join('\n');
    await deps.renderMessage(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.renderMessage(`❌ 配置失败：${message}`);
  }
  return true;
}
