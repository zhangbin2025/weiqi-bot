/**
 * 隧道状态监听器（公共模块）
 * @description 客户端模式下监听隧道连接状态，在服务端不在线时用 toast 提示用户
 *
 * 使用方式：
 *   import { setupTunnelMonitor } from '../shared/tunnelMonitor';
 *   setupTunnelMonitor(); // 在页面入口 main() 中调用即可
 */

import { TunnelManager } from '../../../infrastructure/tunnel/TunnelManager';
import { WebToast } from '../../../presentation/adapters/web/components/Toast';

/** 共享的 toast 实例（延迟创建） */
let toast: WebToast | null = null;
/** 是否已显示过错误提示（避免重连时反复弹窗） */
let errorShown = false;
/** 是否已注册监听 */
let registered = false;

function getToast(): WebToast {
  if (!toast) {
    toast = new WebToast();
  }
  return toast;
}

/**
 * 设置隧道状态监听
 * 在客户端模式下，当服务端不在线时用 toast 提示用户
 * 非客户端模式下不做任何事
 */
export function setupTunnelMonitor(pageName?: string): void {
  const tunnelManager = TunnelManager.getInstance();
  if (!tunnelManager.isClientMode()) return;
  if (registered) return; // 防止重复注册
  registered = true;

  const tag = pageName ? '[' + pageName + ']' : '[TunnelMonitor]';

  // 后台启动隧道连接（不阻塞页面渲染）
  console.info(tag + ' 客户端模式，后台启动隧道连接');
  tunnelManager.getClient().catch((e) => {
    console.warn(tag + ' 隧道连接失败:', e);
  });

  // 监听隧道状态变化
  tunnelManager.onStateChange((state) => {
    if (state === 'auth-failed') {
      errorShown = true;
      getToast().error('隧道认证失败：密码与服务端不一致', 5000);
    } else if (state === 'error' && !errorShown) {
      // 只在首次失败时提示，避免重连时反复弹窗
      errorShown = true;
      getToast().error('远程服务端不在线，AI 相关功能将不可用', 5000);
    } else if (state === 'connected') {
      if (errorShown) {
        errorShown = false;
        getToast().success('远程服务端已连接', 3000);
      }
    }
  });
}
