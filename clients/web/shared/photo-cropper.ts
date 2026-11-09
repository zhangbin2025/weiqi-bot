/**
 * 拍照摆子：棋盘四角点选器
 * @module clients/web/shared/photo-cropper
 *
 * 新方案（Plan C）：用户手动点棋盘四个角 → 透视校正 → CNN 识别。
 * 不再用矩形框裁剪，而是直接选四角 [TL,TR,BR,BL]，
 * 与 weiqi-photo `unitFromQuad` 的契约一致。
 *
 * 设计要点：
 *  - **四角可拖拽** —— 默认在画布四角附近放初始四角，用户拖到棋盘角。
 *  - **只用单指** —— 页面注入的 no-zoom.js 在捕获阶段吞掉多指触摸。
 *  - **四角顺序 [TL,TR,BR,BL]** —— cyclic，与库一致。
 *  - **内部状态用 canvas 像素** —— CSS 像素只用于渲染。
 */

import { MIN_CROP_SIDE, type CropRect } from '../../../services/photo';
import type { Quad } from '@weiqi/photo';

/** 注入的样式表 id（幂等，多次打开只注入一次） */
const STYLE_ID = 'photo-cropper-style';

/** 手柄热区边长（CSS px） */
const HANDLE_HIT = 48;

/** 默认四角内缩比例（不做 0/0 → 角太靠边不好拖） */
const INSET_RATIO = 0.08;

export interface PhotoCropperOptions {
  /**
   * 初始四角（canvas 像素坐标系）；null 表示用默认内缩四角。
   * 「重新框选」时传入上一次的四角，用户从原位微调。
   */
  initial: Quad | null;
}

const CSS = `
.pc-root {
  position: fixed;
  inset: 0;
  z-index: 2600;
  background: #0b0b0d;
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}
.pc-root[hidden] { display: none; }

.pc-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: none;
}

.pc-img {
  display: block;
  max-width: 100%;
  max-height: 100%;
}

.pc-poly {
  position: absolute;
  pointer-events: none;
  width: 100%;
  height: 100%;
  left: 0;
  top: 0;
}

.pc-handle {
  position: absolute;
  width: ${HANDLE_HIT}px;
  height: ${HANDLE_HIT}px;
  touch-action: none;
  pointer-events: auto;
}

.pc-handle::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  border: 3px solid #667eea;
  box-shadow: 0 1px 6px rgba(0,0,0,0.6);
}

.pc-handle[data-h="0"]::before { border-color: #FF8A1F; } /* TL 橙 */
.pc-handle[data-h="1"]::before { border-color: #4ecdc4; } /* TR 青 */
.pc-handle[data-h="2"]::before { border-color: #ff6b6b; } /* BR 红 */
.pc-handle[data-h="3"]::before { border-color: #51cf66; } /* BL 绿 */

.pc-bar {
  flex-shrink: 0;
  padding: 10px 14px;
  padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
  background: #15151a;
  display: flex;
  align-items: center;
  gap: 10px;
}

.pc-hint {
  flex: 1;
  min-width: 0;
  color: #aaa;
  font-size: 12.5px;
  line-height: 1.45;
}

.pc-btn {
  flex-shrink: 0;
  padding: 10px 14px;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  cursor: pointer;
  background: #2a2a33;
  color: #ddd;
}

.pc-btn:active { opacity: 0.75; }

.pc-btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  font-weight: 600;
}
`;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * 默认四角：画布四角内缩 INSET_RATIO。
 * 不贴 0/0 → 角点好拖。
 */
function defaultQuad(w: number, h: number): Quad {
  const dx = w * INSET_RATIO;
  const dy = h * INSET_RATIO;
  return [
    { x: dx, y: dy },             // TL
    { x: w - dx, y: dy },        // TR
    { x: w - dx, y: h - dy },    // BR
    { x: dx, y: h - dy },        // BL
  ];
}

/** 把四角钳到画布内 */
function sanitize(q: Quad, w: number, h: number): Quad {
  return q.map((p) => ({
    x: clamp(Math.round(p.x), 0, w),
    y: clamp(Math.round(p.y), 0, h),
  })) as unknown as Quad;
}

/** 检查四角围成的区域是否足够大 */
function isLargeEnough(q: Quad): boolean {
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  return Math.min(w, h) >= MIN_CROP_SIDE;
}

/**
 * 打开四角点选浮层。
 *
 * @param canvas 整图（loadPhotoCanvas 的产物）；结束后会原样归还，不修改内容
 * @param opts 选项
 * @returns 用户确认的四角（canvas 像素坐标系，[TL,TR,BR,BL]）；取消/关闭返回 null
 */
