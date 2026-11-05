/**
 * Android 软键盘适配（flexbox 布局）—— 从 assistant/index.html 内联脚本逐字抽出。
 *
 * 原理：.page-container 是 height:100dvh 的 flex 列，header/input 都 flex-shrink:0，
 * 只有 .chat-container 是 flex:1。输入法弹起时把 pageContainer 高度设为可视视口高，
 * 标题栏（含菜单按钮）就始终钉在顶部，只有中间消息区被压缩。
 *
 * 功能助手页仍使用原内联脚本（内容与此文件一致）；对话页通过 <script src> 引入本文件。
 */
    (function() {
        const pageContainer = document.querySelector('.page-container');
        const chatContainer = document.querySelector('.chat-container');
        if (!pageContainer) return;

        function scrollToBottom() {
            setTimeout(function() {
                if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
            }, 100);
        }

        // ============ 测量 ============
        // 两个来源各有权重：
        //   · 原生注入的键盘高度（最可信，由 WindowInsets 换算而来）
        //   · window.innerHeight（原生修复后视口会随键盘真正缩小，此值即视口高）
        // 不能用 innerHeight - visualViewport.height 反推键盘高：
        //   两者会互相追赶，推出来的差值不可靠。

        let fullH = 0;            // 无键盘时的视口全高（单调递增）
        let nativeKb = null;      // 原生注入：null=未注入，0=明确收起
        let lastAppliedHeight = null;

        function visibleH() {
            const vv = window.visualViewport;
            return (vv && vv.height > 0) ? vv.height : window.innerHeight;
        }

        // 目标高度决策 —— 必须同时覆盖两种世界：
        //   A) 视口已缩小（原生 padding 修复生效）：innerHeight 本身即视口高，
        //      直接用。绝不能再减一次键盘高，否则双倍扣减、输入框上方空一大块。
        //   B) 视口未缩小（历史行为，GeckoView 不吃 adjustResize）：自行扣减键盘高。
        //   另以 vv 兜底原生注入尚未送达的窗口（/store clear 重载后头几百毫秒）。
        function syncLayout() {
            const inner = window.innerHeight;
            const vvH = visibleH();
            if (inner > fullH) fullH = inner;

            const viewShrunk = fullH > 0 && inner < fullH - 4;
            const vvShrunk = fullH > 0 && vvH > 0 && vvH < fullH - 40;

            let target;
            if (nativeKb !== null && nativeKb > 0) {
                const h = viewShrunk
                    ? Math.min(inner, vvH || inner)
                    : Math.max(0, fullH - nativeKb);
                target = h + 'px';
            } else if (nativeKb === null && vvShrunk) {
                target = Math.max(0, vvH) + 'px';
            } else if (nativeKb === 0 && !viewShrunk) {
                target = '';                       // 原生明确收起
            } else if (nativeKb === null && !viewShrunk && !vvShrunk) {
                target = '';                       // 无键盘
            } else {
                return;                            // 状态不明：保持现状，绝不盲目清回 100dvh
            }

            if (target !== lastAppliedHeight) {
                lastAppliedHeight = target;
                pageContainer.style.height = target;
                scrollToBottom();
            }
            void pageContainer.offsetHeight;
        }

        // 覆盖 status-bar.js 定义的函数（由 Android 原生侧注入键盘高度调用）
        window.onKeyboardHeightChange = function(keyboardHeight) {
            nativeKb = Math.max(0, Number(keyboardHeight) || 0);
            syncLayout();
        };

        // ============ 触发时机 ============
        // 刷新后自检（/store clear 场景）：重载后原生去重会吞掉注入，
        // 页面按过期的 100dvh 渲染，输入框落到软键盘下方。
        [0, 100, 300, 600, 1200].forEach(function(t) {
            setTimeout(function() { syncLayout(); }, t);
        });
        window.addEventListener('load', function() { syncLayout(); });

        // 聚焦时主动轮询，覆盖键盘动画窗口（~1.6s）。
        // 键盘弹出时机不可靠：resize / visualViewport.resize 未必派发，
        // 页面加载时的定时器在用户点输入框时也早已跑完。
        // 轮询能保证在动画期间反复对齐高度。
        const POLL = [0, 50, 100, 150, 200, 250, 300, 400, 500, 700, 900, 1200, 1600];
        let pollTimers = [];
        function stopPoll() { pollTimers.forEach(clearTimeout); pollTimers = []; }
        function startPoll() {
            stopPoll();
            POLL.forEach(function(d) {
                pollTimers.push(setTimeout(function() { syncLayout(); }, d));
            });
        }

        // textarea 初始 disabled，事件委托到 document 才覆盖启用后的聚焦
        // 归零所有可能的滚动偏移。
        // 若键盘弹出时 GeckoView 把文档/视口平移了（scrollY 或 vv.offsetTop != 0），
        // 布局坐标即使正确（inputBottom=780），屏幕上仍会下移同样距离 ——
        // 这正是「数值对了但视觉没顶上去」的唯一合理解释。
        function resetScroll() {
            try {
                if (window.scrollY) window.scrollTo(0, 0);
                const se = document.scrollingElement || document.documentElement;
                if (se && se.scrollTop) se.scrollTop = 0;
                if (document.body && document.body.scrollTop) document.body.scrollTop = 0;
                void pageContainer.offsetHeight;   // 同上：强制重排
            } catch (e) {}
        }

        document.addEventListener('focusin', function(e) {
            if (e.target && e.target.id === 'userInput') {
                resetScroll();
                startPoll();
            }
        });
        document.addEventListener('focusout', function(e) {
            if (e.target && e.target.id === 'userInput') {
                stopPoll();
                [0, 100, 300].forEach(function(t) {
                    setTimeout(function() { syncLayout(); }, t);
                });
            }
        });

        const inputEl = document.getElementById('userInput');
        if (inputEl) {
            const onTap = function () { resetScroll(); startPoll(); };
            inputEl.addEventListener('click', onTap);
            inputEl.addEventListener('touchstart', onTap, { passive: true });
        }

        // 兜底监听（能触发是赚到，不触发也不影响，靠轮询兜住）
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', function() { syncLayout(); });
        }
        window.addEventListener('resize', function() { syncLayout(); });
    })();
