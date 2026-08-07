/**
 * 任务桥接处理器
 * 
 * 对等 Android TaskBridgeHandler
 * 处理 task:* 前缀的桥接消息
 * 
 * 重要：所有 handle 调用必须同步返回，因为 sendSync 不支持异步
 */

import { TaskManager } from '../task/task-manager';

export class TaskHandler {
  readonly prefix = 'task:';
  private taskManager: TaskManager;

  constructor() {
    this.taskManager = new TaskManager();
  }

  handle(message: string): string {
    // 解析消息：task:{action}:{json}
    // 对齐 Android split(":", limit=3)：保留第三段中的冒号
    // 注意：JS 的 split(str, limit) 会丢弃剩余部分，与 Kotlin 行为不同
    // 必须手动实现 Kotlin 的 split-limit 语义
    const parts = message.split(':');
    if (parts.length < 2) {
      return JSON.stringify({ error: 'Invalid format' });
    }

    const action = parts[1];
    // parts[2:] 用 ':' 重新拼接，保留 JSON 中的冒号
    const rest = parts.length >= 3 ? parts.slice(2).join(':') : '';

    // 如果 action 是 schedule，再拆一层 subAction:json（与 Android 对齐）
    let resolvedAction: string;
    let jsonStr: string;
    if (action === 'schedule') {
      const colonIdx = rest.indexOf(':');
      if (colonIdx > 0) {
        resolvedAction = `schedule:${rest.substring(0, colonIdx)}`;
        jsonStr = rest.substring(colonIdx + 1);
      } else {
        // task:schedule:list 之类无 JSON 的调用
        resolvedAction = `schedule:${rest}`;
        jsonStr = '';
      }
    } else {
      resolvedAction = action;
      jsonStr = rest;
    }

    try {
      switch (resolvedAction) {
        case 'submit': {
          const json = JSON.parse(jsonStr);
          // 同步生成 taskId，立即返回
          // 异步操作（创建任务、启动 Worker）在后台执行
          const taskId = this.taskManager.submitSync(
            json.type,
            json.params,
            json.pageUrl,
            json.schedule
          );
          return JSON.stringify({ taskId });
        }

        case 'status': {
          const task = this.taskManager.getStatusSync(jsonStr);
          if (task) {
            return JSON.stringify({
              id: task.id,
              type: task.type,
              status: task.status,
              progress: task.progress,
              progressMessage: task.progressMessage,
              result: {
                title: task.resultTitle,
                message: task.resultMessage,
                detailUrl: task.resultDetailUrl,
              },
            });
          }
          return JSON.stringify({ error: 'Task not found' });
        }

        case 'list': {
          const filter = jsonStr ? JSON.parse(jsonStr) : {};
          const statuses = filter.statuses || ['pending', 'running'];
          const tasks = this.taskManager.listTasksSync(statuses);
          return JSON.stringify(tasks.map(t => ({
            id: t.id,
            type: t.type,
            status: t.status,
            progress: t.progress,
            progressMessage: t.progressMessage,
            createdAt: t.createdAt,
          })));
        }

        case 'listCompleted': {
          const tasks = this.taskManager.getCompletedTasksSync();
          return JSON.stringify(tasks.map(t => ({
            id: t.id,
            type: t.type,
            status: t.status,
            title: t.resultTitle || '',
            message: t.resultMessage || '',
            detailUrl: t.resultDetailUrl || '',
            createdAt: t.createdAt,
            completedAt: t.completedAt,
          })));
        }

        case 'delete': {
          this.taskManager.deleteTaskSync(jsonStr);
          return JSON.stringify({ success: true });
        }

        case 'cancel': {
          const success = this.taskManager.cancelTaskSync(jsonStr);
          return JSON.stringify({ success });
        }

        case 'complete': {
          const json = JSON.parse(jsonStr);
          this.taskManager.markCompleted(
            json.taskId,
            json.title,
            json.message,
            json.detailUrl
          );
          return JSON.stringify({ success: true });
        }

        case 'fail': {
          const json = JSON.parse(jsonStr);
          this.taskManager.markFailed(json.taskId, json.error);
          return JSON.stringify({ success: true });
        }

        case 'progress': {
          const json = JSON.parse(jsonStr);
          this.taskManager.updateProgressSync(json.taskId, json.percent, json.message);
          return JSON.stringify({ success: true });
        }

        // 调度操作（与 Android 对齐：schedule:add, schedule:update, schedule:delete 等）
        case 'schedule:add': {
          const config = JSON.parse(jsonStr);
          const id = this.taskManager.addScheduleSync(config);
          return JSON.stringify({ id });
        }
        case 'schedule:update': {
          const json = JSON.parse(jsonStr);
          this.taskManager.updateScheduleSync(json.id, json.config);
          return JSON.stringify({ success: true });
        }
        case 'schedule:delete': {
          this.taskManager.deleteScheduleSync(jsonStr);
          return JSON.stringify({ success: true });
        }
        case 'schedule:get': {
          const config = this.taskManager.getScheduleSync(jsonStr);
          return config ? JSON.stringify(config) : JSON.stringify({ error: 'Schedule not found' });
        }
        case 'schedule:list': {
          const schedules = this.taskManager.listSchedulesSync();
          return JSON.stringify(schedules);
        }
        case 'schedule:run': {
          this.taskManager.runScheduleSync(jsonStr);
          return JSON.stringify({ success: true });
        }

        default:
          return JSON.stringify({ error: `Unknown action: ${resolvedAction}` });
      }
    } catch (error: any) {
      return JSON.stringify({ error: error.message });
    }
  }
}
