/**
 * 通用凭据录入 / 修改弹框
 * @module presentation/adapters/web/pages/assistant/SecretPromptDialog
 *
 * 交互与「导入图片编辑对阵表」同款：LLM 只贴一个 `secret-prompt:<key>` markdown
 * 链接，宿主用 document 事件委托接管 → 按 key 查配方声明的规格 → 弹框 →
 * 用户录入 → 自动保存 → 回灌一条用户消息触发 LLM 下一轮重试。
 *
 * 密钥全程只在本模块的 input.value 与宿主 KvService.put() 之间流动，
 * **绝不进模型上下文 / 会话历史 / 日志 / innerHTML**。
 * 弹框自己不认识任何具体 API：label / setupUrl / hint / key 全来自 SecretSpec，
 * 加一条新认证 API 只需加配方声明，本模块一行不改。
 *
 * 「下次不再弹框」不需要状态位：http_fetch_auth 在凭据存在时直接成功，
 * 只有缺失或命中 reauthStatuses 才回链接。「修改也弹框」由 secret_prompt
 * 原语保证：无论是否已配置都回同一条链接，本弹框检测到已有值就走「修改」文案。
 *
 * 边界：
 * - 只接受 ≥ 8 字符的值：不替用户判断凭据类型，交给服务端重认证状态判定；
 *   空值一律拒绝，避免误存把失效判据变成死循环。8 是明说的防误覆盖业务约束。
 * - 已有值只显示末 4 位，绝不回显完整明文到输入框。
 * - 存储是浏览器本地数据（LLMCredentialStore 口径：私有混淆，非密码学保密），
 *   弹框如实标注，不夸大安全性。
 * - 不写 history、不推进确认闸门：回灌走 ChatPage.useCase.send() 的正常路径。
 */
import type { KvService } from '../../../../../application/skill/kv/KvService';
import type { SecretSpec } from '../../../../../application/skill/SecretSpec';

const OVERLAY_ID = 'secretPromptDialogOverlay';

type SaveFn = () => Promise<void>;

/** 末 4 位：只用于「当前已配置」提示，不回显完整值 */
function tail4(value: string): string {
  const t = value.trim();
  return t.length <= 4 ? '••••' : `••••${t.slice(-4)}`;
}

function makeOverlay(): { overlay: HTMLDivElement; card: HTMLDivElement } {
  document.getElementById(OVERLAY_ID)?.remove();
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.cssText =
    'position: fixed; inset: 0; z-index: 10000; display: flex;'
    + ' align-items: center; justify-content: center; background: rgba(20,18,40,.55);';
  const card = document.createElement('div');
  card.style.cssText =
    'width: min(440px, calc(100vw - 32px)); max-height: 90vh; overflow: auto;'
    + ' background: #fff; border-radius: 14px; box-shadow: 0 18px 60px rgba(0,0,0,.28);'
    + ' font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #333;';
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  return { overlay, card };
}

function p(text: string, css: string): HTMLParagraphElement {
  const el = document.createElement('p');
  el.textContent = text;
  el.style.cssText = css;
  return el;
}

/**
 * 打开弹框。
 * @param kv 宿主存储服务（面板侧 put / readRaw）
 * @param spec 当前已启用配方里声明的凭据规格（key / label / setupUrl / hint）
 * @param onSaved 保存成功后的回调；宿主用它回灌一条用户消息触发 LLM 重试
 */
