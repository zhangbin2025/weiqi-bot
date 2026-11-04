/**
 * LLM 凭据存储
 * @module infrastructure/llm/LLMCredentialStore
 *
 * ⚠️ 安全边界（务必知悉）
 * 这是纯前端的「私有混淆」，不是密码学意义上的保密：密钥是本机随机生成后
 * 存在 localStorage 里的，任何能执行页面脚本 / 打开 devtools 的人都能取到并解密。
 * 它只保证 apiKey **不以明文落盘**，不保证「别人拿到浏览器也解不开」。
 * 要真安全必须把 key 放到后端代理，那是另一个工程量。
 *
 * 设计取舍
 * - 不硬编码密钥：密钥 = 首次运行时随机生成的 32 字节，存 localStorage；
 *   源码里没有任何密钥常量（只有算法本身的常数，不是秘密）。
 * - 不依赖 Web Crypto：`crypto.subtle` 在 `http://10.1.4.6:3000` 这类
 *   非安全上下文里不可用，所以自己实现流加密，纯 JS 全环境可用。
 * - 解密不需要用户重输 apiKey → 刷新页面后可直接复用（满足「缓存以便后用」）。
 */

/**
 * 默认模型名。
 * ⚠️ 各家 OpenAI 兼容端点只认自己的模型 ID，不存在通用默认值：
 * 腾讯云 lkeap coding 用 `tc-code-latest`，OpenAI 官方用 `gpt-4o-mini`，
 * 写死任一个都会让另一家直接 400 invalid model。因此留空，
 * 由 /llm 配置时要求显式指定，LLMIntentProvider 里再做兜底提示。
 */
export const DEFAULT_LLM_MODEL = '';

/**
 * 默认请求超时（毫秒）。
 * 20s 对「意图分类」够用，但推理模型（如 tc-code-latest）在闲聊时要先生成
 * 一长段 reasoning_content 再吐 content，实测常超过 20s。故默认 60s，
 * 并允许 /llm timeout <秒> 调整（5~300s）。
 */
export const DEFAULT_LLM_TIMEOUT_MS = 60_000;
export const MIN_LLM_TIMEOUT_MS = 5_000;
export const MAX_LLM_TIMEOUT_MS = 300_000;

/**
 * 单次补全的 token 预算默认值。
 * ⚠️ 推理模型（tc-code-latest 等）的 reasoning_content 与 content 共享这份预算：
 * 实测「什么叫倒脱靴」这类术语问答，模型光思考就烧满 1024，content 为空、
 * finish_reason=length。故默认 4096，留足「思考 + 输出 JSON」的空间。
 * 注意：调大 timeout（请求超时秒数）对此毫无帮助，两者不是一回事。
 */
export const DEFAULT_LLM_MAX_TOKENS = 4096;
export const MIN_LLM_MAX_TOKENS = 512;
export const MAX_LLM_MAX_TOKENS = 16384;

/** 把用户输入/存储的超时值收敛到合法区间 */
export function normalizeTimeoutMs(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_LLM_TIMEOUT_MS;
  return Math.min(MAX_LLM_TIMEOUT_MS, Math.max(MIN_LLM_TIMEOUT_MS, Math.round(n)));
}

/** 把用户输入/存储的 max_tokens 收敛到合法区间 */
export function normalizeMaxTokens(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_LLM_MAX_TOKENS;
  return Math.min(MAX_LLM_MAX_TOKENS, Math.max(MIN_LLM_MAX_TOKENS, Math.round(n)));
}

const STORAGE_KEY = 'weiqi.llm.config';
const KEY_MATERIAL_KEY = 'weiqi.llm.key';
const MAGIC = 'WQLLM2'; // 明文校验标记，用于判断解密是否成功（非秘密）
const VERSION = 2; // v2：密文带随机 nonce，修复 v1 密钥流复用问题

/** 存储的配置（apiKey 为密文） */
export interface LLMStoredConfig {
  baseUrl: string;
  model: string;
  encryptedApiKey: string;
  /** 仅存末尾 4 位，供 status 显示，不存完整 key */
  keyHint: string;
  /** 请求超时（毫秒）；老配置缺此字段时按默认值处理 */
  timeoutMs?: number;
  /** 单次补全 token 预算；老配置缺此字段时按默认值处理 */
  maxTokens?: number;
  updatedAt: number;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * 取（或首次生成）本机密钥材料。
 * 密钥随机生成，绝不写在源码里；只有这一段随机字节是秘密。
 */
function getKeyMaterial(): Uint8Array {
  let raw = localStorage.getItem(KEY_MATERIAL_KEY);
  if (!raw) {
    const bytes = new Uint8Array(32);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
    } else {
      // 极端兜底：非浏览器/老 WebView，用 Math.random（安全性更弱，但至少不硬编码）
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    raw = toBase64(bytes);
    localStorage.setItem(KEY_MATERIAL_KEY, raw);
  }
  return fromBase64(raw);
}

/** FNV-1a 32 位散列，用于把「密钥材料 + origin」混成 PRNG 种子 */
function hashSeed(input: Uint8Array, extra: string): number {
  let h = 0x811c9dc5;
  const feed = (b: number) => {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (let i = 0; i < input.length; i++) feed(input[i]!);
  const extraBytes = new TextEncoder().encode(extra);
  for (let i = 0; i < extraBytes.length; i++) feed(extraBytes[i]!);
  return h >>> 0;
}

/** xorshift32 伪随机流 */
function makeKeystream(seed: number, length: number): Uint8Array {
  let state = (seed || 0x9e3779b9) >>> 0;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    out[i] = state & 0xff;
  }
  return out;
}

function originHint(): string {
  try {
    return typeof location !== 'undefined' ? location.origin : 'weiqi-assistant';
  } catch {
    return 'weiqi-assistant';
  }
}

function xorBytes(data: Uint8Array, seed: number): Uint8Array {
  const stream = makeKeystream(seed, data.length);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i]! ^ stream[i]!;
  return out;
}

