/**
 * /proxy 命令 —— 设置 / 查看 / 清除纯 Web 代理地址。
 * @module application/assistant/ProxyCommand
 *
 * ⚠️ 同 /llm：必须在 CommandHandler 的 toLowerCase() 之前用原始串拦截，
 * 否则 URL 的路径大小写会被破坏。命令自行完成渲染 + 存历史（见 LLMCommand）。
 *
 * 用法:
 *   /proxy                 查看当前代理
 *   /proxy status          查看当前代理
 *   /proxy <url>           设置并持久化代理（http/https）
 *   /proxy reset           清除覆盖值，回落环境默认
 *
 * 生效范围：覆盖值写入 localStorage（用户数据，一直生效）；随后立即
 * installLLMProxy(<url>) 让「当前功能助手页」的 LLM 请求即时切换。其它页面
 * （对话页 / 各业务页）在下次进入时由 resolveProxyUrl() 读到覆盖值，刷新生效。
 * 在线真人对弈的 wss://api.weiqi.lol/ws/signal 不走这套代理，天然不受影响。
 * App / 桌面走各自的本地代理：resolveProxyUrl 不读覆盖值，命令层也直接拦截，
 * 绝不让 installLLMProxy 绕过三端分流去改当前页的 LLM 代理。
 */

import {
  loadWebProxyOverride,
  saveWebProxyOverride,
  clearWebProxyOverride,
} from '../../infrastructure/config/WebProxyOverride';
import { installLLMProxy } from '../../infrastructure/llm/LLMProxyUrl';

export interface ProxyCommandDeps {
  /** 渲染并保存到历史（复用 CommandHandler 的既有行为） */
  renderMessage: (content: string) => Promise<void>;
}

/** 是否是 /proxy 命令（主命令匹配，大小写不敏感） */
export function isProxyCommand(raw: string): boolean {
  return raw.trim().split(/\s+/)[0]?.toLowerCase() === '/proxy';
}

function usage(): string {
  return [
    '🌐 **Web 代理**',
    '',
    '| 命令 | 说明 |',
    '|---|---|',
    '| `/proxy` / `/proxy status` | 查看当前代理 |',
    '| `/proxy <url>` | 设置并持久化代理 |',
    '| `/proxy reset` | 清除覆盖值，回落环境默认 |',
    '',
    '- 只支持 http/https 的完整地址，例如 `https://api.weiqi.lol`',
    '- 设置后一直生效（存 localStorage），只有 `/proxy reset` 或清浏览器数据才回落',
    '- 仅纯 Web 生效；App / 桌面仍走本地代理；在线真人对弈固定 api.weiqi.lol',
  ].join('\n');
}

/** 处理 /proxy。返回 true 表示已消费该命令。 */
export async function handleProxyCommand(raw: string, deps: ProxyCommandDeps): Promise<boolean> {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const main = parts[0]?.toLowerCase();
  if (main !== '/proxy') return false;

  // 只支持纯 Web：App / 桌面固定走本地代理。必须在这里拦住，否则命令会
  // 直接 installLLMProxy 绕过 resolveProxyUrl，把当前页 LLM 代理改掉。
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp')) {
    await deps.renderMessage(
      'ℹ️ /proxy 仅用于纯 Web 浏览器环境；App / 桌面客户端固定走本地代理，不受此设置影响。',
    );
    return true;
  }

  const sub = parts[1];

  // /proxy 或 /proxy status：查看
  if (!sub || sub.toLowerCase() === 'status') {
    const cur = loadWebProxyOverride();
    const text = [
      '🌐 **当前 Web 代理**',
      '',
      cur
        ? `- 用户覆盖值：\`${cur}\`（/proxy 设置，一直生效）`
        : '- 未设置覆盖值，使用环境默认代理',
      '',
      '- 设置：`/proxy <url>`　·　清除：`/proxy reset`',
    ].join('\n');
    await deps.renderMessage(text);
    return true;
  }

  // /proxy reset：用户主动清空
  if (sub.toLowerCase() === 'reset') {
    clearWebProxyOverride();
    await deps.renderMessage(
      '✅ 已清除代理覆盖值，回落环境默认代理。\n\n' +
      '当前页 LLM 仍沿用刚才的代理直到刷新；刷新后所有页面统一回落。',
    );
    return true;
  }

  // /proxy <url>：设置（sub 本身即 URL，保留原始大小写，绝不 toLowerCase）
  if (parts.length > 2) {
    await deps.renderMessage('❌ 代理地址不能包含空格。\n\n用法：`/proxy <url>`');
    return true;
  }
  try {
    const normalized = saveWebProxyOverride(sub);
    // 当前功能助手页的 LLM 请求即时切换（注册表幂等：后登记覆盖先登记）。
    installLLMProxy(normalized);
    await deps.renderMessage(
      `✅ **代理已设置**：\`${normalized}\`\n\n` +
      '- 已持久化到 localStorage，之后一直生效（除在线真人对弈外都走它）\n' +
      '- 当前功能助手页 LLM 已立即切换；对话页 / 业务页刷新后生效\n' +
      '- 需要回落：`/proxy reset`',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.renderMessage(`❌ 设置失败：${message}\n\n${usage()}`);
  }
  return true;
}
