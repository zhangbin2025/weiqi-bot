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
    '/llm <baseUrl> <apiKey> <model>  配置并启用（模型必填）',
    '/llm model <name>                修改模型名',
    '/llm status                      查看当前配置',
    '/llm off                         关闭并清除凭据',
    '/llm                             显示本帮助',
    '```',
    '',
    '- baseUrl 填服务根地址（如 `https://api.x.com/v1`），也接受完整 `/chat/completions` 端点',
    '- 协议：OpenAI 兼容 `POST /chat/completions`，`Authorization: Bearer <apiKey>`',
    '',
    '⚠️ **模型名必须显式指定**：各家兼容端点只认自己的模型 ID，没有通用默认值。',
    '  例：腾讯云 lkeap → `tc-code-latest`；OpenAI 官方 → `gpt-4o-mini`。',
    '  填错会返回 400 `invalid model`。可用 `/llm model <name>` 随时改。',
    '',
    '- 启用后，所有**自然语言**都交给 LLM 解析；`/` 开头的命令仍然本地处理，不走 LLM',
    '- LLM 失败（超时 / 报错 / 返回非法 JSON）会提示失败并**不执行**任何意图，也不会回落本地识别',
    '',
    '⚠️ apiKey 以混淆方式存在 localStorage（密钥为本机随机生成，不硬编码）。',
    '纯前端存储**不等于保密**：能打开 devtools / 执行页面脚本的人仍可解密。',
  ].join('\n');
}

/** 把用户输入的命令渲染成脱敏版本（主命令 + 参数名，不含 apiKey 明文） */
export function redactCommand(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  if (parts.length >= 3 && parts[0]?.toLowerCase() === '/llm' && parts[1]?.toLowerCase() !== 'model') {
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
      `- apiKey：\`${config.keyHint || '****'}\`（已加密缓存）`,
      `- 更新时间：${new Date(config.updatedAt).toLocaleString()}`,
    ].join('\n');
    await deps.renderMessage(text);
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
    saveLLMCredentials(config.baseUrl, apiKey, model);
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
