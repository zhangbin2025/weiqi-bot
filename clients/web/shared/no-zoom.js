/**
 * 纯 Web 环境下禁用页面缩放
 * @file clients/web/shared/no-zoom.js
 *
 * @description
 * 所有页面的 <meta viewport> 早已写上 user-scalable=no，但现代浏览器
 * （iOS Safari 10+ / Chrome Android）出于无障碍考虑**故意忽略**该指令，
 * 双指捏合、双击、Ctrl+滚轮照样能缩放。要真正禁掉只能拦事件。
 *
 * 拦三类：
 *   1. 双指捏合    —— touchstart/touchmove 多指（iOS 还有私有的 gesturestart）
 *   2. 双击放大    —— 300ms 内第二次 touchend
 *   3. Ctrl/⌘ + 滚轮 —— 浏览器级页面缩放（触控板捏合也走这条）
 *
 * @usage 本文件由 vite 插件 disablePageZoom 内联进每个 HTML 的 head 末尾，
 *        同步执行、早于任何可能触发缩放的交互。不需要手工引入。
 *
 * ⚠️ 本文件内**禁止出现闭合脚本标签字面量**：它被内联进 HTML 的 script 元素里，
 *    该字面量会让 HTML 解析器提前闭合脚本，导致脚本截断并报语法错误（已实测踩到）。
 *    同理也不要出现 HTML 注释开始标记。
 *
 * @note 「纯 Web 环境」限定：WeiqiApp 客户端内（UA 含 WeiqiApp）不做拦截，
 *       由原生 WebView 自行控制缩放策略，避免与原生设置打架。
 *       无障碍侧已有系统级「强制缩放」开关，不受本脚本影响。
 */
(function () {
  // 幂等标记：HMR / 重复注入时不再二次挂监听
  if (window.__noZoomInstalled__) return;
  window.__noZoomInstalled__ = true;

  // 客户端内不拦：交给原生 WebView 自己的缩放策略
  if (navigator.userAgent && navigator.userAgent.indexOf('WeiqiApp') !== -1) return;

  /** 上一次 touchend 时间戳（双击判定） */
  var lastTouchEnd = 0;

  /**
   * 通用拦截：多指触摸一律吞掉
   * @param {TouchEvent} e
   */
  function blockMultiTouch(e) {
    if (e.touches && e.touches.length > 1) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // --- 1. 双指捏合 ---
  // passive:false 是必须的 —— passive 监听器里 preventDefault 无效且会告警
  document.addEventListener('touchstart', blockMultiTouch, { passive: false, capture: true });
  document.addEventListener('touchmove', blockMultiTouch, { passive: false, capture: true });

  // iOS Safari 私有手势事件：捏合时它先于 touchmove 派发，不拦会漏
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (type) {
    document.addEventListener(
      type,
      function (e) {
        e.preventDefault();
        e.stopPropagation();
      },
      { passive: false, capture: true },
    );
  });

  // --- 2. 双击放大 ---
  document.addEventListener(
    'touchend',
    function (e) {
      var now = Date.now();
      if (now - lastTouchEnd < 300) {
        e.preventDefault();
        e.stopPropagation();
      }
      lastTouchEnd = now;
    },
    { passive: false, capture: true },
  );

  // --- 3. Ctrl/⌘ + 滚轮（含触控板捏合） ---
  document.addEventListener(
    'wheel',
    function (e) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { passive: false, capture: true },
  );

  // --- 4. 键盘缩放快捷键 ---
  // Ctrl/⌘ + +/-/0：浏览器整页缩放。输入框内不拦，
  // 以免破坏文本编辑场景下的正常按键预期。
  document.addEventListener(
    'keydown',
    function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      var t = e.target;
      var tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
      // 兼容不同键盘布局：取物理码，取不到再退回 key
      var code = e.code || '';
      var key = e.key || '';
      if (code === 'Equal' || code === 'Minus' || code === 'Digit0' ||
          key === '+' || key === '=' || key === '-' || key === '_' || key === '0') {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { passive: false, capture: true },
  );
})();