export function openPhotoCropper(
  canvas: HTMLCanvasElement,
  opts: PhotoCropperOptions,
): Promise<Quad | null> {
  ensureStyle();

  return new Promise<Quad | null>((resolve) => {
    const CW = canvas.width;
    const CH = canvas.height;

    const root = document.createElement('div');
    root.className = 'pc-root';

    const stage = document.createElement('div');
    stage.className = 'pc-stage';

    // SVG for the polygon outline
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('pc-poly');
    svg.style.overflow = 'visible';

    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('fill', 'rgba(0,0,0,0.45)');
    poly.setAttribute('stroke', '#fff');
    poly.setAttribute('stroke-width', '2');
    poly.setAttribute('stroke-dasharray', '6 4');
    poly.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(poly);
    stage.appendChild(svg);

    // Handles (children of stage)
    const handles: HTMLElement[] = [];
    const LABELS = ['左上', '右上', '右下', '左下'];
    for (let i = 0; i < 4; i++) {
      const hd = document.createElement('div');
      hd.className = 'pc-handle';
      hd.dataset.h = String(i);
      hd.title = LABELS[i];
      stage.appendChild(hd);
      handles.push(hd);
    }

    // ⚠️ canvas 先入 DOM，svg/handles 后入
    canvas.classList.add('pc-img');
    stage.appendChild(canvas);
    stage.appendChild(svg);
    for (const hd of handles) stage.appendChild(hd);

    const bar = document.createElement('div');
    bar.className = 'pc-bar';

    const hint = document.createElement('div');
    hint.className = 'pc-hint';
    hint.textContent = '拖动四个圆点到棋盘四角（橙=左上 青=右上 红=右下 绿=左下）';

    const resetBtn = document.createElement('button');
    resetBtn.className = 'pc-btn';
    resetBtn.type = 'button';
    resetBtn.textContent = '重置';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'pc-btn';
    cancelBtn.type = 'button';
    cancelBtn.textContent = '取消';

    const okBtn = document.createElement('button');
    okBtn.className = 'pc-btn pc-btn-primary';
    okBtn.type = 'button';
    okBtn.textContent = '识别';

    bar.append(hint, resetBtn, cancelBtn, okBtn);
    root.append(stage, bar);
    document.body.appendChild(root);

    // ---- 状态 ----
    let Q: Quad = sanitize(opts.initial ?? defaultQuad(CW, CH), CW, CH);
    let settled = false;

    /** 图片实际渲染矩形（相对 stage） */
    function frame(): { left: number; top: number; w: number; h: number } | null {
      const sr = stage.getBoundingClientRect();
      const ir = canvas.getBoundingClientRect();
      if (ir.width <= 0 || ir.height <= 0) return null;
      return { left: ir.left - sr.left, top: ir.top - sr.top, w: ir.width, h: ir.height };
    }

    function applyQuad(): void {
      const f = frame();
      if (!f) {
        requestAnimationFrame(applyQuad);
        return;
      }
      const sx = f.w / CW;
      const sy = f.h / CH;

      // Update polygon points
      const pts = Q.map((p) => `${f.left + p.x * sx},${f.top + p.y * sy}`).join(' ');
      poly.setAttribute('points', pts);

      // Update handle positions
      for (let i = 0; i < 4; i++) {
        const hd = handles[i];
        if (!hd) continue;
        hd.style.left = (f.left + Q[i].x * sx) + 'px';
        hd.style.top = (f.top + Q[i].y * sy) + 'px';
        hd.style.transform = 'translate(-50%, -50%)';
      }
    }

    // ---- 拖动 ----
    let dragIdx: number | null = null;
    let startX = 0;
    let startY = 0;
    let Q0: Quad = Q;

    function onDown(e: PointerEvent): void {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement | null;
      const idx = t?.dataset.h ? Number(t.dataset.h) : null;
      if (idx === null || isNaN(idx)) return;
      dragIdx = idx;
      startX = e.clientX;
      startY = e.clientY;
      Q0 = Q.map((p) => ({ ...p })) as unknown as Quad;
      e.preventDefault();
    }

    function onMove(e: PointerEvent): void {
      if (dragIdx === null) return;
      const f = frame();
      if (!f) return;
      const dx = (e.clientX - startX) * (CW / f.w);
      const dy = (e.clientY - startY) * (CH / f.h);
      const np = { x: clamp(Q0[dragIdx].x + dx, 0, CW), y: clamp(Q0[dragIdx].y + dy, 0, CH) };
      Q = Q.map((p, i) => i === dragIdx ? np : p) as unknown as Quad;
      applyQuad();
    }

    function onUp(): void {
      dragIdx = null;
    }

    // Attach drag listeners to stage (handles are children of stage)
    stage.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    function onResize(): void { applyQuad(); }
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    // ---- 关闭 ----
    function close(result: Quad | null): void {
      if (settled) return;
      settled = true;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.removeEventListener('keydown', onKey);
      canvas.classList.remove('pc-img');
      root.remove();
      resolve(result);
    }

    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') close(null);
    }
    window.addEventListener('keydown', onKey);

    resetBtn.addEventListener('click', () => {
      Q = sanitize(defaultQuad(CW, CH), CW, CH);
      applyQuad();
    });
    cancelBtn.addEventListener('click', () => close(null));
    okBtn.addEventListener('click', () => {
      if (!isLargeEnough(Q)) {
        hint.style.color = '#ff6b6b';
        hint.textContent = '范围太小，请把四角拉开到棋盘四角';
        return;
      }
      close(Q);
    });

    requestAnimationFrame(applyQuad);
  });
}