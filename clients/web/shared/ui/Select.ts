/**
 * Select - 自绘下拉框
 *
 * 完全脱离原生 <select> 标签。DOM 中只有自绘的 <div class="ui-select">。
 *
 * HTML 写法：
 *   <div data-ui="select"
 *        id="limitSelect"
 *        data-options='[{"value":"10","label":"最近 10 盘"},{"value":"20","label":"最近 20 盘"}]'
 *        data-value="10"></div>
 *
 * TS 使用：
 *   const inst = Select.get('#limitSelect');     // 取已挂载实例
 *   inst.getValue();                              // '10'
 *   inst.setValue('20');                          // 程序化设置（会触发 onChange）
 *   inst.onChange((v) => console.log(v));         // 监听
 *
 * 也可动态创建：
 *   const inst = Select.mount(el, {
 *     options: [{value:'a',label:'A'}],
 *     value: 'a',
 *     placeholder: '请选择',
 *     onChange: (v) => ...,
 *   });
 *
 * 一键扫描：
 *   Select.mountAll();   // 扫描 [data-ui="select"]
 */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectOptions {
  options?: SelectOption[];
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  onChange?: (value: string, option: SelectOption | null) => void;
}

export interface SelectInstance {
  getValue(): string;
  getOption(): SelectOption | null;
  setValue(value: string, silent?: boolean): void;
  setOptions(options: SelectOption[]): void;
  setDisabled(disabled: boolean): void;
  onChange(fn: (value: string, option: SelectOption | null) => void): () => void;
  destroy(): void;
  readonly el: HTMLElement;
}

const INSTANCE_KEY = '__uiSelectInstance';

interface RootWithInstance extends HTMLElement {
  [INSTANCE_KEY]?: SelectInstance;
}

function parseInitial(el: HTMLElement): SelectOptions {
  const opts: SelectOptions = {};
  const raw = el.getAttribute('data-options');
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as SelectOption[];
      if (Array.isArray(parsed)) opts.options = parsed;
    } catch (e) {
      console.warn('[ui-select] invalid data-options JSON:', raw, e);
    }
  }
  const v = el.getAttribute('data-value');
  if (v !== null) opts.value = v;
  const ph = el.getAttribute('data-placeholder');
  if (ph !== null) opts.placeholder = ph;
  if (el.hasAttribute('data-disabled')) opts.disabled = true;
  return opts;
}

