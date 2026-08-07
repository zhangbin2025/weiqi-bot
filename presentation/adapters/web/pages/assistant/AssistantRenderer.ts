/**
 * 消息渲染器
 * @module presentation/adapters/web/pages/assistant/AssistantRenderer
 */
import type { IMessageRenderer } from '../../../../../application/assistant/IMessageRenderer';
import { typewriterEffectHTML } from '../../../../../clients/web/assistant/typewriter';
import { INTENT_CONFIG } from '../../../../../domain/intent/intent-config';
/**
 * 消息渲染器
 * 实现 IMessageRenderer 接口，渲染消息到 UI
 */
export class AssistantRenderer implements IMessageRenderer {
  /**
   * 基于当前 URL 解析相对路径为绝对路径
   */
  private resolvePath(relativePath: string): string {
    // 如果已经是完整 URL（http:// 或 https://），直接返回
    if (relativePath.startsWith('http:') || relativePath.startsWith('https:')) {
      return relativePath;
    }
    const currentBase = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
    const parts = currentBase.split('/').filter(p => p !== '');
    const relParts = relativePath.split('/');
    for (const part of relParts) {
      if (part === '..') parts.pop();
      else if (part !== '.' && part !== '') parts.push(part);
    }
    return '/' + parts.join('/');
  }
  async renderMessage(
    text: string,
    isUser: boolean,
    intent?: string | null,
    entities?: Record<string, any> | null,
    actionUrl?: string,
    actionText?: string,
    useTypewriter: boolean = true,
    taskId?: string
  ): Promise<void> {
    const chatContainer = document.getElementById('chatContainer');
    if (!chatContainer) return;
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user' : 'assistant'}`;
    
    // 如果提供了 taskId，设置 data-task-id 属性
    if (taskId) {
      messageDiv.setAttribute('data-task-id', taskId);
    }
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    if (intent && !isUser) {
      const badge = document.createElement('span');
      badge.className = 'intent-badge';
      badge.textContent = INTENT_CONFIG[intent]?.name || intent;
      contentDiv.appendChild(badge);
    }
    if (entities && Object.keys(entities).length > 0) {
      const entityDiv = document.createElement('div');
      entityDiv.className = 'entity-list';
      entityDiv.innerHTML = '<strong>识别参数：</strong>';
      for (const [key, value] of Object.entries(entities)) {
        // 跳过 text 参数（用于周期性任务，不需要显示）
        if (key === 'text') continue;
        
        const item = document.createElement('div');
        item.className = 'entity-item';
        // 检查是否是URL，如果是则缩短显示
        const displayValue = this.formatEntityValue(key, value);
        item.innerHTML = `<strong>${key}:</strong> ${displayValue}`;
        entityDiv.appendChild(item);
      }
      // 如果只有 text 参数，不显示识别参数
      if (entityDiv.children.length > 1) {
        contentDiv.appendChild(entityDiv);
      }
    }
    messageDiv.appendChild(contentDiv);
    chatContainer.appendChild(messageDiv);
    
    // 滚动到新消息（使用 scrollIntoView 确保 scroll-margin-bottom 生效）
    messageDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
    if (!isUser) {
      await this.renderMarkdownContent(contentDiv, text, useTypewriter);
      // 渲染完成后美化内容（URL 卡片、SGF 卡片）
      this.beautifyContent(contentDiv);
      // 渲染完成后处理 taskId 链接
      this.processTaskIdLinks(contentDiv);
      // 处理 schedule delete 链接
      this.processScheduleDeleteLinks(contentDiv);
    } else {
      // 用户消息：美化 URL 和 SGF，普通文本截断
      this.renderUserMessage(contentDiv, text);
      // 用户消息也可能包含 taskId
      this.processTaskIdLinks(contentDiv);
    }
    if (actionUrl && actionText) {
      const actionBtn = document.createElement('a');
      actionBtn.className = 'action-btn';
      actionBtn.href = this.resolvePath(actionUrl);
      actionBtn.textContent = actionText;
      contentDiv.appendChild(actionBtn);
    }
  }
  /**
   * 美化 AI 消息中的 URL 和 SGF 内容
   * 在 markdown 渲染完成后，遍历 DOM 进行后处理
   */
  private beautifyContent(container: Element): void {
    // 1. 处理 <a> 标签：将独立 URL 链接转为卡片
    this.beautifyLinks(container);
    // 2. 处理 <code> / <pre> 中的 SGF 数据
    this.beautifySgfBlocks(container);
    // 3. 处理纯文本中的裸 URL - 已由 beautifyLinks 覆盖，行内链接保留 <a> 标签即可
  }

