/**
 * 输入框 API Key 脱敏（显示脱敏 / 发送还原）
 * @module presentation/adapters/web/pages/assistant/ApiKeyInputMask
 *
 * 背景：用户常把 `/llm <baseUrl> <apiKey> <model>` 或一整串 key 复制粘贴
 * 到消息输入框。消息块与历史记录已有脱敏（AssistantUseCase.redactCommand），
 * 但输入框在发送前仍是明文，截图 / 肩窥会泄露。
 *
 * 做法：
 *  - maskApiKeysInText()：输入变化后把明文 key 换成 maskApiKey() 同款
 *    token（sk-***末 4 位），并返回按出现顺序的 token→原文 映射
 *  - restoreApiKeys()：发送前把 token 还原成原文，保证 /llm 配置可用
 *
 * 明文原文只存在调用方内存中的映射表，不写 DOM、不落盘、不进日志。
 * 用户编辑非 key 部分（baseUrl / 模型名 / 追加文字）不受影响，因为脱敏
 * token 只要还完整留在文本里，发送时就能还原。
 */
import { maskApiKey } from '../../../../../infrastructure/llm/LLMCredentialStore';
import { LLM_SUBCOMMANDS, isLLMCommand } from '../../../../../application/assistant/LLMCommand';

export interface KeyRestoration {
  /** 显示用的脱敏 token，如 sk-***1234 */
  token: string;
  /** 原始明文 key */
  raw: string;
}

export interface MaskResult {
  /** 脱敏后的显示文本 */
  display: string;
  /** 本次新产生的 token→原文 映射（按文本出现顺序） */
  restorations: KeyRestoration[];
  /** 传入 caret 时返回脱敏后应保持的光标位置，避免替换后光标跳位 */
  caret?: number;
}

interface Span { start: number; end: number; raw: string; }

/**
 * 已经是脱敏 token（或用户正在 backspace 删除它时的残缺片段）。
 *
 * ⚠️ 不能只认完整的 `sk-***xxxx`：用户把 `sk-***9jkl` 从右往左删到
 * `sk-**` / `sk-*` / `sk-` 时，若这里返回 false，残片会被当成「新的明文
 * key」再次脱敏并写回 textarea，字符复活 + 光标被强制挪位 —— 表现为
 * 「删一个字符输入框刷一次、又回到删除前状态」的无限回弹。
 *
 * 形态覆盖：
 *  - 完整 token：`sk-***` + 末 4 位、`****`
 *  - 删除残片：`sk-***9jk`、`sk-***`、`sk-**`、`sk-*`、`sk-`、`***`、`**`、`*`
 * 真正的明文 key 是 `sk-` + 16 位以上字母数字（由 skRe 负责），或不含
 * 星号的 /llm 第 3 段，均不以星号开头，不会被这里误判。
 */
function isMaskedToken(s: string): boolean {
  return /^sk-(?:\*|$)/.test(s) || /^\*+$/.test(s);
}

/** 找出文本中所有待脱敏的明文 key 区间（不重叠、按出现顺序） */
function findKeySpans(text: string): Span[] {
  const spans: Span[] = [];

  // 1) OpenAI 兼容 key：sk- 开头 + 16 位以上字母数字/下划线/连字符
  //    刻意不加单词边界：中文紧邻时 \b 不可靠，而「sk- + 16 位连续字符」
  //    在普通文本里几乎不可能是别的东西。
  const skRe = /sk-[A-Za-z0-9_-]{16,}/g;
  let m: RegExpExecArray | null;
  while ((m = skRe.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length, raw: m[0] });
  }

  // 2) /llm 配置命令的第 3 段（apiKey），覆盖不带 sk- 前缀的 key。
  //    /llm <baseUrl> <apiKey> [model]；子命令（model/status/off/...）跳过。
  if (isLLMCommand(text)) {
    const cm = text.match(/^(\s*\/llm\s+)(\S+)(\s+)(\S+)/i);
    if (cm) {
      const second = (cm[2] ?? '').toLowerCase();
      const raw = cm[4] ?? '';
      const start = (cm[1] ?? '').length + (cm[2] ?? '').length + (cm[3] ?? '').length;
      const end = start + raw.length;
      const overlap = spans.some(s => start < s.end && end > s.start);
      if (!LLM_SUBCOMMANDS.has(second) && raw && !isMaskedToken(raw) && !overlap) {
        spans.push({ start, end, raw });
      }
    }
  }

  spans.sort((a, b) => a.start - b.start);
  // 去重叠（保险）：保留先出现的
  const merged: Span[] = [];
  for (const s of spans) {
    if (merged.length && s.start < merged[merged.length - 1]!.end) continue;
    merged.push(s);
  }
  return merged;
}

