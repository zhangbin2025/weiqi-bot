/**
 * 拍照摆子：棋盘范围框选器
 * @module clients/web/shared/photo-cropper
 *
 * 为什么需要这一步：整图直接识别时，weiqi-photo 的粗定位（黑帽 + 连通域 +
 * 凸包 + 最大四边形）会把桌面纹理、书本边、棋盒一起并进凸包，四角外扩，
 * 后面的消失点与周期估计全跟着歪 —— 这是「棋盘边界识别不准」的主因。
 * 先让用户框住棋盘，画面里只剩棋盘 + 少量背景，粗定位基本不会跑偏。
 *
 * 设计要点：
 *  - **只做矩形** —— 四角梯形微调留作后续迭代，矩形的拖拽手感已经能覆盖
 *    「棋盘被拍斜 / 背景太杂」的绝大多数情况。
 *  - **只用单指** —— 页面注入的 no-zoom.js 会在 document 捕获阶段吞掉所有
 *    多指触摸（`e.touches.length > 1` 直接 preventDefault），双指捏合缩放框
 *    会被它吃掉。单指不受影响，所以手柄要做得足够大（44px 热区）。
 *  - **默认框占满短边** —— 拍照习惯是让棋盘撑满画面短边，所以默认框取内接
 *    正方形（边长 = 短边），长边方向留白让用户挪动即可，不必拉拽。
 *    消失点靠长直线交点求，贴边裁会把线切短、交点飘；但用户拍摄时棋盘四周
 *    本来就留有空隙，这个风险由拍摄习惯兜底。
 *  - **内部状态用 canvas 像素** —— CSS 像素只用于渲染，这样最小尺寸限制
 *    （MIN_CROP_SIDE）才是针对真实分辨率的，窗口 resize 也不会让框变形。
 */

import { MIN_CROP_SIDE, type CropRect } from '../../../services/photo';

/** 注入的样式表 id（幂等，多次打开只注入一次） */
const STYLE_ID = 'photo-cropper-style';

/** 手柄热区边长（CSS px）：手指点得中的最小尺寸 */
const HANDLE_HIT = 44;

export interface PhotoCropperOptions {
  /**
   * 初始框（canvas 像素坐标系）；null 表示用默认居中方框。
   * 「重新框选」时传入上一次的框，用户从原位微调，不用从头拖。
   */
  initial: CropRect | null;
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
  /* 拖动框时不要触发页面滚动/缩放 */
  touch-action: none;
}

/* canvas 直接当 <img> 用：replaced element 的 max-width/max-height 会
   等比缩放，省掉一次 toDataURL / toBlob 的重编码（2000px 图，肉眼可见的卡顿） */
.pc-img {
  display: block;
  max-width: 100%;
  max-height: 100%;
}

.pc-box {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid #fff;
  /* 框外的压暗：用超大扩散的 box-shadow 铺满，被 .pc-stage 的 overflow 裁掉。
     比再放四个遮罩 div 简单，也不会挡住指针事件 */
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
  touch-action: none;
}

.pc-handle {
  position: absolute;
  width: ${HANDLE_HIT}px;
  height: ${HANDLE_HIT}px;
  touch-action: none;
}

.pc-handle::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #667eea;
  box-shadow: 0 1px 4px rgba(0,0,0,0.5);
}

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
 * 默认框：内接于画布的最大正方形（边长 = 短边），居中。
 *
 * 为什么不取「短边 82%」再留一圈：拍照时人会本能地让棋盘撑满画面的短边方向
 * （棋盘显得更大、更好判子），所以短边天然就贴着棋盘。取满短边 = 这个方向
 * 大概率已经框对了，用户通常只需沿长边方向挪一下，不用拉拽 —— 少一步操作。
 *
 * 具体到两种画幅：
 *  - 竖屏（w < h）：棋盘撑满画面宽度 → 边长 = w，即「宽度占满，高度等宽」，
 *    用户只需上下移动；
 *  - 横屏（w > h）：棋盘撑满画面高度 → 边长 = h，用户只需左右移动。
 * 长边方向剩下的空间正是要裁掉的桌面/背景，留着反而会干扰粗定位。
 *
 * 棋盘是正方形，所以默认框也必须是正方形 —— 用内接正方形而非「w×w」，
 * 后者在横屏下会被 sanitize 钳成 w×h（等于没裁）。
 */
