// types.ts - AI 函数类型定义
import type { IntentResult, EntityResult } from '../../infrastructure/utils/llm/types';
import type { IPlayerService } from '../../services/player';
import type { IGameService } from '../../services/game';
import type { IJosekiDiscoverService, IJosekiExploreService, IJosekiQuizService } from '../../services/joseki';
import type { OpponentAnalyzer } from '../opponent/OpponentAnalyzer';
import type { IModelService } from '../../services/model';
import type { IReviewService } from '../../services/review';
import type { IRecorderService } from '../../services/recorder';
import type { IDecisionService } from '../../services/decision';
import type { IEventService } from '../../services/event';
import type { IHHPlayService } from '../../services/play/hh';
import type { IHMPlayService } from '../../services/play/hm';
import type { IMMPlayService } from '../../services/play/mm';
import type { IActivityLogService } from '../../services/activity/IActivityLogService';
import type { IScheduledJob } from '../../infrastructure/utils/scheduler';
/** AI 响应动作类型 */
export type AIActionType = 'open_page' | 'start_task' | 'subscribe' | 'query_status' | 'none';
/** AI 响应动作 */
export interface AIAction {
  type: AIActionType;
  page?: string;
  params?: Record<string, any>;
  taskId?: string;
  subscriptionId?: string;
}
/** AI 响应 */
export interface AIResponse {
  text: string;
  action?: AIAction;
  entities?: Record<string, any>;
  confidence?: number;
}
/** 用户意图 */
export interface UserIntent {
  intent: string;
  confidence: number;
  entities: Record<string, any>;
  rawText: string;
}
/** 函数参数定义 */
export interface FunctionParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  enum?: string[];
  default?: any;
}
/** 执行上下文 */
export interface ExecutionContext {
  userId: string;
  taskId?: string;
    // 新增：日志记录器
  onProgress?: (progress: number, message: string) => void;
  services: {
    player: IPlayerService;
    game: IGameService;
    joseki: IJosekiExploreService & IJosekiDiscoverService & IJosekiQuizService;
    opponent: OpponentAnalyzer;
    model: IModelService;
    review: IReviewService;
    recorder: IRecorderService;
    decision: IDecisionService;
    event: IEventService;
    hh: IHHPlayService;
    hm: IHMPlayService;
    mm: IMMPlayService;
    analysis?: IAnalysisService;      // 新增：可选分析服务
    activity?: IActivityLogService;   // 新增：可选活动日志服务
  };
  ui?: {
    openPage: (page: string, params?: any) => void;
  };
  notification?: {
    notify: (message: string) => void;
  };
  scheduler?: {
    add: (job: Omit<IScheduledJob, 'id' | 'createdAt' | 'lastRun' | 'nextRun'>) => Promise<string>;
    remove: (id: string) => Promise<void>;
  };
}
/** 分析服务接口（可选服务） */
export interface IAnalysisService {
  /** 检查服务是否已初始化 */
  isInitialized(): boolean;
  /** 分析棋谱 */
  analyze?(sgf: string, options?: { depth?: number }): Promise<any>;
}
/** 实体词典 */
export interface EntityDictionaries {
  players: string[];
  sources: string[];
  difficulties: string[];
  openings: string[];
}
/** 函数定义 */
export interface AIFunction {
  name: string;
  description: string;
  parameters: Record<string, FunctionParameter>;
  execute: (params: any, context?: ExecutionContext) => Promise<any>;
  isLongRunning?: boolean;
  progressCallback?: (progress: number, message: string) => void;
}
/** 函数定义摘要（供 LLM 使用） */
export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, FunctionParameter>;
}
/** AI 任务 */
export interface IAITask {
  id: string;
  type: 'immediate' | 'long-running' | 'scheduled';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  intent: string;
  params: Record<string, any>;
  progress: number;
  progressMessage?: string;
  result?: any;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  userId: string;
  notifyOnComplete: boolean;
}
/** 任务进度事件 */
export interface IProgressEvent {
  taskId: string;
  progress: number;
  message: string;
  timestamp: number;
}
/** 订阅任务 */
export interface ISubscription {
  id: string;
  userId: string;
  functionName: string;
  params: Record<string, any>;
  schedule: string;
  lastRun?: number;
  nextRun?: number;
  enabled: boolean;
  notifyOnComplete: boolean;
  createdAt: number;
}