function createInstance(root: HTMLElement, init: SelectOptions): SelectInstance {
  let options: SelectOption[] = init.options ?? [];
  let value: string = init.value ?? '';
  const placeholder: string = init.placeholder ?? '请选择';
  let disabled: boolean = init.disabled ?? false;
  let isOpen = false;
  let activeIndex = -1;
  const listeners: Array<(v: string, o: SelectOption | null) => void> = [];
  if (init.onChange) listeners.push(init.onChange);

  root.classList.add('ui-select');
  root.innerHTML = `
    <button type="button" class="ui-select__trigger" aria-haspopup="listbox" aria-expanded="false">
      <span class="ui-select__label"></span>
      <span class="ui-select__arrow"></span>
    </button>
    <div class="ui-select__panel" role="listbox"></div>
  `;
  const trigger = root.querySelector('.ui-select__trigger') as HTMLButtonElement;
  const labelEl = root.querySelector('.ui-select__label') as HTMLSpanElement;
  const panel = root.querySelector('.ui-select__panel') as HTMLDivElement;

  function currentOption(): SelectOption | null {
    return options.find((o) => o.value === value) ?? null;
  }

  function renderLabel() {
    const opt = currentOption();
    if (opt) {
      labelEl.textContent = opt.label;
      labelEl.classList.remove('ui-select__label--placeholder');
    } else {
      labelEl.textContent = placeholder;
      labelEl.classList.add('ui-select__label--placeholder');
    }
  }

  function renderPanel() {
    panel.innerHTML = '';
    if (options.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ui-select__empty';
      empty.textContent = '无选项';
      panel.appendChild(empty);
      return;
    }
    options.forEach((opt, idx) => {
      const item = document.createElement('div');
      item.className = 'ui-select__option';
      item.setAttribute('role', 'option');
      item.dataset['index'] = String(idx);
      if (opt.disabled) item.classList.add('is-disabled');
      if (opt.value === value) item.classList.add('is-selected');
      if (idx === activeIndex) item.classList.add('is-active');
      item.textContent = opt.label;
      panel.appendChild(item);
    });
  }

  function syncDisabled() {
    if (disabled) {
      root.classList.add('is-disabled');
      trigger.disabled = true;
    } else {
      root.classList.remove('is-disabled');
      trigger.disabled = false;
    }
  }

  function open() {
    if (isOpen || disabled) return;
    isOpen = true;
    root.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    activeIndex = options.findIndex((o) => o.value === value);
    renderPanel();
    
    // 动态定位面板（使用 fixed 定位）
    positionPanel();
    
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', positionPanel, true);
    window.addEventListener('resize', positionPanel);
  }

  function positionPanel() {
    const triggerRect = trigger.getBoundingClientRect();
    const panelHeight = panel.scrollHeight;
    const viewportHeight = window.innerHeight;
    
    // 默认在按钮下方显示
    let top = triggerRect.bottom + 4;
    let left = triggerRect.left;
    
    // 如果下方空间不够，改为上方显示
    if (top + panelHeight > viewportHeight - 20) {
      top = triggerRect.top - panelHeight - 4;
    }
    
    // 确保不超出屏幕左侧
    if (left < 8) left = 8;
    
    // 设置面板宽度和位置
    panel.style.width = `${Math.max(triggerRect.width, 100)}px`;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    root.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('scroll', positionPanel, true);
    window.removeEventListener('resize', positionPanel);
  }

  function emitChange() {
    const opt = currentOption();
    listeners.slice().forEach((fn) => {
      try { fn(value, opt); } catch (e) { console.error('[ui-select] onChange handler error:', e); }
    });
  }

  function selectIndex(idx: number, silent = false) {
    if (idx < 0 || idx >= options.length) return;
    const opt = options[idx];
    if (!opt || opt.disabled) return;
    if (opt.value === value) { close(); return; }
    value = opt.value;
    renderLabel();
    close();
    if (!silent) emitChange();
  }

  function moveActive(delta: number) {
    const n = options.length;
    if (n === 0) return;
    let i = activeIndex;
    for (let step = 0; step < n; step++) {
      i = (i + delta + n) % n;
      if (!options[i]?.disabled) break;
    }
    activeIndex = i;
    renderPanel();
    const node = panel.children[i] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }

  function onTriggerClick(e: MouseEvent) {
    e.preventDefault();
    if (isOpen) close(); else open();
  }

  function onPanelClick(e: MouseEvent) {
    const target = (e.target as HTMLElement).closest('.ui-select__option') as HTMLElement | null;
    if (!target) return;
    const idx = Number(target.dataset['index']);
    selectIndex(idx);
  }

  function onDocDown(e: MouseEvent) {
    if (!root.contains(e.target as Node)) close();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!isOpen) return;
    switch (e.key) {
      case 'Escape': e.preventDefault(); close(); break;
      case 'ArrowDown': e.preventDefault(); moveActive(1); break;
      case 'ArrowUp': e.preventDefault(); moveActive(-1); break;
      case 'Home': e.preventDefault(); activeIndex = -1; moveActive(1); break;
      case 'End':
        e.preventDefault();
        activeIndex = options.length;
        moveActive(-1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (activeIndex >= 0) selectIndex(activeIndex);
        break;
    }
  }

  function onTriggerKeyDown(e: KeyboardEvent) {
    if (isOpen) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  }

  trigger.addEventListener('click', onTriggerClick);
  trigger.addEventListener('keydown', onTriggerKeyDown);
  panel.addEventListener('click', onPanelClick);

  // 初始化
  renderLabel();
  syncDisabled();

  const instance: SelectInstance = {
    el: root,
    getValue() { return value; },
    getOption() { return currentOption(); },
    setValue(v: string, silent = false) {
      const opt = options.find((o) => o.value === v);
      if (!opt) {
        // 允许清空
        if (v === '') {
          if (value === '') return;
          value = '';
          renderLabel();
          if (isOpen) renderPanel();
          if (!silent) emitChange();
        }
        return;
      }
      if (opt.disabled) return;
      if (value === v) return;
      value = v;
      renderLabel();
      if (isOpen) renderPanel();
      if (!silent) emitChange();
    },
    setOptions(next: SelectOption[]) {
      options = next.slice();
      // 当前值不在新选项中则清空
      if (!options.some((o) => o.value === value)) value = '';
      renderLabel();
      if (isOpen) renderPanel();
    },
    setDisabled(d: boolean) {
      disabled = d;
      if (d) close();
      syncDisabled();
    },
    onChange(fn) {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    destroy() {
      close();
      trigger.removeEventListener('click', onTriggerClick);
      trigger.removeEventListener('keydown', onTriggerKeyDown);
      panel.removeEventListener('click', onPanelClick);
      root.classList.remove('ui-select', 'is-open', 'is-disabled');
      root.innerHTML = '';
      delete (root as RootWithInstance)[INSTANCE_KEY];
      listeners.length = 0;
    },
  };
  return instance;
}

function resolveEl(target: HTMLElement | string): HTMLElement | null {
  if (typeof target === 'string') {
    const sel = target.startsWith('#') || target.startsWith('.') || target.startsWith('[')
      ? target
      : `#${target}`;
    return document.querySelector(sel);
  }
  return target;
}

export const Select = {
  /** 挂载一个 Select 到元素。重复挂载安全（返回已有实例）。 */
  mount(target: HTMLElement | string, opts: SelectOptions = {}): SelectInstance | null {
    const el = resolveEl(target) as RootWithInstance | null;
    if (!el) return null;
    const existing = el[INSTANCE_KEY];
    if (existing) {
      if (opts.options) existing.setOptions(opts.options);
      if (opts.value !== undefined) existing.setValue(opts.value, true);
      if (opts.disabled !== undefined) existing.setDisabled(opts.disabled);
      if (opts.onChange) existing.onChange(opts.onChange);
      return existing;
    }
    const merged: SelectOptions = { ...parseInitial(el), ...opts };
    const inst = createInstance(el, merged);
    el[INSTANCE_KEY] = inst;
    return inst;
  },

  /** 获取已挂载实例。 */
  get(target: HTMLElement | string): SelectInstance | null {
    const el = resolveEl(target) as RootWithInstance | null;
    if (!el) return null;
    return el[INSTANCE_KEY] ?? null;
  },

  /** 批量扫描挂载：默认匹配 [data-ui="select"]。 */
  mountAll(root: ParentNode = document, selector = '[data-ui="select"]'): SelectInstance[] {
    const list: SelectInstance[] = [];
    root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      const inst = Select.mount(el);
      if (inst) list.push(inst);
    });
    return list;
  },
};

export default Select;