function defaultRect(w: number, h: number): CropRect {
  const side = Math.round(Math.min(w, h));
  return {
    x: Math.round((w - side) / 2),
    y: Math.round((h - side) / 2),
    w: side,
    h: side,
  };
}

/** 把任意框钳到画布内且不小于 MIN_CROP_SIDE */
function sanitize(r: CropRect, w: number, h: number): CropRect {
  const minW = Math.min(MIN_CROP_SIDE, w);
  const minH = Math.min(MIN_CROP_SIDE, h);
  const rw = clamp(Math.round(r.w), minW, w);
  const rh = clamp(Math.round(r.h), minH, h);
  return {
    x: clamp(Math.round(r.x), 0, w - rw),
    y: clamp(Math.round(r.y), 0, h - rh),
    w: rw,
    h: rh,
  };
}

/**
 * 打开框选浮层。
 *
 * @param canvas 整图（loadPhotoCanvas 的产物）；结束后会原样归还，不修改内容
 * @param opts 选项
 * @returns 用户确认的框（canvas 像素坐标系）；取消/关闭返回 null
 */
export function openPhotoCropper(
  canvas: HTMLCanvasElement,
  opts: PhotoCropperOptions,
): Promise<CropRect | null> {
  ensureStyle();

  return new Promise<CropRect | null>((resolve) => {
    const CW = canvas.width;
    const CH = canvas.height;

    const root = document.createElement('div');
    root.className = 'pc-root';

    const stage = document.createElement('div');
    stage.className = 'pc-stage';

    const box = document.createElement('div');
    box.className = 'pc-box';

    // 手柄：先放边中点，再放四角 —— 四角在后，DOM 顺序决定命中优先级，
    // 小框上 44px 热区必然重叠，此时四角优先更符合直觉
    const EDGES: Array<[string, string, string]> = [
      ['n', '50%', '0'],
      ['s', '50%', '100%'],
      ['w', '0', '50%'],
      ['e', '100%', '50%'],
    ];
    const CORNERS: Array<[string, string, string]> = [
      ['nw', '0', '0'],
      ['ne', '100%', '0'],
      ['sw', '0', '100%'],
      ['se', '100%', '100%'],
    ];
    for (const [id, l, t] of [...EDGES, ...CORNERS]) {
      const hd = document.createElement('div');
      hd.className = 'pc-handle';
      hd.dataset.h = id;
      hd.style.left = l;
      hd.style.top = t;
      hd.style.transform = 'translate(-50%, -50%)';
      box.appendChild(hd);
    }

    // ⚠️ 顺序：canvas 先入 DOM，box 后入 —— box 靠 9999px 扩散的 box-shadow
    //    做框外压暗，若 canvas 压在 box 上面，这层暗化就被盖住了
    canvas.classList.add('pc-img');
    stage.appendChild(canvas);
    stage.appendChild(box);

    const bar = document.createElement('div');
    bar.className = 'pc-bar';

    const hint = document.createElement('div');
    hint.className = 'pc-hint';
    hint.textContent = '上下移动或拖四角，框住整个棋盘，别切到边线';

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
    let R: CropRect = sanitize(opts.initial ?? defaultRect(CW, CH), CW, CH);
    let settled = false;

    /** 图片实际渲染矩形（相对 stage），是 CSS px ↔ canvas px 的换算基准 */
    function frame(): { left: number; top: number; w: number; h: number } | null {
      const sr = stage.getBoundingClientRect();
      const ir = canvas.getBoundingClientRect();
      if (ir.width <= 0 || ir.height <= 0) return null; // 还没布局完
      return { left: ir.left - sr.left, top: ir.top - sr.top, w: ir.width, h: ir.height };
    }

    function applyRect(): void {
      const f = frame();
      if (!f) {
        // 首帧还没量到尺寸（画布刚插入），下一帧再来
        requestAnimationFrame(applyRect);
        return;
      }
      const sx = f.w / CW;
      const sy = f.h / CH;
      box.style.left = f.left + R.x * sx + 'px';
      box.style.top = f.top + R.y * sy + 'px';
      box.style.width = R.w * sx + 'px';
      box.style.height = R.h * sy + 'px';
    }

    // ---- 拖动 ----
    let mode: string | null = null;
    let startX = 0;
    let startY = 0;
    let R0: CropRect = R;

    function onDown(e: PointerEvent): void {
      if (e.button !== 0) return; // 只响应主键（左键/单指）
      const t = e.target as HTMLElement | null;
      mode = t?.dataset.h ?? 'move';
      startX = e.clientX;
      startY = e.clientY;
      R0 = R;
      // 阻止默认：不拦的话浏览器可能启动原生图片拖影（canvas 上方是图片区域），
      // 抢走指针并发 pointercancel，拖动只走一两帧就停
      e.preventDefault();
    }

    function onMove(e: PointerEvent): void {
      if (!mode) return;
      const f = frame();
      if (!f) return;
      // CSS px → canvas px
      const dx = (e.clientX - startX) * (CW / f.w);
      const dy = (e.clientY - startY) * (CH / f.h);
      R = resized(mode, R0, dx, dy);
      applyRect();
    }

    function onUp(): void {
      mode = null;
    }

    const minW = Math.min(MIN_CROP_SIDE, CW);
    const minH = Math.min(MIN_CROP_SIDE, CH);

    /** 按手柄方向重算框；'move' 是整体平移 */
    function resized(m: string, r0: CropRect, dx: number, dy: number): CropRect {
      if (m === 'move') {
        return {
          x: Math.round(clamp(r0.x + dx, 0, CW - r0.w)),
          y: Math.round(clamp(r0.y + dy, 0, CH - r0.h)),
          w: r0.w,
          h: r0.h,
        };
      }
      let { x, y, w, h } = r0;
      // ⚠️ 'nw'.includes('w') 为真 —— 靠子串匹配同时覆盖角与边，
      //    但每条边只写一次：w/e 改 x 或 w，n/s 改 y 或 h，不会互相打架
      if (m.includes('w')) {
        x = clamp(r0.x + dx, 0, r0.x + r0.w - minW);
        w = r0.x + r0.w - x;
      }
      if (m.includes('e')) {
        w = clamp(r0.w + dx, minW, CW - r0.x);
      }
      if (m.includes('n')) {
        y = clamp(r0.y + dy, 0, r0.y + r0.h - minH);
        h = r0.y + r0.h - y;
      }
      if (m.includes('s')) {
        h = clamp(r0.h + dy, minH, CH - r0.y);
      }
      return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    }

    // 按下挂在 box 上而不是 window：只有按在框/手柄上才开始拖，
    // 点框外空白不该动框 —— 框外是压暗区，用户可能是想点「取消」
    box.addEventListener('pointerdown', onDown);
    // ⚠️ move/up 挂 window：手指滑出手柄范围时事件不能断
    //    （setPointerCapture 在部分浏览器会被主动释放，只走一两帧就停）
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    function onResize(): void {
      applyRect();
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    // ---- 关闭 ----
    function close(result: CropRect | null): void {
      if (settled) return;
      settled = true;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.removeEventListener('keydown', onKey);
      // canvas 是调用方的，原样摘出来还回去（只摘 DOM，不动像素）
      canvas.classList.remove('pc-img');
      root.remove();
      resolve(result);
    }

    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') close(null);
    }
    window.addEventListener('keydown', onKey);

    resetBtn.addEventListener('click', () => {
      R = sanitize(defaultRect(CW, CH), CW, CH);
      applyRect();
    });
    cancelBtn.addEventListener('click', () => close(null));
    okBtn.addEventListener('click', () => close(R));

    requestAnimationFrame(applyRect);
  });
}
