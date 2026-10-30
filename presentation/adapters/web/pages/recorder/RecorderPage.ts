/**
 * 记谱工具页面控制器
 */
import { WebBoard } from '../../components/Board';
import { WebDialog } from '../../components/Dialog';
import { AdapterFactory } from '../../../../adapters';
import type { PlayerColor } from '../../../../../domain/primitives';
import type { IPage, PageParams } from '../../../../core/interfaces';
import type { BoardSize } from '../../../../core/types';
import type { RecorderApp } from '../../../../../application/recorder';
import { recognizeRegion } from '../../../../../services/photo';
import type { PhotoBoardResult, PhotoProgress, CropRect } from '../../../../../services/photo';
import type { ISessionService } from '../../../../../services/session/ISessionService';

export interface RecorderPageConfig {
  recorderApp: RecorderApp;
  /** 会话服务（摆子模式走 session 把局面递给 review） */
  sessionService?: ISessionService;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
}

export class RecorderPage implements IPage {
  readonly title = '记谱工具';
  private recorderApp: RecorderApp;
  private board: WebBoard;
  private dialog: WebDialog;
  private toast: ReturnType<typeof AdapterFactory.createToast>;
  private onNavigate: ((page: string, params?: Record<string, string>) => void) | undefined;
  private sessionService: ISessionService | undefined;
  private boardSize: BoardSize = 19;
  private initialized = false;
  private mode: 'play' | 'setup' = 'play';
  private setupColor: 'B' | 'W' = 'B';
  private setupTool: 'stone' | 'eraser' = 'stone';

  constructor(config: RecorderPageConfig) {
    this.recorderApp = config.recorderApp;
    this.onNavigate = config.onNavigate;
    this.sessionService = config.sessionService;
    this.board = new WebBoard();
    this.dialog = new WebDialog();
    this.toast = AdapterFactory.createToast();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.board.initialize({ size: this.boardSize, showCoordinates: false });
    this.board.on({
      onClick: (pos) => this.handleStoneClick(pos),
      onHover: (pos) => this.handleBoardHover(pos),
    });

    try {
      const draftResult = await this.recorderApp.loadDraft();
      const state = this.recorderApp.getState();
      if (state.moveHistory.length > 0 || state.initialStones.length > 0) {
        this.renderBoard();
      }
      if (draftResult && draftResult.mode === 'setup') {
        this.mode = 'setup';
        this.switchToSetupMode();
      }
    } catch (e) {}

    this.initialized = true;
  }

  handleParams(params: PageParams): void {}

  private handleStoneClick(pos: { x: number; y: number }): void {
    if (this.mode === 'setup') {
      if (this.setupTool === 'stone') {
        const success = this.recorderApp.addInitialStone(pos.x, pos.y, this.setupColor);
        if (success) this.renderBoard();
      } else {
        const success = this.recorderApp.removeInitialStone(pos.x, pos.y);
        if (success) this.renderBoard();
      }
    } else {
      const result = this.recorderApp.placeStone(pos.x, pos.y);
      if (result.success) {
        this.recorderApp.playSound(result.captured.length > 0 ? 'capture' : 'stone');
        this.renderBoard();
      }
    }
  }

  /**
   * 处理棋盘悬停：在落点显示半透明预览棋子，指示将要落子的颜色（与 replay 体验一致）
   */
  private handleBoardHover(pos: { x: number; y: number } | null): void {
    if (pos === null) {
      this.board.clearPreviewStone();
      return;
    }
    // 已有棋子的位置不显示预览
    const stones = this.board.getStones();
    if (stones.has(`${pos.x},${pos.y}`)) {
      this.board.clearPreviewStone();
      return;
    }
    // 摆子模式下的橡皮擦工具：是消除而非落子，不显示预览
    if (this.mode === 'setup' && this.setupTool === 'eraser') {
      this.board.clearPreviewStone();
      return;
    }
    // 颜色：对局模式取当前执棋方；摆子模式取当前摆子颜色
    const color: PlayerColor = this.mode === 'setup'
      ? (this.setupColor === 'B' ? 'black' : 'white')
      : this.recorderApp.getState().currentPlayer;
    this.board.setPreviewStone({ x: pos.x, y: pos.y }, color);
  }

