/**
 * 后台任务类型定义
 */

/**
 * 任务调度选项
 */
export interface TaskOptions {
  schedule?: {
    type: 'immediate' | 'delayed' | 'periodic'
    delay?: number  // 延迟时间（秒）
    interval?: number  // 周期间隔（秒）
  }
  pageUrl?: string  // 业务页面 URL（用于 App 后台任务）
}

/**
 * 任务状态
 */
export interface TaskStatus {
  id: string
  type: string
  params: any
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number  // 0-100
  progressMessage?: string
  createdAt: number  // 时间戳
  startedAt?: number
  completedAt?: number
  result?: TaskResult
  error?: string
}

/**
 * 任务结果
 */
export interface TaskResult {
  title: string  // "查询完成"
  message: string  // "找到棋手马天放"
  detailUrl?: string  // "/player/detail.html?id=xxx"
}

/**
 * 任务过滤条件
 */
export interface TaskFilter {
  statuses?: string[]  // ['pending', 'running']
}
