/**
 * 打字机效果模块
 */

export interface TypewriterOptions {
  speed?: number;
  cursor?: string;
  showCursor?: boolean;
  maxDuration?: number; // 打字总时长预算（毫秒），默认 3000ms；超长文本自动加速而非跳过
}

export async function typewriterEffectHTML(
  element: HTMLElement,
  html: string,
  options: TypewriterOptions = {}
): Promise<void> {
  const { speed = 30, cursor = '▌', showCursor = true, maxDuration = 3000 } = options;

  element.innerHTML = html;
  const fullText = element.innerText || '';

  // 开跑前按字数预判：字数 × speed 超过预算就整段渲染。
  // 旧实现用固定 500 字阈值、却在中途 5s 才兜底，167~500 字的消息必然
  // 「先逐字打 5 秒 → 打超时日志 → 补渲染全文」，既慢又刷屏。
  const estimated = fullText.length * speed;
  const effectiveSpeed = estimated > maxDuration
    ? Math.max(1, Math.floor(maxDuration / Math.max(1, fullText.length)))
    : speed;
  if (fullText.length === 0 || effectiveSpeed < 4) {
    // 逐字间隔不足 4ms 时人眼已看不出打字效果，直接整段渲染
    element.innerHTML = html;
    return;
  }

  element.innerHTML = '';

  const temp = document.createElement('div');
  temp.innerHTML = html;

  const display = document.createElement('div');
  element.appendChild(display);

  if (!document.getElementById('typewriter-blink-style')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'typewriter-blink-style';
    styleEl.textContent = `
      @keyframes typewriterBlink {
        0%, 49% { opacity: 1; }
        50%, 100% { opacity: 0; }
      }
    `;
    document.head.appendChild(styleEl);
  }

  let cursorEl: HTMLElement | null = null;
  if (showCursor) {
    cursorEl = document.createElement('span');
    cursorEl.textContent = cursor;
    cursorEl.style.color = '#667eea';
    cursorEl.style.animation = 'typewriterBlink 1s infinite';
    cursorEl.style.display = 'inline-block';
    element.appendChild(cursorEl);
  }

  function truncate(node: Node, limit: { remaining: number }): boolean {
    if (limit.remaining <= 0) {
      if (node.nodeType === Node.TEXT_NODE) {
        (node as Text).textContent = '';
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        while (el.firstChild) el.removeChild(el.firstChild);
      }
      return false;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      const t = textNode.textContent || '';
      if (t.length <= limit.remaining) {
        limit.remaining -= t.length;
        return true;
      } else {
        textNode.textContent = t.substring(0, limit.remaining);
        limit.remaining = 0;
        return true;
      }
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      for (const child of Array.from(el.childNodes)) {
        const keep = truncate(child, limit);
        if (!keep && child.parentNode) child.parentNode.removeChild(child);
      }
      return true;
    }

    return true;
  }

  for (let i = 1; i <= fullText.length; i++) {
    const clone = temp.cloneNode(true) as HTMLElement;
    truncate(clone, { remaining: i });
    display.innerHTML = '';
    display.appendChild(clone);
    if (cursorEl) element.appendChild(cursorEl);
    
    // 向上找可滚动的父容器，滚到底部
    let scrollParent: HTMLElement | null = element.parentElement;
    while (scrollParent) {
      const style = window.getComputedStyle(scrollParent);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        scrollParent.scrollTop = scrollParent.scrollHeight;
        break;
      }
      scrollParent = scrollParent.parentElement;
    }
    
    await new Promise(r => setTimeout(r, effectiveSpeed));
  }

  display.innerHTML = temp.innerHTML;
  if (cursorEl && cursorEl.parentNode) cursorEl.parentNode.removeChild(cursorEl);
}

export async function typewriterEffect(
  element: HTMLElement,
  text: string,
  options: TypewriterOptions = {}
): Promise<void> {
  element.textContent = text;
}