/**
 * 扫描文本，返回脱敏显示串 + 还原表；无 key 时 display 原样、restorations 为空。
 * 传入 caret（脱敏前光标位置）时返回脱敏后应保持的光标位置：
 * 光标之前的 key 变短了多少，就把光标前移多少；光标落在 key 内部时贴到 token 末尾。
 */
export function maskApiKeysInText(text: string, caret?: number): MaskResult {
  const spans = findKeySpans(text);
  if (spans.length === 0) {
    return { display: text, restorations: [], ...(caret !== undefined ? { caret } : {}) };
  }

  let display = '';
  let cursor = 0;
  let newCaret = caret;
  const restorations: KeyRestoration[] = [];
  for (const s of spans) {
    display += text.slice(cursor, s.start);
    const token = maskApiKey(s.raw);
    display += token;
    restorations.push({ token, raw: s.raw });
    if (newCaret !== undefined) {
      const delta = token.length - s.raw.length;
      if (newCaret >= s.end) {
        newCaret += delta;                       // key 整体在光标前：平移
      } else if (newCaret > s.start) {
        newCaret = s.start + token.length;       // 光标在 key 内部：贴到 token 末尾
      }
    }
    cursor = s.end;
  }
  display += text.slice(cursor);
  return { display, restorations, ...(newCaret !== undefined ? { caret: newCaret } : {}) };
}

/**
 * 让还原表与当前显示文本里实际存在的 token 对齐。
 * 每个 token 只保留「最近出现的 N 个」，N = 该 token 在文本中的出现次数。
 * 这样用户删掉已脱敏的 key 再贴一个新 key（哪怕末 4 位相同）也不会串位。
 */
export function pruneRestorations(display: string, restorations: KeyRestoration[]): KeyRestoration[] {
  if (restorations.length === 0) return [];
  const tokens = [...new Set(restorations.map(r => r.token))];
  const total = new Map<string, number>();
  const keep = new Map<string, number>();
  for (const t of tokens) {
    total.set(t, restorations.filter(r => r.token === t).length);
    keep.set(t, Math.max(0, display.split(t).length - 1));
  }
  const seen = new Map<string, number>();
  const result: KeyRestoration[] = [];
  for (const r of restorations) {
    const idx = seen.get(r.token) ?? 0;
    seen.set(r.token, idx + 1);
    // 保留该 token 的最后 keep 个（丢弃更早的、已被删掉的）
    if (idx >= total.get(r.token)! - keep.get(r.token)!) result.push(r);
  }
  return result;
}

/**
 * 发送前把显示串里的脱敏 token 还原成原文。
 * 按 token 建 FIFO 队列，从左到右扫描文本逐个消费 —— 支持同一文本里
 * 多个 key、以及末 4 位相同导致 token 重复的情况。
 */
export function restoreApiKeys(display: string, restorations: KeyRestoration[]): string {
  if (restorations.length === 0) return display;
  const queues = new Map<string, string[]>();
  for (const { token, raw } of restorations) {
    const q = queues.get(token);
    if (q) q.push(raw); else queues.set(token, [raw]);
  }
  // 长 token 优先，避免前缀误匹配
  const tokens = [...queues.keys()].sort((a, b) => b.length - a.length);
  let out = '';
  let i = 0;
  while (i < display.length) {
    let matched = false;
    for (const t of tokens) {
      const q = queues.get(t)!;
      if (q.length > 0 && display.startsWith(t, i)) {
        out += q.shift();
        i += t.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += display[i];
      i += 1;
    }
  }
  return out;
}
