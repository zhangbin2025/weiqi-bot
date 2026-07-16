/**
 * @fileoverview AI 自对弈服务实现
 * @description 使用组合模式协调各子模块
 */

import type { IAIEngine } from '../../../infrastructure/ai';
import type { IConfigProvider } from '../../../infrastructure/config/interfaces/IConfigProvider';
import type { MMPlayDraft } from './MMPlayDraftTypes';
import { SGFWriter } from '../../../domain/sgf';
import { AutoPlayController } from './AutoPlayController';
import { MMStateManager } from './MMStateManager';
import { MMPlayDraftManager } from './MMPlayDraftManager';
import { MMPlayLoopRunner } from './MMPlayLoopRunner';
import { MMPlayNotifier } from './MMPlayNotifier';
import { AIController } from '../../ai/AIController';
import type {
  IMMPlayConfig,
  IMMPlayState,
  IMMPlayCallbacks,
  PlaySpeed,
} from './types';
import type { IMMPlayService } from './IMMPlayService';
import type { IMMPlayConfig as IRuntimeConfig } from '../../../infrastructure/config/schemas/MMPlayConfigSchema';

/**
 * AI 自对弈服务
 * @ai-example
 * const service = new MMPlayService(katagoEngine);
 * await service.setup({ modelId: 'katago-small', visits: 100, speed: 'normal' });
 * service.setCallbacks({ onMove: (x, y, color, num) => console.log(num) });
 * await service.start();
 */
export class MMPlayService implements IMMPlayService {
  private controller: AutoPlayController;
  private stateManager: MMStateManager;
  private aiController: AIController;
  private loopRunner: MMPlayLoopRunner;
  private notifier: MMPlayNotifier;
  private draftManager = new MMPlayDraftManager();

  private config: IMMPlayConfig | null = null;
  private currentModelUrl: string | null = null;
  private sgfWriter: SGFWriter;
  private configProvider: IConfigProvider | null = null;
  private runtimeConfig: IRuntimeConfig | null = null;

  constructor(
    engine?: IAIEngine,
    configProvider?: IConfigProvider,
    aiController?: AIController,  // 新增参数：接受已有的 AIController
  ) {
    this.controller = new AutoPlayController();
    this.stateManager = new MMStateManager();
    // 如果传入了 AIController，使用它；否则创建新的
    this.aiController = aiController ?? new AIController(engine);
    this.notifier = new MMPlayNotifier({});
    this.loopRunner = new MMPlayLoopRunner(
      this.aiController,
      this.stateManager,
      this.controller,
      this.notifier
    );
    this.sgfWriter = new SGFWriter();
    this.configProvider = configProvider ?? null;
  }

  async setup(config: IMMPlayConfig, modelUrl?: string): Promise<void> {
    // 加载运行时配置
    if (this.configProvider && !this.runtimeConfig) {
      this.runtimeConfig = await this.configProvider.getModuleConfig<IRuntimeConfig>('mmplay');
    }

    // 合并配置
    const mergedConfig: IMMPlayConfig = {
      modelId: config.modelId ?? this.runtimeConfig?.defaultModelId ?? 'katago-small',
      visits: config.visits,
      speed: config.speed,
    };
    if (config.maxMoves !== undefined) mergedConfig.maxMoves = config.maxMoves;
    if (config.saveSgf !== undefined) mergedConfig.saveSgf = config.saveSgf;
    if (config.modelUrl !== undefined) mergedConfig.modelUrl = config.modelUrl;
    if (modelUrl !== undefined) mergedConfig.modelUrl = modelUrl; // 第二个参数优先
    if (config.onProgress !== undefined) mergedConfig.onProgress = config.onProgress;
    this.config = mergedConfig;

    // 配置速度
    if (mergedConfig.speed) {
      this.controller.setSpeed(mergedConfig.speed);
    }
    if (this.runtimeConfig?.autoPlayInterval) {
      this.controller.setDelay(this.runtimeConfig.autoPlayInterval);
    }

    this.stateManager.reset();
    this.controller.reset();
    
    // 如果 AI 未初始化，才初始化
    // 如果 AI 已初始化（通过 modelManager.switchModel()），跳过初始化
    if (!this.aiController.isInitialized()) {
      const finalModelUrl = mergedConfig.modelUrl ?? `/models/${mergedConfig.modelId}.bin.gz`;
      await this.aiController.init(mergedConfig.modelId, finalModelUrl, mergedConfig.onProgress);
      this.currentModelUrl = finalModelUrl;
    }
  }

  async start(): Promise<void> {
    if (!this.config) throw new Error('请先调用 setup() 配置自对弈');
    
    this.notifier.notifyStatusChange(true, false);
    // 在后台运行对弈循环，不阻塞
    this.loopRunner.runLoop(this.config, () => this.saveDraft()).then(() => {
      this.notifier.notifyStatusChange(false, false);
    });
  }

  pause(): void {
    this.controller.pause();
    this.loopRunner.requestPause();
    this.notifier.notifyStatusChange(false, true);
  }

