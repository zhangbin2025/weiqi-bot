import type { INotificationProvider, Notification } from '../types';

/**
 * 终端通知适配器
 * 
 * 使用控制台输出显示通知
 * 支持颜色和图标
 * 
 * @ai-example
 * ```typescript
 * const notifier = new TerminalNotifier();
 * 
 * await notifier.notify({
 *   id: '1',
 *   title: '构建完成',
 *   body: '项目已成功构建',
 *   type: 'success'
 * });
 * 
 * // 输出：
 * // ✓ 构建完成
 * //   项目已成功构建
 * ```
 */

/** 通知类型配置 */
const TYPE_CONFIG = {
  info: { icon: 'ℹ', color: '\x1b[36m' },      // 青色
  success: { icon: '✓', color: '\x1b[32m' },   // 绿色
  warning: { icon: '⚠', color: '\x1b[33m' },   // 黄色
  error: { icon: '✗', color: '\x1b[31m' },     // 红色
  progress: { icon: '◐', color: '\x1b[35m' },  // 紫色
} as const;

const RESET_COLOR = '\x1b[0m';
const DIM_COLOR = '\x1b[2m';

export class TerminalNotifier implements INotificationProvider {
  readonly platform = 'terminal' as const;

  async isAvailable(): Promise<boolean> {
    // 终端始终可用
    return true;
  }

  async hasPermission(): Promise<boolean> {
    // 终端不需要权限
    return true;
  }

  async requestPermission(): Promise<boolean> {
    // 终端不需要请求权限
    return true;
  }

  async notify(notification: Notification): Promise<void> {
    const config = TYPE_CONFIG[notification.type];
    const icon = notification.silent ? '' : config.icon + ' ';
    
    // 标题行（带颜色）
    const title = `${config.color}${icon}${notification.title}${RESET_COLOR}`;
    
    // 内容行（灰色缩进）
    const body = `${DIM_COLOR}  ${notification.body}${RESET_COLOR}`;
    
    // 进度条（如果是进度通知）
    let progressBar = '';
    if (notification.type === 'progress' && notification.progress !== undefined) {
      const percent = Math.min(100, Math.max(0, notification.progress));
      const filled = Math.floor(percent / 5);
      const empty = 20 - filled;
      progressBar = `  [${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percent}%`;
    }

    // 输出到控制台
    console.log(title);
    console.log(body);
    if (progressBar) {
      console.log(progressBar);
    }

    // 输出数据（如果有）
    if (notification.data && Object.keys(notification.data).length > 0) {
      console.log(`${DIM_COLOR}  Data: ${JSON.stringify(notification.data)}${RESET_COLOR}`);
    }
  }
}