  /**
   * 将 markdown 渲染后的独立 <a> 标签转为 URL 卡片
   * 仅处理独占一行的链接（前后无其他文本）
   */
  private beautifyLinks(container: Element): void {
    const links = container.querySelectorAll<HTMLAnchorElement>('.markdown-content a');
    
    links.forEach(link => {
      const href = link.getAttribute('href') || '';
      if (!href || !href.startsWith('http')) return;
      
      // 跳过已有特殊处理的链接（taskId、schedule 等）
      if (href.startsWith('javascript:') || href.startsWith('schedule-')) return;
      
      // 只处理独占一行的链接：链接文本等于 href，或父元素只有这一个子节点
      const parent = link.parentElement;
      if (!parent) return;
      
      const isStandaloneLink = (
        (link.textContent?.trim() === href) ||
        (parent.tagName === 'P' && parent.childNodes.length === 1) ||
        (parent.childNodes.length === 1 && parent.textContent?.trim() === link.textContent?.trim())
      );
      
      if (!isStandaloneLink) return;
      
      // 创建 URL 卡片
      const card = document.createElement('div');
      card.className = 'url-card';
      card.innerHTML = `
        <div class="url-card-header"><span class="url-label">🔗 链接</span><button class="copy-btn" data-copy="${this.escapeHtml(href)}">复制</button></div>
        <div class="url-card-body"><a href="${this.escapeHtml(href)}" target="_blank">${this.escapeHtml(href)}</a></div>
      `;
      
      // 替换父元素（<p> 包裹的链接）或链接本身
      if (parent.tagName === 'P' && parent.parentElement?.classList.contains('markdown-content')) {
        parent.replaceWith(card);
      } else {
        link.replaceWith(card);
      }
    });
    
    // 绑定复制按钮
    this.bindCopyButtons(container);
  }

  /**
   * 处理 <code>/<pre> 中的 SGF 数据，转为 SGF 卡片
   */
  private beautifySgfBlocks(container: Element): void {
    const codeBlocks = container.querySelectorAll<HTMLElement>('.markdown-content pre code, .markdown-content code');
    
    codeBlocks.forEach(codeEl => {
      const text = codeEl.textContent || '';
      if (!this.isSgfContent(text)) return;
      
      // 去掉换行符，紧凑显示
      const compactText = text.replace(/\r?\n/g, '');
      const card = document.createElement('div');
      card.className = 'sgf-card';
      card.innerHTML = `
        <div class="sgf-card-header">
          <span class="sgf-label">♟ SGF 棋谱数据</span>
          <button class="copy-btn" data-copy="${this.escapeHtml(text)}">复制</button>
        </div>
        <div class="sgf-card-body">${this.escapeHtml(compactText)}</div>
      `;
      
      // 如果是 <pre><code> 结构，替换 <pre>
      const pre = codeEl.closest('pre');
      if (pre) {
        pre.replaceWith(card);
      } else {
        codeEl.replaceWith(card);
      }
    });
    
    this.bindCopyButtons(container);
  }