  resume(): void {
    this.controller.resume();
    this.loopRunner.requestResume();
    this.notifier.notifyStatusChange(true, false);
  }

  stop(): void {
    this.controller.stop();
    this.loopRunner.stop();
    this.notifier.notifyStatusChange(false, false);
  }

  async step(): Promise<boolean> {
    if (!this.config) throw new Error('请先调用 setup() 配置自对弈');
    return this.loopRunner.executeMove(this.config, () => this.saveDraft());
  }

  getState(): IMMPlayState {
    const state = this.stateManager.getState();
    const scores = this.stateManager.getScores();
    return {
      ...state,
      isRunning: this.loopRunner.getIsRunning(),
      isPaused: this.loopRunner.getIsPaused(),
      blackScore: scores.black,
      whiteScore: scores.white,
    };
  }

  setCallbacks(callbacks: IMMPlayCallbacks): void {
    this.notifier.setCallbacks(callbacks);
  }

  setSpeed(speed: PlaySpeed): void {
    this.controller.setSpeed(speed);
    if (this.config) this.config.speed = speed;
  }

  setVisits(visits: number): void {
    if (this.config) this.config.visits = visits;
  }

  exportSgf(): string {
    const moves = this.stateManager.getMoveHistory();
    const scores = this.stateManager.getScores();
    const blackScore = scores.black ?? 0;
    const whiteScore = scores.white ?? 0;
    const result =
      blackScore > whiteScore
        ? `B+${(blackScore - whiteScore).toFixed(1)}`
        : `W+${(whiteScore - blackScore).toFixed(1)}`;

    return this.sgfWriter.write(moves as any, {
      size: 19,
      blackName: 'AI-黑方',
      whiteName: 'AI-白方',
      komi: 7.5,
      result,
      date: new Date().toISOString().split('T')[0],
    });
  }

  // ========== 草稿管理 ==========

  async saveDraft(): Promise<void> {
    const state = this.stateManager.getState();
    const draft: MMPlayDraft = {
      board: state.board,
      currentPlayer: state.currentPlayer,
      moveCount: state.currentMove,
      moveHistory: state.moveHistory,
      gameEnded: state.gameEnded,
      blackScore: state.blackScore,
      whiteScore: state.whiteScore,
      modelId: this.config?.modelId ?? 'katago-small',
      ...(this.currentModelUrl && { modelUrl: this.currentModelUrl }), // 保存自定义模型 URL
      visits: this.config?.visits ?? 100,
      speed: this.config?.speed ?? 'normal',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.draftManager.save(draft);
  }

  async loadDraft(): Promise<MMPlayDraft | null> {
    return this.draftManager.load();
  }

  async clearDraft(): Promise<void> {
    this.draftManager.clear();
  }

  async restoreFromDraft(draft: MMPlayDraft): Promise<void> {
    this.stateManager.setState(draft);
    this.notifier.notifyBoardChange(draft.board);
    this.notifier.notifyPlayerChange(draft.currentPlayer);
  }

  // ========== 形势判断和数目 ==========

  /**
   * 形势判断
   * @returns 黑方胜率和目差
   */
  async analyzePosition(): Promise<{ winRate: number; scoreLead: number }> {
    const state = this.stateManager.getState();
    
    if (!this.aiController) {
      throw new Error('AI controller not initialized');
    }
    
    const result = await this.aiController.analyze(
      state.board,
      null, // previousBoard
      state.currentPlayer,
      state.moveHistory.map(m => ({ x: m.x, y: m.y, player: m.color })),
      7.5, // komi
      100, // visits
      5000 // maxTimeMs
    );
    
    // 转换为黑方视角（KataGo 的 winRate 和 scoreLead 都是当前玩家视角）
    const blackWinRate = state.currentPlayer === 'black' 
      ? result.winRate 
      : 1 - result.winRate;
    const blackScoreLead = state.currentPlayer === 'black'
      ? result.scoreLead
      : -result.scoreLead;
    
    return {
      winRate: blackWinRate,
      scoreLead: blackScoreLead,
    };
  }

  /**
   * AI 数目（对局结束时判断胜负）
   * @returns 胜负结果
   */
  async finalScore(): Promise<{ winner: 'black' | 'white'; margin: number; sgfResult: string }> {
    const state = this.stateManager.getState();
    
    // 调用数子接口（使用 500 visits 确保准确）
    const scoreLead = await this.aiController.countTerritory(
      state.board,
      state.moveHistory.map(m => ({ x: m.x, y: m.y, player: m.color })),
      this.stateManager.getKomi()
    );
    
    // 确定胜负（scoreLead 是黑方视角）
    const winner: 'black' | 'white' = scoreLead > 0 ? 'black' : 'white';
    const margin = Math.abs(scoreLead);
    
    // 生成 SGF 结果字符串
    const sgfResult = winner === 'black' 
      ? `B+${margin.toFixed(1)}` 
      : `W+${margin.toFixed(1)}`;
    
    return {
      winner,
      margin,
      sgfResult,
    };
  }
}
