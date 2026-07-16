/**
 * 打字机效果模块
 */

export interface TypewriterOptions {
  speed?: number;
  cursor?: string;
  showCursor?: boolean;
  maxDuration?: number; // 最大打字时长（毫秒），超过后直接渲染完整内容（默认 5000ms = 5秒）
}

export async function typewriterEffectHTML(
  element: HTMLElement,
  html: string,
  options: TypewriterOptions = {}
): Promise<void> {
  const { speed = 30, cursor = '▌', showCursor = true, maxDuration = 5000 } = options;

  element.innerHTML = html;
  const fullText = element.innerText || '';
  
  // 如果文本过长，直接显示，不使用打字机效果
  const MAX_TYPEWRITER_LENGTH = 500;
  if (fullText.length > MAX_TYPEWRITER_LENGTH) {
    console.log(`[typewriter] 文本过长 (${fullText.length} 字符)，跳过打字机效果`);
    return;
  }

  // 记录开始时间
  const startTime = Date.now();
  const maxEndTime = startTime + maxDuration;
  
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
    // 检查是否超时
    if (Date.now() > maxEndTime) {
      console.log(`[typewriter] 打字机效果超时 (${maxDuration}ms)，直接渲染完整内容`);
      display.innerHTML = temp.innerHTML;
      if (cursorEl && cursorEl.parentNode) cursorEl.parentNode.removeChild(cursorEl);
      return;
    }

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
    
    await new Promise(r => setTimeout(r, speed));
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
