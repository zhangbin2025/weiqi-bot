/**
 * 附件按钮可用性回归（2026-11-13 用户实测「点击附件按钮没有反应」）
 *
 * 三个必须锁住的点：
 * 1. bindEarlyUI() 在 resolveProxyUrl / IndexedDB / 插件初始化之前就能绑定；
 * 2. 重复调用幂等（onclick 赋值，不会叠加多个文件选择器）；
 * 3. 选附件是纯本地行为，不依赖 LLM 是否就绪。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatPage } from '../ChatPage';

function harness() {
  const doc = document;
  doc.body.innerHTML = `
    <button id="attachBtn" type="button">📎</button>
    <input type="file" id="attachInput" hidden multiple>
    <div id="attachPreview"></div><div id="attachMode"></div>
    <textarea id="userInput" disabled></textarea>
    <button id="sendBtn" disabled></button><div id="notReady"></div>`;
  const page = Object.create(ChatPage.prototype) as ChatPage & Record<string, unknown>;
  page['pendingFiles'] = [];
  // renderAttachPreview 只碰 DOM，不碰 history/useCase
  return { doc, page };
}

describe('ChatPage 附件按钮早期绑定', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('bindEarlyUI() 无需 init 就能让按钮点开 file input', () => {
    const { doc, page } = harness();
    const btn = doc.getElementById('attachBtn') as HTMLButtonElement;
    const input = doc.getElementById('attachInput') as HTMLInputElement;
    const clickSpy = vi.fn();
    input.click = clickSpy;

    expect(btn.onclick).toBeNull();
    page.bindEarlyUI(); // 入口在 await resolveProxyUrl 之前调用
    expect(btn.onclick).not.toBeNull();
    btn.click();
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('重复绑定幂等：点一次只开一个文件选择器', () => {
    const { doc, page } = harness();
    const btn = doc.getElementById('attachBtn') as HTMLButtonElement;
    const input = doc.getElementById('attachInput') as HTMLInputElement;
    const clickSpy = vi.fn();
    input.click = clickSpy;
    page.bindEarlyUI();
    page.bindEarlyUI(); // init() 里还会再调一次
    btn.click();
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('change 事件把文件收进 pendingFiles 并渲染文件名（不含内容）', () => {
    const { doc, page } = harness();
    page.bindEarlyUI();
    const input = doc.getElementById('attachInput') as HTMLInputElement;
    const file = new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.onchange?.(new Event('change') as never);
    const files = page['pendingFiles'] as Array<{ name: string }>;
    expect(files).toHaveLength(1);
    expect(files[0]!.name).toBe('doc.pdf');
    const preview = doc.getElementById('attachPreview')!;
    expect(preview.textContent).toContain('doc.pdf');
    expect(preview.textContent).not.toContain('%PDF');
    expect(preview.style.display).toBe('flex');
  });

  it('「PDF 读取方式」只在有 PDF 时出现；纯图片不提示，移除最后一个 PDF 后收起', () => {
    const { doc, page } = harness();
    const mode = doc.getElementById('attachMode')!;
    const render = () => (page['renderAttachPreview'] as () => void).call(page);

    // 纯图片：预览条可见，但模式选择器保持隐藏
    page['pendingFiles'] = [{ name: 'board.png', type: 'image/png' }];
    render();
    expect(doc.getElementById('attachPreview')!.style.display).toBe('flex');
    expect(mode.style.display).toBe('none');

    // 加一个 PDF：出现
    page['pendingFiles'].push({ name: 'doc.pdf', type: 'application/pdf' });
    render();
    expect(mode.style.display).toBe('flex');

    // 移除 PDF（点 chip 上的 ×）：重新判定，收起
    const chips = doc.querySelectorAll('#attachPreview .attach-chip__x');
    const pdfRemove = chips[1] as HTMLButtonElement;
    pdfRemove.click();
    expect(page['pendingFiles']).toHaveLength(1);
    expect(mode.style.display).toBe('none');
  });

  it('syncReadyState 不再禁用附件按钮（没配 LLM 也能选文件）', () => {
    const { doc, page } = harness();
    const btn = doc.getElementById('attachBtn') as HTMLButtonElement;
    page['useCase'] = { isReady: () => false };
    (page['syncReadyState'] as () => void).call(page);
    expect((doc.getElementById('userInput') as HTMLTextAreaElement).disabled).toBe(true);
    expect((doc.getElementById('sendBtn') as HTMLButtonElement).disabled).toBe(true);
    expect(btn.disabled).toBe(false);
  });
});
