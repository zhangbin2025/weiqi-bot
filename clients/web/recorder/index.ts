/**
 * 记谱工具页面入口
 * @description Web Shell 记谱工具页面
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { createRecorderDeps } from '../shared/deps/recorder';
import { RecorderPage } from '../../../presentation/adapters/web/pages/recorder';
import { takePhotoHandoff, dataUrlToBlob } from '../shared/photo-handoff';
import { openPhotoCropper } from '../shared/photo-cropper';
import { loadPhotoCanvas } from '../../../services/photo';
import type { CropRect } from '../../../services/photo';
import { Dialog } from '../shared/ui/Dialog';

async function main() {
  // 1. 初始化 Shell 上下文
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
  });

  // 2. 创建记谱依赖
  const { recorderApp } = await createRecorderDeps(ctx);

  // 2.5 创建 SessionService（摆子模式把局面经 session 递给 review）
  //     只在摆子模式才用得上，但构造很轻（LocalStorage 适配器 + 初始化），
  //     留着比在菜单回调里临时建省事，也不会拖慢首屏。
  const cacheStorage = ctx.createCacheStorage();
  await cacheStorage.initialize();
  const { SessionService } = await import('../../../services/session');
  const sessionService = new SessionService(cacheStorage);

  // 3. 创建页面
  const page = new RecorderPage({
    recorderApp,
    sessionService,
    onNavigate: (pageId: string) => {
      if (pageId === 'home') {
        window.location.replace('../index.html');
      }
    },
  });

  // 4. 初始化
  await page.initialize();

  /**
   * 拍照摆子主流程：解码 → 弹框选 → 按框识别 → 摆子。
   *
   * 框选是必过的一步（不是「识别失败了才框」）：整图识别的边界准确率不够，
   * 先框住棋盘能把粗定位的错误来源（桌面纹理、书本边、棋盒）直接切掉。
   *
   * ⚠️ canvas 要跨「裁剪 → 识别」两阶段复用：裁剪器只读它的像素不修改，
   *    识别完留着供「重新框选」再来一轮 —— 否则重框要用户重新拍一张。
   */
  async function runPhotoPipeline(file: Blob): Promise<void> {
    // 解码 + 缩放是纯 2D 操作，碰不到 opencv（10MB），所以选完图是秒开的
    const canvas = await loadPhotoCanvas(file);
    // 记住上一次的框：识别失败回来重框时从原位微调，比从头拖省事
    let region: CropRect | null = null;
    for (;;) {
      const r = await openPhotoCropper(canvas, { initial: region });
      if (!r) return; // 取消
      const ok = await page.applyPhotoRegion(canvas, r);
      if (ok) return;
      // 识别失败（多半是框错了）：回到裁剪浮层，调完再来
      region = r;
    }
  }

  // 4.5 消费 assistant「拍照记谱」传来的照片：
  //     有未保存棋局先问（拍都拍了才发现摆不上去最气人，但更气的是摆上去才发现
  //     把没保存的棋局冲了），确认后清空再摆子。
  const handoff = takePhotoHandoff();
  if (handoff) {
    const state = recorderApp.getState();
    const hasWork = state.moveHistory.length > 0 || state.initialStones.length > 0;
    let goOn = true;
    if (hasWork) {
      const ok = await Dialog.confirm(
        '拍照记谱会清空当前棋局的摆子和落子，确定继续吗？',
        { title: '拍照记谱', confirmText: '清空并识别', cancelText: '取消', danger: true },
      );
      if (ok) {
        // ⚠️ newGame 会把模式重置回对局模式，所以切摆子必须排在它后面
        await page.newGame({ skipConfirm: true });
      } else {
        goOn = false; // 照片已随 takePhotoHandoff 删除，不重来
      }
    }
    if (goOn) {
      // ⚠️ 必须进摆子模式：识别准确率做不到 100%，留在对局模式用户没法修正，
      //    而摆子模式下 initialStones 落子前随时可改，配合参考图才修得动。
      //    有落子记录时切不过去（会 toast 提示），此时也不该往下摆。
      if (page.switchToSetupMode()) {
        await runPhotoPipeline(dataUrlToBlob(handoff.dataUrl));
      }
    }
  }

  // 5. 渲染
  page.render();

  // 6. 绑定 HTML 按钮事件
  document.getElementById('undoBtn')?.addEventListener('click', () => page.undo());
  
  // 保存按钮：根据模式决定是否显示名称输入框
  document.getElementById('saveBtn')?.addEventListener('click', () => {
    const state = recorderApp.getState();
    // 摆子模式且没有落子：直接询问先手方
    if (state.moveHistory.length === 0 && state.initialStones.length > 0) {
      page.saveToHistory('', '').then(() => {
        page.newGame({ skipConfirm: true });
      });
    } else {
      // 对局模式：显示名称输入框
      const saveModal = document.getElementById('saveModal');
      const blackNameInput = document.getElementById('blackNameInput') as HTMLInputElement;
      const whiteNameInput = document.getElementById('whiteNameInput') as HTMLInputElement;
      saveModal?.classList.add('visible');
      if (blackNameInput) blackNameInput.value = '';
      if (whiteNameInput) whiteNameInput.value = '';
      blackNameInput?.focus();
    }
  });
  
  document.getElementById('newBtn')?.addEventListener('click', () => page.newGame());

  // 7. 摆子工具事件
  const blackStoneBtn = document.getElementById('blackStoneBtn');
  const whiteStoneBtn = document.getElementById('whiteStoneBtn');
  const eraserBtn = document.getElementById('eraserBtn');

  blackStoneBtn?.addEventListener('click', () => {
    blackStoneBtn.classList.add('active');
    whiteStoneBtn?.classList.remove('active');
    eraserBtn?.classList.remove('active');
    page.setSetupColor('B');
    page.setSetupTool('stone');
  });

  whiteStoneBtn?.addEventListener('click', () => {
    whiteStoneBtn.classList.add('active');
    blackStoneBtn?.classList.remove('active');
    eraserBtn?.classList.remove('active');
    page.setSetupColor('W');
    page.setSetupTool('stone');
  });

  eraserBtn?.addEventListener('click', () => {
    eraserBtn.classList.add('active');
    blackStoneBtn?.classList.remove('active');
    whiteStoneBtn?.classList.remove('active');
    page.setSetupTool('eraser');
  });

  // 8. 保存弹框事件
  const saveModal = document.getElementById('saveModal');
  const saveCancelBtn = document.getElementById('saveCancelBtn');
  const saveConfirmBtn = document.getElementById('saveConfirmBtn');
  const blackNameInput = document.getElementById('blackNameInput') as HTMLInputElement;
  const whiteNameInput = document.getElementById('whiteNameInput') as HTMLInputElement;

  saveCancelBtn?.addEventListener('click', () => {
    saveModal?.classList.remove('visible');
  });

  saveConfirmBtn?.addEventListener('click', async () => {
    const blackName = blackNameInput?.value || '黑方';
    const whiteName = whiteNameInput?.value || '白方';
    
    saveModal?.classList.remove('visible');
    await page.saveToHistory(blackName, whiteName);
    page.newGame({ skipConfirm: true });
  });

  // 点击弹框背景关闭
  saveModal?.addEventListener('click', (e) => {
    if (e.target === saveModal) {
      saveModal.classList.remove('visible');
    }
  });

  // 9. 菜单切换
  const menuBtn = document.getElementById('menuBtn');
  const dropdownMenu = document.getElementById('dropdownMenu');
  
  menuBtn?.addEventListener('click', () => {
    dropdownMenu?.classList.toggle('visible');
  });

  // 点击页面其他地方关闭菜单
  document.addEventListener('click', (e) => {
    if (!menuBtn?.contains(e.target as Node) && !dropdownMenu?.contains(e.target as Node)) {
      dropdownMenu?.classList.remove('visible');
    }
  });

  // 10. 菜单项事件
  document.getElementById('passMenuItem')?.addEventListener('click', () => {
    dropdownMenu?.classList.remove('visible');
    page.pass();
  });

  document.getElementById('setupModeMenuItem')?.addEventListener('click', () => {
    dropdownMenu?.classList.remove('visible');
    page.switchToSetupMode();
  });

  document.getElementById('playModeMenuItem')?.addEventListener('click', () => {
    dropdownMenu?.classList.remove('visible');
    page.switchToPlayMode();
  });

  // 拍照摆子：菜单项 → 确保在摆子模式 → 唤起相机
  document.getElementById('photoSetupMenuItem')?.addEventListener('click', () => {
    dropdownMenu?.classList.remove('visible');
    page.startPhotoSetup();
  });

  // 🤖 AI 分析：对局模式 → review 默认复盘；摆子模式 → review 局面分析
  document.getElementById('aiAnalysisMenuItem')?.addEventListener('click', () => {
    dropdownMenu?.classList.remove('visible');
    void page.startAIAnalysis();
  });

  // ⚠️ 先清 value 再触发，否则连续选同一张图不会触发 change
  const photoFileInput = document.getElementById('photoFileInput') as HTMLInputElement | null;
  photoFileInput?.addEventListener('change', () => {
    const file = photoFileInput.files?.[0];
    if (file) void runPhotoPipeline(file);
  });

  document.getElementById('downloadMenuItem')?.addEventListener('click', () => {
    dropdownMenu?.classList.remove('visible');
    page.downloadSGF();
  });

  document.getElementById('copyMenuItem')?.addEventListener('click', () => {
    dropdownMenu?.classList.remove('visible');
    page.copySGF();
  });

  document.getElementById('historyMenuItem')?.addEventListener('click', () => {
    dropdownMenu?.classList.remove('visible');
    window.location.href = '../replay/list.html?category=recorder&key=all';
  });

  // 11. 照片参考图
  //  - 缩略图态：常驻按钮栏最右侧，点一下放大
  //  - 放大态：可拖动（放大后默认居中会挡住棋盘，必须能挪开）
  //  - 最小化：点右上小按钮，或点照片以外的任意位置（document 上监听接住），
  //    回到按钮栏右侧的缩略图。不做“关闭”——重拍会自然替换，
  //    缩略图本身就是最小化态，留个真关闭反而让人不敢点。
  //  - 清空棋盘时缩略图一起清掉（见 RecorderPage.newGame）
  const photoRef = document.getElementById('photoRef') as HTMLElement | null;
  const photoRefImg = document.getElementById('photoRefImg') as HTMLImageElement | null;

  /** 把放大态的浮层限制在视口内（拖出屏幕就找不回来了） */
  function clampPhotoRef(): void {
    if (!photoRef) return;
    const r = photoRef.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - r.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - r.height - margin);
    const left = Math.min(Math.max(margin, r.left), maxLeft);
    const top = Math.min(Math.max(margin, r.top), maxTop);
    photoRef.style.left = left + 'px';
    photoRef.style.top = top + 'px';
  }

  function enlargePhotoRef(): void {
    if (!photoRef || !photoRefImg) return;
    photoRef.classList.add('enlarged');
    // 先量再定位：加上 class 后宽度才变成放大态的值
    requestAnimationFrame(() => {
      const r = photoRef.getBoundingClientRect();
      photoRef.style.left = Math.max(8, (window.innerWidth - r.width) / 2) + 'px';
      photoRef.style.top = Math.max(8, (window.innerHeight - r.height) / 2) + 'px';
      clampPhotoRef();
    });
  }

  function minimizePhotoRef(): void {
    if (!photoRef) return;
    photoRef.classList.remove('enlarged', 'dragging');
    photoRef.style.left = '';
    photoRef.style.top = '';
    // 顺手复位拖动状态：从外部点击/Esc 收起时不会走到 photoRef 自己的 click 分支
    dragging = false;
    dragMoved = false;
  }

  // 拖动：Pointer Events 一套代码覆盖鼠标和触屏。
  //
  // ⚠️ 踩过的坑：<img> 默认 draggable=true，按下后浏览器启动原生图片拖影，
  // 抢走指针 → 立刻发 pointercancel，自定义拖动只走一两帧就死（现象就是
  // “拖了只动一点点”）。三道保险：HTML 上 draggable="false"、CSS 里
  // -webkit-user-drag:none，这里再拦 dragstart。
  let dragging = false;
  let dragMoved = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOriginLeft = 0;
  let dragOriginTop = 0;

  photoRef?.addEventListener('dragstart', (e) => e.preventDefault());

  photoRef?.addEventListener('pointerdown', (e) => {
    if (!photoRef.classList.contains('enlarged')) return;
    // 按钮上的按下不进入拖动
    if ((e.target as HTMLElement | null)?.closest('.photo-ref-actions')) return;
    // 只响应主键（左键/单指），右键和多指不拖
    if (e.button !== 0) return;
    dragging = true;
    dragMoved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragOriginLeft = photoRef.offsetLeft;
    dragOriginTop = photoRef.offsetTop;
    photoRef.classList.add('dragging');
    try {
      photoRef.setPointerCapture(e.pointerId);
    } catch {
      // 某些浏览器对已释放的 pointerId 会抛；捕不捕都不影响后面的 window 兜底
    }
  });

  // 用 window 而不是元素：setPointerCapture 万一没生效（或被浏览器取消），
  // 手指滑出元素范围事件就断了，表现同样是“只能动一点点”。
  window.addEventListener('pointermove', (e) => {
    if (!dragging || !photoRef) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    // 超过 4px 才算拖动，否则算点击 —— 不然拖完手指抬起会误触发最小化
    if (!dragMoved && Math.abs(dx) + Math.abs(dy) > 4) dragMoved = true;
    if (!dragMoved) return;
    photoRef.style.left = (dragOriginLeft + dx) + 'px';
    photoRef.style.top = (dragOriginTop + dy) + 'px';
  });

  function endDrag(): void {
    if (!dragging) return;
    dragging = false;
    photoRef?.classList.remove('dragging');
    clampPhotoRef();
    // ⚠️ 拖出照片范围松手时，click 会派发到按下/抬起的共同祖先（多半是 body），
    //   进不到 photoRef 自己的 click，dragMoved 就卡在 true 把下一次点击吃掉。
    //   延后一拍复位：click 是同步派发的，此刻读到的仍是真值。
    window.setTimeout(() => { dragMoved = false; }, 0);
  }

  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  photoRef?.addEventListener('click', (e) => {
    // 拖完的那一下不算点击
    if (dragMoved) { dragMoved = false; return; }
    if ((e.target as HTMLElement | null)?.closest('.photo-ref-actions')) return;
    if (photoRef.classList.contains('enlarged')) minimizePhotoRef();
    else enlargePhotoRef();
  });

  document.getElementById('photoRefMinBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    minimizePhotoRef();
  });

  // 点照片以外的地方最小化：最小化按钮又小又靠右上角，正好压在最需要对照的
  // 那片棋子上，多点一个地方就能收，比去够那个按钮省事。
  //
  // ⚠️ 故意不铺全屏透明遮罩：那样会把棋盘的点击一起吃掉，放大照片时点棋盘
  //    就只剩「收起照片」，落子/摆子得点第二次。改成 document 上的监听
  //    （只观察不拦截、不 stopPropagation），棋盘自己的 handler 照常跑，
  //    于是「点棋盘 = 落子 + 收起照片」两者并存。
  // ⚠️ capture 阶段读状态：放大/收起都发生在后续阶段，capture 里读到的一定是
  //    点击之前的态，不会被同一次点击自己改过的 class 骗到。
  // ⚠️ 必须排除 photoRef 自身：否则点照片收起后，它自己的 click 又会看到
  //    enlarged 已为 false，转头当成「点缩略图」再放大一次。
  document.addEventListener('click', (e) => {
    if (!photoRef?.classList.contains('enlarged')) return;
    if (photoRef.contains(e.target as Node)) return;
    // 拖完手指抬起的那一下不算“点外面”
    if (dragging || dragMoved) return;
    minimizePhotoRef();
  }, true);

  // Esc 收起：键盘/桌面端顺手，和点外面同一个出口
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && photoRef?.classList.contains('enlarged')) {
      minimizePhotoRef();
    }
  });

  // 转屏/改窗口大小后把浮层拉回可视区
  window.addEventListener('resize', () => {
    if (photoRef?.classList.contains('enlarged')) clampPhotoRef();
  });

  // 12. 监听状态变化，更新 UI
  recorderApp.setOnUpdate((state) => {
    // 更新手数
    const moveNum = document.getElementById('moveNum');
    if (moveNum) {
      moveNum.textContent = String(state.moveHistory.length);
    }
    
    // 更新当前棋手指示器
    const indicator = document.getElementById('player-indicator');
    if (indicator) {
      const nextPlayer = state.currentPlayer;
      indicator.className = 'stone-indicator ' + (nextPlayer === 'B' ? 'black' : 'white');
    }
  });

  console.info('RecorderPage 已启动');
}

main().catch(console.error);