  private renderBoard(): void {
    const state = this.recorderApp.getState();
    const gameBoard = state.board;
    const size = gameBoard.size;
    this.board.clear();
    const stones: Array<{ pos: { x: number; y: number }; color: PlayerColor | null }> = [];
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        const stone = gameBoard.getStone(x, y);
        if (stone) stones.push({ pos: { x, y }, color: stone });
      }
    }
    this.board.setStones(stones);
    if (state.lastMove) {
      this.board.highlight({ x: state.lastMove.x, y: state.lastMove.y }, 'last');
    }
  }

  /** @returns 是否成功进入摆子模式（已有落子记录时为 false） */
  switchToSetupMode(): boolean {
    const state = this.recorderApp.getState();
    if (state.moveHistory.length > 0) {
      this.toast.warning('已有落子记录，不能切换到摆子模式');
      return false;
    }
    this.mode = 'setup';
    this.recorderApp.saveDraft('setup').catch(e => console.error('保存草稿失败', e));
    
    const setupModeMenuItem = document.getElementById('setupModeMenuItem');
    const playModeMenuItem = document.getElementById('playModeMenuItem');
    if (setupModeMenuItem) setupModeMenuItem.classList.add('hidden');
    if (playModeMenuItem) playModeMenuItem.classList.remove('hidden');
    
    const modeIndicator = document.getElementById('modeIndicator');
    if (modeIndicator) {
      modeIndicator.textContent = '摆子模式';
      modeIndicator.classList.add('setup-mode');
    }
    
    const setupTools = document.getElementById('setupTools');
    if (setupTools) setupTools.classList.add('visible');
    
    const undoBtn = document.getElementById('undoBtn');
    if (undoBtn) undoBtn.style.display = 'none';
    
    const moveCountDisplay = document.getElementById('moveCountDisplay');
    if (moveCountDisplay) moveCountDisplay.style.display = 'none';
    
    const passMenuItem = document.getElementById('passMenuItem') as HTMLButtonElement;
    if (passMenuItem) passMenuItem.disabled = true;
    return true;
  }

  switchToPlayMode(): void {
    const state = this.recorderApp.getState();
    const hasWhiteStones = state.initialStones.some(s => s.color === 'W');
    if (hasWhiteStones) {
      this.toast.warning('已放置白子，不能切换到对局模式（死活题请直接保存）');
      return;
    }
    this.mode = 'play';
    this.recorderApp.saveDraft('play').catch(e => console.error('保存草稿失败', e));
    
    const setupModeMenuItem = document.getElementById('setupModeMenuItem');
    const playModeMenuItem = document.getElementById('playModeMenuItem');
    if (setupModeMenuItem) setupModeMenuItem.classList.remove('hidden');
    if (playModeMenuItem) playModeMenuItem.classList.add('hidden');
    
    const modeIndicator = document.getElementById('modeIndicator');
    if (modeIndicator) {
      modeIndicator.textContent = '对局模式';
      modeIndicator.classList.remove('setup-mode');
    }
    
    const setupTools = document.getElementById('setupTools');
    if (setupTools) setupTools.classList.remove('visible');
    
    const undoBtn = document.getElementById('undoBtn');
    if (undoBtn) undoBtn.style.display = '';
    
    const moveCountDisplay = document.getElementById('moveCountDisplay');
    if (moveCountDisplay) moveCountDisplay.style.display = '';
    
    const passMenuItem = document.getElementById('passMenuItem') as HTMLButtonElement;
    if (passMenuItem) passMenuItem.disabled = false;

    if (state.initialStones.length > 0) {
      this.recorderApp.setInitialPlayer('white');
    }
  }

  setSetupColor(color: 'B' | 'W'): void {
    this.setupColor = color;
  }

  setSetupTool(tool: 'stone' | 'eraser'): void {
    this.setupTool = tool;
  }

  // ===== AI 分析 =====

  /**
   * 「🤖 AI 分析」菜单入口：把当前棋谱/局面递给 review 页面。
   *
   * 两种模式分别走 review 已支持的两条入参路径，review 端零改动：
   * - 对局模式：`?sgf=<base64>` → 默认复盘模式（深度分析 + 胜率图 + 归档）
   * - 摆子模式：`?sessionId=<id>&analyzePosition=true&moveTo=0` → 局面分析模式
   *   摆子只有 AB[]/AW[] 没有着法序列，复盘模式没东西可分析，且复盘会把它
   *   归档成一条空棋谱，所以走 session 传局面（joseki 探索页同款做法）。
   *
   * ⚠️ base64 前必须先 encodeURIComponent：SGF 里有中文棋手名，btoa 遇到
   *   码位 >0xFF 的字符直接抛 InvalidCharacterError。review 端是
   *   `decodeURIComponent(atob(...))`，正好配对。
   * ⚠️ base64 结果仍要再 encodeURIComponent 一次才拼进 URL：`+` 在 query
   *   里会被解成空格，atob 拿到空格就废了。
   */
  async startAIAnalysis(): Promise<void> {
    const state = this.recorderApp.getState();
    const hasMoves = state.moveHistory.length > 0;
    const hasSetup = state.initialStones.length > 0;

    if (!hasMoves && !hasSetup) {
      this.toast.warning('棋盘是空的，先落子或摆子再分析');
      return;
    }

    // 摆子模式（无落子）：局面里只有初始摆子，AI 不知道轮谁下。
    // SGFWriter 会把 state.initialPlayer 写成 PL[]，所以问完先手方再生成 SGF。
    if (!hasMoves) {
      // ⚠️ 不能用 type:'confirm'：WebDialog 的 confirm 取消按钮走 close()，
      //    resolve 出来是 null 而不是 false（Dialog.ts 里 close() 无条件 resolve(null)），
      //    于是「白先」永远选不中（saveToHistory 里同样的写法也有这个坑）。
      //    custom 类型按 btn.id 返回，行为才是确定的。
      const result = await this.dialog.show({
        type: 'custom',
        title: '选择先手方',
        content: '当前没有落子记录，请选择先手方：',
        buttons: [
          { id: 'black', text: '⚫ 黑先' },
          { id: 'white', text: '⚪ 白先' },
          { id: 'cancel', text: '取消' },
        ],
      });
      if (result === 'black') {
        this.recorderApp.setInitialPlayer('black');
      } else if (result === 'white') {
        this.recorderApp.setInitialPlayer('white');
      } else {
        return; // 取消 / 点背景关闭
      }
      // ⚠️ 先手方变了要落草稿，否则下次进页面退回黑先，和刚才问的结果对不上
      this.recorderApp.saveDraft('setup').catch(e => console.error('保存草稿失败', e));
    }

    const sgf = this.recorderApp.generateSGF();

    try {
      // 对局模式：整段 SGF 塞 URL，走默认复盘
      if (hasMoves) {
        const encoded = btoa(encodeURIComponent(sgf));
        window.location.href = `../review/index.html?sgf=${encodeURIComponent(encoded)}`;
        return;
      }
      // 摆子模式：走 session 传局面
      if (!this.sessionService) {
        this.toast.error('会话服务未就绪，无法分析局面');
        return;
      }
      const sessionId = await this.sessionService.create('recorder', { sgf });
      window.location.href = `../review/index.html?sessionId=${encodeURIComponent(sessionId)}&analyzePosition=true&moveTo=0`;
    } catch (e) {
      console.error('跳转 AI 分析失败', e);
      this.toast.error('跳转失败：' + (e instanceof Error ? e.message : String(e)));
    }
  }

  // ===== 拍照摆子 =====

  /**
   * 「拍照摆子」入口：先确保在摆子模式，再唤起相机/相册。
   *
   * 有落子记录时进不了摆子模式（switchToSetupMode 会拦下并提示），
   * 此时直接返回——不让用户白拍一张才发现摆不上去。
   */
  startPhotoSetup(): void {
    // ⚠️ 不能用 `if (this.mode !== 'setup')` 后的 this.mode 再判一次：
    // TS 控制流分析会把 mode 收窄成 'play'，比较恒为 false。
    if (this.mode !== 'setup' && !this.switchToSetupMode()) return;
    this.requestPhoto();
  }

  /** 唤起系统相机/相册（点击页面里隐藏的 file input） */
  requestPhoto(): void {
    const input = document.getElementById('photoFileInput') as HTMLInputElement | null;
    if (!input) {
      this.toast.error('拍照入口未就绪');
      return;
    }
    // 清空 value，否则连续选同一张图不会触发 change
    input.value = '';
    input.click();
  }

  /**
   * 识别 canvas 的指定区域并把结果摆到棋盘上（替换现有初始摆子）。
   *
   * 为什么不弹「确认要用这个结果吗」：识别准确率约 98%，
   * 但错的那 2% 只能靠肉眼比对发现。这里把照片做成按钮栏右侧的常驻缩略图
   * （可点击放大、放大后可拖动、可最小化回缩略图），让用户边看照片
   * 边在摆子模式里增删子 —— 比弹窗更顺手。
   * 摆子是 initialStones，落子前随时可改，也不影响后续对局记录。
   *
   * @returns 是否识别成功；false 表示失败（多半是框错了），调用方可让用户重框
   */
  async applyPhotoRegion(canvas: HTMLCanvasElement, region: CropRect): Promise<boolean> {
    this.showPhotoProgress({ stage: 'loading-cv', percent: null, message: '准备识别…' });
    try {
      const result = await recognizeRegion(canvas, region, (p) => this.showPhotoProgress(p));
      this.applyResult(result);
      return true;
    } catch (e) {
      this.hidePhotoProgress();
      console.error('拍照识别失败', e);
      this.toast.error('识别失败：' + (e instanceof Error ? e.message : String(e)));
      return false;
    }
  }

  /**
   * 把识别结果摆上棋盘 + 换掉参考缩略图。
   *
   * 单独拆一个方法：applyPhotoRegion 只管「识别 → 成败」，这里负责落子后的
   * 收尾（缩略图 + toast）。将来若有别的识别入口可直接复用。
   * @returns 摆上的子数
   */
  private applyResult(result: PhotoBoardResult): number {
    this.clearInitialStones();
    let placed = 0;
    for (let j = 0; j < result.size; j++) {
      for (let i = 0; i < result.size; i++) {
        const v = result.stones[j * result.size + i];
        if (v !== 1 && v !== 2) continue;
        if (this.recorderApp.addInitialStone(i, j, v === 1 ? 'B' : 'W')) placed++;
      }
    }
    this.renderBoard();

    const thumb = this.makePhotoThumb(result);
    if (thumb) this.setPhotoRef(thumb);

    this.hidePhotoProgress();

    if (placed === 0) {
      this.toast.warning('没识别到棋子，建议重拍或手动摆子');
    } else {
      this.toast.success(`已摆 ${placed} 子，请对照照片修正`);
    }
    return placed;
  }

  /** 更新识别进度遮罩（首次要下 10MB opencv，必须给进度，否则像卡死） */
  private showPhotoProgress(p: PhotoProgress): void {
    const box = document.getElementById('photoProgress');
    const msg = document.getElementById('photoProgressMsg');
    const bar = document.getElementById('photoProgressBar');
    if (!box || !msg || !bar) return;
    box.removeAttribute('hidden');
    msg.textContent = p.message;
    if (p.percent === null) {
      bar.style.width = '';
      bar.classList.add('indeterminate');
    } else {
      bar.classList.remove('indeterminate');
      bar.style.width = p.percent + '%';
    }
  }

  private hidePhotoProgress(): void {
    document.getElementById('photoProgress')?.setAttribute('hidden', '');
  }

  /**
   * 显示/更新参考照片缩略图（常驻按钮栏最右侧）；传 null 收起。
   *
   * 这里只负责放图和复位，放大/拖动/最小化都是缩略图自己的交互
   * （见 index.ts），换照片时必须复位，否则会留着上一张的放大浮层。
   */
  private setPhotoRef(dataUrl: string | null): void {
    const wrap = document.getElementById('photoRef');
    const img = document.getElementById('photoRefImg') as HTMLImageElement | null;
    if (!wrap || !img) return;
    // 复位放大态：新照片从头开始，位置与上一次拖动无关
    wrap.classList.remove('enlarged', 'dragging');
    wrap.style.left = '';
    wrap.style.top = '';
    if (!dataUrl) {
      wrap.setAttribute('hidden', '');
      img.removeAttribute('src');
      return;
    }
    img.src = dataUrl;
    img.style.height = 'auto';
    wrap.removeAttribute('hidden');
  }

  /**
   * 生成带框选范围 + 四角标注的照片缩略图。
   *
   * 画三样东西，用户对一次就能定位问题：
   *  - 白色虚线框：用户自己选的范围（框错了是用户的锅，一眼能看出来）
   *  - 橙色四边形：机器以为棋盘在哪（画歪了说明识别不可信，重框或重拍）
   *  - 框外的画面压暗：强调「只有框里被识别了」
   *
   * 缩到 600px 再转 JPEG：识别用的 canvas 有 2000px，直接 toDataURL 出来的
   * dataURL 太大，塞进 <img> 会明显卡顿。
   *
   * ⚠️ 坐标系：r.corners 已在 recognizeRegion 里加回裁剪偏移，和 r.region
   *    同为整图坐标系，所以这里能直接乘同一个缩放比。
   */
  private makePhotoThumb(r: PhotoBoardResult): string {
    const src = r.canvas;
    const maxSide = 600;
    const s = Math.min(1, maxSide / Math.max(src.width, src.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * s));
    c.height = Math.max(1, Math.round(src.height * s));
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);

    // 框外压暗：让「识别范围」这件事在缩略图上也看得见
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.rect(0, 0, c.width, c.height);
    ctx.rect(r.region.x * s, r.region.y * s, r.region.w * s, r.region.h * s);
    ctx.fill('evenodd');

    const R = Math.max(c.width, c.height) * 0.02;

    // 用户框选范围：白色虚线
    ctx.setLineDash([Math.max(4, R * 0.5), Math.max(3, R * 0.35)]);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = Math.max(1.5, R * 0.18);
    ctx.strokeRect(r.region.x * s, r.region.y * s, r.region.w * s, r.region.h * s);
    ctx.setLineDash([]);

    // 机器判定的棋盘四角：橙色实线
    ctx.strokeStyle = '#FF8A1F';
    ctx.lineWidth = Math.max(2, R * 0.3);
    ctx.beginPath();
    const order = [0, 1, 3, 2, 0];
    for (let k = 0; k < order.length; k++) {
      const idx = order[k];
      if (idx === undefined) continue;
      const p = r.corners[idx];
      if (!p) continue;
      const x = p[0] * s;
      const y = p[1] * s;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    return c.toDataURL('image/jpeg', 0.85);
  }

  clearInitialStones(): void {
    // ⚠️ 必须快照：getState() 返回的是 Game 内部的活引用（Game.getState 直接
    // 传 this.initialStones），而 removeInitialStone 会 splice 同一个数组。
    // 边遍历边删会让 for...of 的游标跳过元素——隔一个漏一个，留下幽灵子。
    const stones = [...this.recorderApp.getState().initialStones];
    for (const stone of stones) {
      this.recorderApp.removeInitialStone(stone.x, stone.y);
    }
    this.renderBoard();
  }

  undo(): void {
    const state = this.recorderApp.getState();
    if (state.moveHistory.length === 0) return;
    if (this.recorderApp.undo()) {
      this.recorderApp.playSound('undo');
      this.renderBoard();
    }
  }

  pass(): void {
    this.recorderApp.pass();
    this.recorderApp.playSound('pass');
  }

  async newGame(options?: { skipConfirm?: boolean }): Promise<void> {
    const state = this.recorderApp.getState();
    if (!options?.skipConfirm && (state.moveHistory.length > 0 || state.initialStones.length > 0)) {
      const result = await this.dialog.show({
        type: 'custom',
        title: '清空棋盘',
        content: '是否保存当前棋谱？',
        buttons: [
          { id: 'save', text: '保存' },
          { id: 'discard', text: '不保存' },
          { id: 'cancel', text: '取消' },
        ],
      });
      if (result === 'save') {
        const saveModal = document.getElementById('saveModal');
        if (saveModal) {
          saveModal.classList.add('visible');
          const blackNameInput = document.getElementById('blackNameInput') as HTMLInputElement;
          blackNameInput?.focus();
        }
        return;
      } else if (result === 'cancel' || result === null) {
        return;
      }
    }
    await this.recorderApp.clearDraft();
    this.recorderApp.newGame({ size: this.boardSize });
    this.board.clear();
    this.mode = 'play';
    this.switchToPlayMode();
  }

  async saveToHistory(blackName: string, whiteName: string): Promise<void> {
    const state = this.recorderApp.getState();
    if (state.moveHistory.length === 0) {
      const result = await this.dialog.show({
        type: 'confirm',
        title: '选择先手方',
        content: '当前没有落子记录，请选择先手方：',
        confirmText: '⚫ 黑先',
        cancelText: '⚪ 白先',
      });
      if (result === true) {
        this.recorderApp.setInitialPlayer('black');
      } else if (result === false) {
        this.recorderApp.setInitialPlayer('white');
      } else {
        return;
      }
    }
    const metadata = { blackName: blackName || '黑方', whiteName: whiteName || '白方' };
    const id = await this.recorderApp.saveToHistory(metadata);
    if (id) {
      this.toast.success('棋谱已保存');
    } else {
      this.toast.error('保存失败');
    }
  }

  async downloadSGF(): Promise<void> {
    const state = this.recorderApp.getState();
    if (state.moveHistory.length === 0 && state.initialStones.length === 0) return;
    const dateStr = new Date().toISOString().split('T')[0] ?? '';
    const metadata = { blackName: '黑方', whiteName: '白方', date: dateStr };
    await this.recorderApp.downloadSGF(metadata);
  }

  async copySGF(): Promise<void> {
    const state = this.recorderApp.getState();
    if (state.moveHistory.length === 0 && state.initialStones.length === 0) return;
    const sgf = this.recorderApp.generateSGF();
    try {
      await navigator.clipboard.writeText(sgf);
    } catch (e) {
      console.error('复制失败', e as Error);
    }
  }

  render(): void {
    this.board.render();
  }

  destroy(): void {
    this.board.destroy();
    this.dialog.destroy();
    this.toast.destroy();
    this.initialized = false;
  }
}