function randomNonce(): Uint8Array {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/**
 * 加密：每次生成随机 nonce 混入种子，避免同一密钥流被复用（two-time pad）。
 * 载荷格式 VERSION.nonce.ciphertext，均为 base64。
 */
function encryptApiKey(apiKey: string): string {
  const nonce = randomNonce();
  const nonceText = toBase64(nonce);
  const seed = hashSeed(getKeyMaterial(), originHint() + '|' + nonceText);
  const plain = new TextEncoder().encode(MAGIC + apiKey);
  const cipher = xorBytes(plain, seed);
  return `${VERSION}.${nonceText}.${toBase64(cipher)}`;
}

/** 解密：校验 MAGIC 后返回明文 apiKey；任何异常返回 null */
function decryptApiKey(payload: string): string | null {
  try {
    const parts = payload.split('.');
    if (parts.length !== 3 || parts[0] !== String(VERSION)) return null;
    const seed = hashSeed(getKeyMaterial(), originHint() + '|' + parts[1]!);
    const plain = xorBytes(fromBase64(parts[2]!), seed);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(plain);
    if (!text.startsWith(MAGIC)) return null;
    return text.slice(MAGIC.length);
  } catch {
    return null;
  }
}

/** 脱敏显示：只保留末尾 4 位 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) return '****';
  return `sk-***${apiKey.slice(-4)}`;
}

/** 归一化 base URL：去尾斜杠、去掉误贴的 /chat/completions，拒绝非 http(s) */
export function normalizeBaseUrl(input: string): string {
  let trimmed = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('URL 必须以 http:// 或 https:// 开头');
  }
  // 用户常直接贴完整端点，去掉后让 buildChatCompletionsUrl 统一拼，避免重复
  trimmed = trimmed.replace(/\/chat\/completions\/?$/i, '');
  return trimmed;
}

/** 由 base URL 得到 chat/completions 端点，兼容用户贴了 /v1 或完整路径 */
export function buildChatCompletionsUrl(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (/\/chat\/completions\/?$/i.test(base)) return base;
  if (/\/v\d+\/?$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

/** 保存/更新凭据 */
export function saveLLMCredentials(
  baseUrl: string,
  apiKey: string,
  model: string = DEFAULT_LLM_MODEL,
  timeoutMs: number = DEFAULT_LLM_TIMEOUT_MS,
  maxTokens: number = DEFAULT_LLM_MAX_TOKENS,
): LLMStoredConfig {
  const config: LLMStoredConfig = {
    baseUrl: normalizeBaseUrl(baseUrl),
    model: model.trim(),
    encryptedApiKey: encryptApiKey(apiKey),
    keyHint: maskApiKey(apiKey),
    timeoutMs: normalizeTimeoutMs(timeoutMs),
    maxTokens: normalizeMaxTokens(maxTokens),
    updatedAt: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  return config;
}

/** 读取已存配置（不含明文 key） */
export function loadLLMConfig(): LLMStoredConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LLMStoredConfig>;
    // model 允许为空字符串：用户可先只配 url/key，再用 /llm model 补
    if (!parsed.baseUrl || !parsed.encryptedApiKey || typeof parsed.model !== 'string') return null;
    return {
      baseUrl: parsed.baseUrl,
      model: parsed.model,
      encryptedApiKey: parsed.encryptedApiKey,
      keyHint: parsed.keyHint ?? '',
      // 兼容旧配置（无 timeoutMs / maxTokens 字段）
      timeoutMs: normalizeTimeoutMs(parsed.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS),
      maxTokens: normalizeMaxTokens(parsed.maxTokens ?? DEFAULT_LLM_MAX_TOKENS),
      updatedAt: parsed.updatedAt ?? 0,
    };
  } catch {
    return null;
  }
}

/** 取解密后的 apiKey（供发请求用），失败返回 null */
export function loadApiKey(): string | null {
  const config = loadLLMConfig();
  if (!config) return null;
  return decryptApiKey(config.encryptedApiKey);
}

/** 自检：密文能否正常解出 */
export function isCredentialUsable(): boolean {
  return loadApiKey() !== null;
}

/** 清除凭据（连同本机密钥材料一起清掉） */
export function clearLLMCredentials(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(KEY_MATERIAL_KEY);
}
