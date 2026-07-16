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
        window.location.href = '../index.html';
      }
    },
  });

  // 4. 初始化
  await page.initialize();

  // 5. 渲染
  page.render();

  // 6. 绑定 HTML 按钮事件
  document.getElementById('undoBtn')?.addEventListener('click', () => page.undo());
  document.getElementById('saveBtn')?.addEventListener('click', () => {
    saveModal?.classList.add('visible');
    if (blackNameInput) blackNameInput.value = '';
    if (whiteNameInput) whiteNameInput.value = '';
    blackNameInput?.focus();
  });
  document.getElementById('newBtn')?.addEventListener('click', () => page.newGame());

  // 7. 保存按钮和弹框
  const saveBtn = document.getElementById('saveBtn');
  const saveModal = document.getElementById('saveModal');
  const saveCancelBtn = document.getElementById('saveCancelBtn');
  const saveConfirmBtn = document.getElementById('saveConfirmBtn');
  const blackNameInput = document.getElementById('blackNameInput') as HTMLInputElement;
  const whiteNameInput = document.getElementById('whiteNameInput') as HTMLInputElement;

  saveBtn?.addEventListener('click', () => {
    saveModal?.classList.add('visible');
    if (blackNameInput) blackNameInput.value = '';
    if (whiteNameInput) whiteNameInput.value = '';
    blackNameInput?.focus();
  });

  saveCancelBtn?.addEventListener('click', () => {
    saveModal?.classList.remove('visible');
  });

  saveConfirmBtn?.addEventListener('click', async () => {
    const blackName = blackNameInput?.value || '黑方';
    const whiteName = whiteNameInput?.value || '白方';
    
    saveModal?.classList.remove('visible');
    await page.saveToHistory(blackName, whiteName);
  });

  // 点击弹框背景关闭
  saveModal?.addEventListener('click', (e) => {
    if (e.target === saveModal) {
      saveModal.classList.remove('visible');
    }
  });

  // 菜单切换
  const menuBtn = document.getElementById('menuBtn');
  const dropdownMenu = document.getElementById('dropdownMenu');
  
  menuBtn?.addEventListener('click', () => {
    dropdownMenu?.classList.toggle('visible');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) {
      dropdownMenu?.classList.remove('visible');
    }
  });

  // 菜单项事件
  document.getElementById('passMenuItem')?.addEventListener('click', () => {
    dropdownMenu?.classList.remove('visible');
    page.pass();
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

  // 8. 监听状态变化，更新 UI
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

    // 手动保存草稿（因为 setOnUpdate 会覆盖自动保存）
    recorderApp.saveDraft().catch((err) => {
      console.warn('保存草稿失败', err);
    });
  });

  console.info('RecorderPage 已启动');
}

main().catch(console.error);