  /**
   * 处理纯文本中的裸 URL（未被 markdown 解析为链接的）
   */
  /**
   * 渲染用户消息，美化 URL 和 SGF
   */
  private renderUserMessage(contentDiv: HTMLElement, text: string): void {
    const MAX_DISPLAY_LENGTH = 200;
    
    // 1. 尝试从文本中提取 SGF 片段
    const sgfMatch = text.match(/\(\s*;/);
    
    if (sgfMatch && sgfMatch.index !== undefined) {
      const sgfStart = sgfMatch.index;
      const beforeText = text.substring(0, sgfStart).trim();
      
      // 用括号匹配找到 SGF 结束位置
      let sgfEnd = text.length;
      let depth = 0;
      for (let i = sgfStart; i < text.length; i++) {
        if (text[i] === '(') depth++;
        if (text[i] === ')') {
          depth--;
          if (depth === 0) { sgfEnd = i + 1; break; }
        }
      }
      
      const sgfText = text.substring(sgfStart, sgfEnd);
      const afterText = text.substring(sgfEnd).trim();
      
      // SGF 前面的文本
      if (beforeText) {
        const displayBefore = beforeText.length > MAX_DISPLAY_LENGTH
          ? beforeText.substring(0, MAX_DISPLAY_LENGTH) + '...' : beforeText;
        contentDiv.appendChild(document.createTextNode(displayBefore));
      }
      
      // SGF 卡片
      const compactSgf = sgfText.replace(/\r?\n/g, '');
      const displaySgf = compactSgf.length > MAX_DISPLAY_LENGTH
        ? compactSgf.substring(0, MAX_DISPLAY_LENGTH) + '...' : compactSgf;
      const card = document.createElement('div');
      card.className = 'sgf-card';
      card.innerHTML = `
        <div class="sgf-card-header">
          <span class="sgf-label">♟ SGF 棋谱数据</span>
          <button class="copy-btn" data-copy="${this.escapeHtml(sgfText)}">复制</button>
        </div>
        <div class="sgf-card-body">${this.escapeHtml(displaySgf)}</div>
      `;
      contentDiv.appendChild(card);
      
      // SGF 后面的文本
      if (afterText) {
        const displayAfter = afterText.length > MAX_DISPLAY_LENGTH
          ? afterText.substring(0, MAX_DISPLAY_LENGTH) + '...' : afterText;
        contentDiv.appendChild(document.createTextNode(displayAfter));
      }
      
      this.bindCopyButtons(contentDiv);
      return;
    }
    
    // 2. 检测是否包含 URL
    const urlPattern = /https?:\/\/[^\s]+/g;
    const urls = text.match(urlPattern);
    
    if (urls && urls.length > 0) {
      const parts: Array<{type: 'text' | 'url', value: string}> = [];
      let lastIndex = 0;
      urlPattern.lastIndex = 0;
      const matches = text.matchAll(urlPattern);
      
      for (const match of matches) {
        if (match.index !== undefined && match.index > lastIndex) {
          parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
        }
        parts.push({ type: 'url', value: match[0] });
        lastIndex = match.index !== undefined ? match.index + match[0].length : lastIndex;
      }
      if (lastIndex < text.length) {
        parts.push({ type: 'text', value: text.slice(lastIndex) });
      }
      
      for (const part of parts) {
        if (part.type === 'url') {
          const card = document.createElement('div');
          card.className = 'url-card';
          card.innerHTML = `
            <div class="url-card-header"><span class="url-label">🔗 链接</span><button class="copy-btn" data-copy="${this.escapeHtml(part.value)}">复制</button></div>
            <div class="url-card-body"><a href="${this.escapeHtml(part.value)}" target="_blank">${this.escapeHtml(part.value)}</a></div>
          `;
          contentDiv.appendChild(card);
        } else {
          const textContent = part.value.length > MAX_DISPLAY_LENGTH
            ? part.value.substring(0, MAX_DISPLAY_LENGTH) + '...'
            : part.value;
          contentDiv.appendChild(document.createTextNode(textContent));
        }
      }
      this.bindCopyButtons(contentDiv);
      return;
    }
    
    // 3. 普通文本
    const displayText = text.length > MAX_DISPLAY_LENGTH
      ? text.substring(0, MAX_DISPLAY_LENGTH) + '...'
      : text;
    contentDiv.appendChild(document.createTextNode(displayText));
  }

  /**
   * 检测文本是否为 SGF 内容
   */
  private isSgfContent(text: string): boolean {
    const trimmed = text.trim();
    // SGF 以 ( 开头，包含 ;GM[ 或 ;B[ 或 ;W[ 等围棋属性标记
    if (!trimmed.startsWith('(') || trimmed.length <= 10) return false;
    return /;(?:GM|FF|CA|SZ|PB|PW|B|W|RE|KM)\[/.test(trimmed);
  }

  /**
   * 绑定复制按钮点击事件
   */
  private bindCopyButtons(container: Element): void {
    const buttons = container.querySelectorAll<HTMLButtonElement>('.copy-btn:not([data-bound])');
    buttons.forEach(btn => {
      btn.setAttribute('data-bound', 'true');
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const textToCopy = btn.getAttribute('data-copy') || '';
        try {
          await navigator.clipboard.writeText(textToCopy);
          btn.textContent = '已复制';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = '复制';
            btn.classList.remove('copied');
          }, 2000);
        } catch {
          // fallback: textarea + execCommand
          const textarea = document.createElement('textarea');
          textarea.value = textToCopy;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          btn.textContent = '已复制';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = '复制';
            btn.classList.remove('copied');
          }, 2000);
        }
      });
    });
  }

  /**
   * HTML 转义
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private async renderMarkdownContent(
    contentDiv: HTMLElement,
    text: string,
    useTypewriter: boolean
  ): Promise<void> {
    try {
      const { marked } = await import('marked');
      // 配置 marked 正确处理换行
      marked.setOptions({
        breaks: true,
        gfm: true,
      });
      
      const htmlContent = await marked.parse(text);
      const textDiv = document.createElement('div');
      textDiv.className = 'markdown-content';
      contentDiv.appendChild(textDiv);
      
      if (useTypewriter) {
        await typewriterEffectHTML(textDiv, htmlContent, { speed: 30 });
      } else {
        textDiv.innerHTML = htmlContent;
      }
      
      // 注意：不在 renderMarkdownContent 中处理 taskId 链接
      // 因为打字机效果是异步的，处理时机不对
      // taskId 链接处理移到 renderMessage 方法中
    } catch (error) {
      contentDiv.appendChild(document.createTextNode(text));
    }
  }
  
    // 处理 taskId 链接（渲染后处理）
  private processTaskIdLinks(container: HTMLElement): void {
    
    // 遍历所有文本节点，将 taskId 转换为可点击链接
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null
    );
    
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }
    
    // 处理每个文本节点
    textNodes.forEach(textNode => {
      const text = textNode.textContent || '';
      // UUID 格式包含 0-9 和 a-f
      const taskIdPattern = /task_\d+_[0-9a-f]+/g;
      
      if (taskIdPattern.test(text)) {
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        // 重置正则表达式的 lastIndex
        taskIdPattern.lastIndex = 0;
        const matches = text.matchAll(taskIdPattern);
        
        for (const match of matches) {
          // 添加前面的文本
          if (match.index !== undefined && match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
          }
          
          // 添加 taskId 链接
          const link = document.createElement('a');
          link.href = 'javascript:void(0)';
          link.className = 'task-id-link';
          link.setAttribute('data-task-id', match[0]);
          link.textContent = match[0];
          link.style.cssText = 'color: #667eea; cursor: pointer; text-decoration: underline;';
          
          link.addEventListener('click', (e) => {
            e.preventDefault();
            const taskId = (e.target as HTMLElement).getAttribute('data-task-id');
            if (taskId) {
              this.handleTaskIdClick(taskId);
            }
          });
          
          fragment.appendChild(link);
          lastIndex = match.index !== undefined ? match.index + match[0].length : lastIndex;
        }
        
        // 添加剩余文本
        if (lastIndex < text.length) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
        }
        
        // 替换原节点
        textNode.parentNode?.replaceChild(fragment, textNode);
      }
    });
  }

  /**
   * 处理 schedule delete 链接
   * 检测 href 以 "schedule-delete:" 开头的链接，点击后直接发送删除指令
   */
  private processScheduleDeleteLinks(container: HTMLElement): void {
    // 处理 schedule-run: 链接
    const runLinks = container.querySelectorAll<HTMLAnchorElement>('a[href^="schedule-run:"]');
    runLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;
      
      const scheduleId = href.replace('schedule-run:', '');
      
      link.setAttribute('href', 'javascript:void(0)');
      link.style.color = '#4caf50';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof (window as any).quickSend === 'function') {
          (window as any).quickSend(`/schedule run ${scheduleId}`);
        }
      });
    });
    
    // 处理 schedule-delete: 链接
    const links = container.querySelectorAll<HTMLAnchorElement>('a[href^="schedule-delete:"]');
    
    links.forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;
      
      const scheduleId = href.replace('schedule-delete:', '');
      
      link.setAttribute('href', 'javascript:void(0)');
      link.style.color = '#f44336';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof (window as any).quickSend === 'function') {
          (window as any).quickSend(`/schedule delete ${scheduleId}`);
        }
      });
    });
    
    // 处理 schedule-result: 链接
    const resultLinks = container.querySelectorAll<HTMLAnchorElement>('a[href^="schedule-result:"]');
    resultLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;
      
      const scheduleId = href.replace('schedule-result:', '');
      
      link.setAttribute('href', 'javascript:void(0)');
      link.style.color = '#667eea';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof (window as any).quickSend === 'function') {
          (window as any).quickSend(`/schedule result ${scheduleId}`);
        }
      });
    });
    
    // 处理 store-clear: 链接
    const storeClearLinks = container.querySelectorAll<HTMLAnchorElement>('a[href^="store-clear:"]');
    storeClearLinks.forEach(link => {
      link.setAttribute('href', 'javascript:void(0)');
      link.style.color = '#f44336';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof (window as any).quickSend === 'function') {
          (window as any).quickSend('/store clear');
        }
      });
    });
  }

  showTyping(): void {
    const chatContainer = document.getElementById('chatContainer');
    if (!chatContainer) return;
    const typingDiv = document.createElement('div');
    typingDiv.id = 'typingIndicator';
    typingDiv.className = 'typing-indicator';
    typingDiv.innerHTML = `
      <div class="message-avatar">🤖</div>
      <div class="typing-dots">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    `;
    chatContainer.appendChild(typingDiv);
    typingDiv.style.display = 'flex';
    typingDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
  hideTyping(): void {
    const typingDiv = document.getElementById('typingIndicator');
    if (typingDiv) {
      typingDiv.remove();
    }
  }
  clearMessages(): void {
    const chatContainer = document.getElementById('chatContainer');
    if (chatContainer) {
      // 保留状态提示
      const status = chatContainer.querySelector('.status');
      chatContainer.innerHTML = '';
      if (status) {
        chatContainer.appendChild(status);
      }
    }
  }
  /**
   * 格式化实体值
   * 如果是URL，缩短显示并转为链接
   * 如果是长文本（如 SGF、URL、文本），截断显示
   */
  private formatEntityValue(key: string, value: any): string {
    if (typeof value !== 'string') {
      return String(value);
    }
    
    // 统一处理所有长参数值（手机屏幕宽度有限）
    const MAX_DISPLAY_LENGTH = 30;
    
    // 检查是否是URL
    if (this.isUrl(value)) {
      const displayText = this.shortenUrl(value);
      return `<a href="${value}" target="_blank" style="color: #667eea; text-decoration: none;">${displayText}</a>`;
    }
    
    // 截断长文本
    if (value.length > MAX_DISPLAY_LENGTH) {
      return value.substring(0, MAX_DISPLAY_LENGTH) + '...';
    }
    
    return value;
  }
  /**
   * 检查是否是URL
   */
  private isUrl(text: string): boolean {
    return text.startsWith('http://') || text.startsWith('https://');
  }
  /**
   * 缩短URL显示
   */
  private shortenUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;
      const path = urlObj.pathname;
      // 如果路径很短，显示完整路径
      if (path.length <= 20) {
        return `${domain}${path}`;
      }
      // 否则截断路径
      return `${domain}${path.substring(0, 15)}...`;
    } catch {
      // 解析失败，返回原始URL（如果太长则截断）
      if (url.length <= 30) {
        return url;
      }
      return url.substring(0, 25) + '...';
    }
  }
  
  /**
   * 格式化用户消息（限制显示长度）
   */
  private formatUserMessage(text: string): string {
    const MAX_DISPLAY_LENGTH = 200;  // 用户消息最大显示长度
    
    if (text.length > MAX_DISPLAY_LENGTH) {
      return text.substring(0, MAX_DISPLAY_LENGTH) + '...';
    }
    
    return text;
  }
  
  /**
   * 同步消息内容到视图（DOM）
   * 
   * 用于定时器将聊天记录中的内容同步到视图层
   * 
   * @param taskId 任务 ID
   * @param content 消息内容（markdown 格式）
   */
  syncMessageContent(taskId: string, content: string): void {
    const messageBlock = document.querySelector(`.message.assistant[data-task-id="${taskId}"]`);
    
    if (!messageBlock) {
      // DOM 节点不存在，可能还没渲染好，下次重试
      return;
    }
    
    const contentDiv = messageBlock.querySelector('.message-content');
    if (!contentDiv) {
      return;
    }
    
    // 检查是否需要更新：比较存储的 markdown 内容
    const currentMarkdown = contentDiv.getAttribute('data-markdown-content');
    if (currentMarkdown === content) {
      // 内容相同，不需要更新
      return;
    }
    
    // 保留意图徽章和参数列表
    const intentBadge = contentDiv.querySelector('.intent-badge');
    const entityList = contentDiv.querySelector('.entity-list');
    
    // 重新构造消息内容
    let newContent = '';
    
    if (intentBadge) {
      newContent += `<span class="intent-badge">${intentBadge.textContent || ''}</span>`;
    }
    
    if (entityList) {
      newContent += entityList.outerHTML;
    }
    
    // 添加新的内容
    newContent += `<div class="markdown-content"></div>`;
    
    // 更新 DOM
    contentDiv.innerHTML = newContent;
    
    // 存储 markdown 内容，用于下次比较
    contentDiv.setAttribute('data-markdown-content', content);
    
    // 渲染 markdown 内容
    const markdownDiv = contentDiv.querySelector('.markdown-content');
    if (markdownDiv) {
      import('marked').then(async ({ marked }) => {
        marked.setOptions({
          breaks: true,
          gfm: true,
        });
        
        markdownDiv.innerHTML = await marked.parse(content);
        
        // 美化内容
        this.beautifyContent(contentDiv);
        
        // 滚动到消息块
        messageBlock.scrollIntoView({ behavior: 'smooth', block: 'end' });
      });
    }
  }
  
  /**
   * 处理 taskId 点击事件
   */
  private handleTaskIdClick(taskId: string): void {
    // 触发自定义事件，让 AssistantUseCase 处理
    const event = new CustomEvent('taskIdClick', { 
      detail: { taskId },
      bubbles: true 
    });
    document.dispatchEvent(event);
  }
  
  /**
   * 处理取消任务点击事件
   */
  private handleCancelTaskClick(taskId: string): void {
    // 触发自定义事件，让 AssistantUseCase 处理
    const event = new CustomEvent('cancelTaskClick', { 
      detail: { taskId },
      bubbles: true 
    });
    document.dispatchEvent(event);
  }
  
  /**
   * 添加取消任务按钮
   */
  public addCancelButton(taskId: string): void {
    const chatContainer = document.getElementById('chatContainer');
    if (!chatContainer) return;
    
    const lastMessage = chatContainer.lastElementChild as HTMLElement;
    if (!lastMessage) return;
    
    const contentDiv = lastMessage.querySelector('.message-content');
    if (!contentDiv) return;
    
    const cancelButton = document.createElement('button');
    cancelButton.className = 'cancel-task-btn';
    cancelButton.textContent = '取消任务';
    cancelButton.setAttribute('data-task-id', taskId);
    cancelButton.style.cssText = 'margin-top: 12px; padding: 8px 16px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;';
    
    cancelButton.addEventListener('click', (e) => {
      e.preventDefault();
      const taskId = (e.target as HTMLElement).getAttribute('data-task-id');
      if (taskId) {
        this.handleCancelTaskClick(taskId);
      }
    });
    
    contentDiv.appendChild(cancelButton);
  }
  showCountdownJump(jumpUrl: string, countdown: number, onCancel: () => void): void {
    const countdownDiv = document.createElement('div');
    countdownDiv.className = 'countdown-banner';
    countdownDiv.style.cssText = 'background: #f0f0f0; padding: 12px; border-radius: 8px; margin-top: 10px; border: 1px solid #e0e0e0;';
    countdownDiv.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; white-space: nowrap;">
        <span style="color: #666; font-size: 13px;">
          <span id="countdownNumber" style="color: #667eea; font-weight: 600;">${countdown}</span> 秒后自动跳转
        </span>
        <button id="cancelBtn" style="background: transparent; border: none; cursor: pointer; font-size: 16px; padding: 0; line-height: 1;" title="取消">❌</button>
      </div>
    `;
    const chatContainer = document.getElementById('chatContainer');
    if (chatContainer) {
      const lastMessage = chatContainer.lastElementChild as HTMLElement;
      if (lastMessage) {
        lastMessage.querySelector('.message-content')?.appendChild(countdownDiv);
        lastMessage.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }
    let cancelled = false;
    const countdownInterval = setInterval(() => {
      countdown--;
      const countdownNumber = document.getElementById('countdownNumber');
      if (countdownNumber) {
        countdownNumber.textContent = String(countdown);
      }
      if (countdown <= 0 && !cancelled) {
        clearInterval(countdownInterval);
        countdownDiv.remove(); // 跳转前删除提示栏
        window.location.href = this.resolvePath(jumpUrl);
      }
    }, 1000);
    const cancelBtn = document.getElementById('cancelBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        cancelled = true;
        clearInterval(countdownInterval);
        countdownDiv.remove();
        onCancel();
      });
    }
  }
}
