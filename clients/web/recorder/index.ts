/**
 * 记谱工具页面入口
 * @description Web Shell 记谱工具页面
 */

import { WebBootstrap } from '../shared/Bootstrap';
import { createRecorderDeps } from '../shared/deps/recorder';
import { RecorderPage } from '../../../presentation/adapters/web/pages/recorder';

async function main() {
  // 1. 初始化 Shell 上下文
  const ctx = await WebBootstrap.init({
    containerId: 'page-root',
  });

  // 2. 创建记谱依赖
  const { recorderApp } = await createRecorderDeps(ctx);

  // 3. 创建页面
  const page = new RecorderPage({
    recorderApp,
    logger: ctx.logger,
    onNavigate: (pageId: string) => {
      if (pageId === 'home') {
        window.location.replace('../index.html');
      }
    },
  });

  // 4. 初始化
  await page.initialize();

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

  // 11. 监听状态变化，更新 UI
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