export function openSecretPromptDialog(
  kv: Pick<KvService, 'readRaw' | 'put'>,
  spec: SecretSpec,
  onSaved: () => void,
): void {
  const { overlay, card } = makeOverlay();

  const head = document.createElement('div');
  head.style.cssText = 'padding: 18px 20px 10px; border-bottom: 1px solid #eee;';
  const title = document.createElement('h3');
  title.textContent = `配置 ${spec.label}`;
  title.style.cssText = 'margin: 0 0 6px; font-size: 17px; color: #333;';
  head.appendChild(title);
  head.appendChild(p(
    '凭据只保存在本机浏览器，模型永远读不到、也不会写进对话记录。',
    'margin: 0; font-size: 12px; line-height: 1.6; color: #777;',
  ));
  card.appendChild(head);

  const body = document.createElement('div');
  body.style.cssText = 'padding: 16px 20px;';
  card.appendChild(body);

  // 当前状态：异步读，只显示末 4 位
  const status = p('读取当前配置…', 'margin: 0 0 12px; font-size: 12px; color: #888;');
  body.appendChild(status);
  void kv.readRaw('secrets', spec.key).then((v) => {
    if (!status.isConnected) return;
    status.textContent = typeof v === 'string' && v.trim()
      ? `当前已配置（${tail4(v)}）。保存会覆盖它。`
      : '当前未配置。';
  }).catch(() => {
    if (status.isConnected) status.textContent = '（读取当前配置失败，保存仍会覆盖）';
  });

  const label = document.createElement('label');
  label.textContent = spec.label;
  label.style.cssText = 'display: block; font-size: 12px; color: #555; margin-bottom: 6px;';
  body.appendChild(label);

  const input = document.createElement('input');
  input.type = 'password';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = '粘贴凭据';
  input.style.cssText =
    'width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid #d9d6f5;'
    + ' border-radius: 8px; font-size: 13px; font-family: monospace; color: #333; background: #fff;';
  body.appendChild(input);

  if (spec.setupUrl) {
    body.appendChild(p(`生成地址：${spec.setupUrl}`,
      'margin: 8px 0 0; font-size: 11px; line-height: 1.5; color: #999; word-break: break-all;'));
  }
  if (spec.hint) {
    body.appendChild(p(spec.hint,
      'margin: 8px 0 0; font-size: 11px; line-height: 1.5; color: #999;'));
  }

  const security = p(
    '⚠️ 存储为浏览器本地数据、非密码学加密；任何能执行本机页面脚本的人都可能取到。'
    + '请勿使用超出需要的权限，也不要共用高权限凭据。',
    'margin: 8px 0 0; font-size: 11px; line-height: 1.5; color: #8a6d00;',
  );
  body.appendChild(security);

  const err = document.createElement('div');
  err.style.cssText = 'margin-top: 10px; font-size: 12px; color: #c23b3b;';
  err.hidden = true;
  body.appendChild(err);

  const foot = document.createElement('div');
  foot.style.cssText =
    'display: flex; justify-content: flex-end; gap: 10px; padding: 12px 20px 18px;'
    + ' border-top: 1px solid #eee;';
  card.appendChild(foot);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = '取消';
  cancel.style.cssText =
    'padding: 8px 16px; border: 1px solid #ddd; border-radius: 8px;'
    + ' background: #fff; color: #666; font-size: 13px; cursor: pointer;';
  cancel.addEventListener('click', () => overlay.remove());
  foot.appendChild(cancel);

  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = '保存并继续';
  save.style.cssText =
    'padding: 8px 18px; border: 0; border-radius: 8px; background: #5b4b9e;'
    + ' color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;';
  const showError = (text: string): void => {
    err.textContent = text;
    err.hidden = false;
  };
  const doSave: SaveFn = async () => {
    const value = input.value.trim();
    if (value.length < 8) {
      showError('凭据太短（至少 8 字符）。留空不会保存，避免误覆盖。');
      return;
    }
    save.disabled = true;
    save.textContent = '保存中…';
    try {
      const result = await kv.put('secrets', spec.key, value);
      if (!result.ok) {
        showError(result.reason ?? '保存失败，请重试');
        save.disabled = false;
        save.textContent = '保存并继续';
        return;
      }
      // 明文只活到这一行：清空 DOM 里的值，不留在可恢复的 input 里。
      input.value = '';
      overlay.remove();
      onSaved();
    } catch (error) {
      showError(`保存失败：${error instanceof Error ? error.message : String(error)}`);
      save.disabled = false;
      save.textContent = '保存并继续';
    }
  };
  save.addEventListener('click', () => void doSave());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); void doSave(); }
  });
  foot.appendChild(save);
  input.focus();
}
