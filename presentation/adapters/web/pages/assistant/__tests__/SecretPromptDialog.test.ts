/** @vitest-environment jsdom */
/**
 * 通用凭据弹框：明文只在 input.value ↔ kv.put() 之间流动。
 * 用 jsdom 而非 happy-dom，因为要验 password input / hidden / isConnected。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { openSecretPromptDialog } from '../SecretPromptDialog';
import type { SecretSpec } from '../../../../../application/skill/SecretSpec';

const GH: SecretSpec = {
  key: 'github_token',
  label: 'GitHub Personal Access Token',
  setupUrl: 'https://github.com/settings/tokens',
  hint: '需 repo 权限',
  allowedHosts: ['api.github.com'],
  header: { name: 'Authorization', prefix: 'Bearer ' },
};

function fakeKv(current: unknown = null) {
  return {
    readRaw: vi.fn(async (_domain: string, _key: string) => current),
    put: vi.fn(async (_domain: string, _key: string, _value: unknown) => ({ ok: true })),
  };
}

function q<T extends HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(`#secretPromptDialogOverlay ${sel}`);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
}

afterEach(() => {
  document.getElementById('secretPromptDialogOverlay')?.remove();
  document.body.innerHTML = '';
});

describe('openSecretPromptDialog', () => {
  it('按 spec 渲染 label / setupUrl / hint，标题不写死某个 API', () => {
    openSecretPromptDialog(fakeKv(), GH, () => {});
    expect(document.body.textContent).toContain('配置 GitHub Personal Access Token');
    expect(document.body.textContent).toContain('https://github.com/settings/tokens');
    expect(document.body.textContent).toContain('需 repo 权限');
    expect(q<HTMLInputElement>('input').type).toBe('password');
    // 安全边界如实标注，不夸大
    expect(document.body.textContent).toContain('非密码学加密');
  });

  it('已有值只显示末 4 位，绝不回显完整明文；readRaw 用 secrets 域 + spec.key', async () => {
    const kv = fakeKv('ghp_OLD_SECRET_1234');
    openSecretPromptDialog(kv, GH, () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(kv.readRaw).toHaveBeenCalledWith('secrets', 'github_token');
    expect(document.body.textContent).toContain('••••1234');
    expect(document.body.textContent).toContain('保存会覆盖');
    expect(document.body.textContent).not.toContain('ghp_OLD_SECRET_1234');
    expect(q<HTMLInputElement>('input').value).toBe('');
  });

  it('保存：走 kv.put(secrets, spec.key, 值)，成功后清空 input、移除弹框、回调一次', async () => {
    const kv = fakeKv();
    const onSaved = vi.fn();
    openSecretPromptDialog(kv, GH, onSaved);
    const token = 'ghp_FAKE_TOKEN_123456';
    q<HTMLInputElement>('input').value = token;
    const save = [...document.querySelectorAll<HTMLButtonElement>('#secretPromptDialogOverlay button')]
      .find((b) => b.textContent === '保存并继续')!;
    save.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(kv.put).toHaveBeenCalledWith('secrets', 'github_token', token);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(document.getElementById('secretPromptDialogOverlay')).toBeNull();
    expect(document.body.textContent).not.toContain(token);
  });

  it('空值 / 过短值拒绝保存，绝不误覆盖已有值', async () => {
    const kv = fakeKv('ghp_OLD_SECRET_1234');
    const onSaved = vi.fn();
    openSecretPromptDialog(kv, GH, onSaved);
    const input = q<HTMLInputElement>('input');
    const save = [...document.querySelectorAll<HTMLButtonElement>('#secretPromptDialogOverlay button')]
      .find((b) => b.textContent === '保存并继续')!;
    input.value = '';
    save.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(kv.put).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('凭据太短');

    input.value = 'short';
    save.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(kv.put).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('put 回执失败如实显示（含超上限），不谎报已保存、不回调', async () => {
    const kv = fakeKv();
    (kv.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, reason: '超出单条上限' });
    const onSaved = vi.fn();
    openSecretPromptDialog(kv, GH, onSaved);
    q<HTMLInputElement>('input').value = 'ghp_FAKE_TOKEN_123456';
    [...document.querySelectorAll<HTMLButtonElement>('#secretPromptDialogOverlay button')]
      .find((b) => b.textContent === '保存并继续')!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.textContent).toContain('超出单条上限');
    expect(document.getElementById('secretPromptDialogOverlay')).not.toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
    // 按钮恢复可用，用户可重试
    expect([...document.querySelectorAll<HTMLButtonElement>('#secretPromptDialogOverlay button')]
      .some((b) => b.textContent === '保存并继续' && !b.disabled)).toBe(true);
  });

  it('换一条 spec：弹框自动换成新 label / key，无需改弹框代码', () => {
    const other: SecretSpec = {
      key: 'gitlab_token', label: 'GitLab Token',
      allowedHosts: ['gitlab.com'], header: { name: 'PRIVATE-TOKEN', prefix: '' },
    };
    const kv = fakeKv();
    openSecretPromptDialog(kv, other, () => {});
    expect(document.body.textContent).toContain('配置 GitLab Token');
    expect(document.body.textContent).not.toContain('GitHub Personal Access Token');
    q<HTMLInputElement>('input').value = 'glpat_FAKE_TOKEN_123456';
    [...document.querySelectorAll<HTMLButtonElement>('#secretPromptDialogOverlay button')]
      .find((b) => b.textContent === '保存并继续')!.click();
    return Promise.resolve().then(() => {
      expect(kv.put).toHaveBeenCalledWith('secrets', 'gitlab_token', 'glpat_FAKE_TOKEN_123456');
    });
  });
});
