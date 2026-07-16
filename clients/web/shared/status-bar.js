/**
 * Android 软键盘适配
 *
 * GeckoView 不响应 adjustResize，由原生侧注入键盘高度。
 * 状态栏适配已改用 CSS env(safe-area-inset-top)，此脚本仅处理键盘。
 */
(function() {
  var inputContainer = document.querySelector('.input-container');
  var chatContainer = document.querySelector('.chat-container');
  if (!inputContainer || !chatContainer) return;

  var INPUT_BAR_HEIGHT = 50; // 与 chat-container 的 bottom CSS 值一致

  // 由 Android 原生侧注入键盘高度（CSS px）
  window.onKeyboardHeightChange = function(keyboardHeight) {
    if (keyboardHeight > 0) {
      inputContainer.style.bottom = keyboardHeight + 'px';
      chatContainer.style.bottom = (INPUT_BAR_HEIGHT + keyboardHeight) + 'px';
    } else {
      inputContainer.style.bottom = '0';
      chatContainer.style.bottom = INPUT_BAR_HEIGHT + 'px';
    }

    setTimeout(function() {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }, 100);
  };

  // 浏览器环境降级（桌面调试等）
  if (window.visualViewport && !window.__weiqi_native) {
    window.visualViewport.addEventListener('resize', function() {
      var kb = Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop);
      window.onKeyboardHeightChange(kb);
    });
  }
})();
