/**
 * @fileoverview 真人对弈服务实现
 */
import type { IGame, PlayerColor } from '../../../domain';
import { SGFWriter } from '../../../domain/sgf';
import type { IHHPlayService, IHHPlayState, IHHPlayCallbacks } from './IHHPlayService';
import type { IHHPlayConfig, IRoomInfo, IPlayerInfo } from './types';
import type { HHPlayDraft } from './DraftTypes';
import { getBoardState, toSimpleMove } from './HHUtils';
import { SignalingClient } from './SignalingClient';
import { PeerConnection } from './PeerConnection';
import { RoomManager } from './RoomManager';
import { TimeController } from './TimeController';
import { MessageHandler } from './MessageHandler';
import { DraftManager } from './DraftManager';
import type { IConfigProvider } from '../../../infrastructure/config/interfaces/IConfigProvider';
import type { IPlayConfig } from '../../../infrastructure/config/schemas/PlayConfigSchema';
import type { AIController } from '../../ai/AIController';
import type { IKeyValueStorage } from '../../../infrastructure/storage/interfaces/IKeyValueStorage';

/** 真人对弈服务 */
export class HHPlayService implements IHHPlayService {
  private game: IGame;
  private config: IPlayConfig | null = null;
  private signaling: SignalingClient | null = null;
  private peerConnection: PeerConnection | null = null;
  private roomManager: RoomManager | null = null;
  private timer: TimeController | null = null;
  private messageHandler: MessageHandler | null = null;
  private callbacks: IHHPlayCallbacks = {};
  private inGame = false;
  private configProvider: IConfigProvider | null = null;
  private aiController: AIController | null = null;
  private isCreator = false; // 标记是否为创建方
  private lastMoveTimestamp: number = 0; // 最后落子时间戳,用于计时同步
  private pendingRoomId: string | null = null; // 等待确认的房间 ID
  private pendingRoomInfo: {
    creatorName: string;
    creatorColor: PlayerColor;
    handicap: number;
    timeLimit: number;
  } | null = null; // 等待确认的房间信息
  private myCountResult: number | null = null; // 我的数子结果
  private opponentCountResult: number | null = null; // 对手的数子结果
  private draftManager: DraftManager | null = null; // 草稿管理器
  private p2pHeartbeatTimer: ReturnType<typeof setInterval> | null = null; // P2P 心跳定时器(状态同步)
  private isReconnect = false; // 标记本方是否在重连过程中
  private turnCredentials: { urls: string; username: string; credential: string } | null = null; // TURN 凭证

  constructor(game: IGame, configProvider?: IConfigProvider, aiController?: AIController, storage?: IKeyValueStorage) {
    this.game = game;
    this.configProvider = configProvider ?? null;
    this.aiController = aiController ?? null;
    if (storage) {
      this.draftManager = new DraftManager(storage);
    }
  }

  private async getConfig(): Promise<IPlayConfig> {
    if (!this.config) {
      const defaultConfig: IPlayConfig = {
        signalingUrl: 'wss://api.weiqi.lol/ws/signal',
        defaultTimeLimit: 30,
        defaultHandicap: 0,
        soundEnabled: true,
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      };
      const moduleConfig = this.configProvider
        ? await this.configProvider.getModuleConfig<IPlayConfig>('play')
        : {};
      this.config = { ...defaultConfig, ...moduleConfig };
    }
    return this.config;
  }

  private async ensureInitialized(): Promise<IPlayConfig> {
    const config = await this.getConfig();
    if (!this.signaling) this.signaling = new SignalingClient({ url: config.signalingUrl });

    // 设置 TURN 凭证回调（每次都设置，确保重连时也能收到）
    this.signaling.setCallbacks({
      onTurnCredentials: (credentials) => {
        this.turnCredentials = credentials;
        console.log('[HHPlayService] TURN 凭证已保存');
        // 在 PeerConnection 创建 RTCPeerConnection 之前添加 TURN 服务器
        if (this.peerConnection) {
          this.peerConnection.addIceServers([credentials]);
          console.log('[HHPlayService] TURN 服务器已添加到 PeerConnection');
        }
      },
    });

    // 重连时,先关闭旧的 PeerConnection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.peerConnection = new PeerConnection({ iceServers: config.iceServers });

    if (!this.roomManager) this.roomManager = new RoomManager();
    if (!this.messageHandler) {
      this.messageHandler = new MessageHandler(this.signaling, this.peerConnection);
      this.messageHandler.setup(); // 关键:设置信令消息处理
      this.setupMessageHandler();
    } else {
      // 更新 MessageHandler 的 PeerConnection 引用
      this.messageHandler = new MessageHandler(this.signaling, this.peerConnection);
      this.messageHandler.setup();
      this.setupMessageHandler();
    }
    return config;
  }

  async createRoom(name: string, config?: Partial<IHHPlayConfig>): Promise<IRoomInfo> {
    const dc = await this.ensureInitialized();
    const merged: IHHPlayConfig = {
      signalingUrl: config?.signalingUrl ?? dc.signalingUrl, timeLimit: config?.timeLimit ?? dc.defaultTimeLimit,
      handicap: config?.handicap ?? dc.defaultHandicap, soundEnabled: config?.soundEnabled ?? dc.soundEnabled,
    };
    // 根据 UI 传入的 color 参数决定颜色,而不是在这里随机
    // 如果 UI 没有传 color,默认使用 'black'
    const color = config?.color ?? 'black';
    const room = this.roomManager!.createRoom(name, merged, color);
    this.timer = new TimeController({ timeLimit: room.timeLimit }); this.setupTimer();
    await this.signaling!.connect(room.id);

    // 设置为创建方,等待 ready 消息后发送 room-info
    this.isCreator = true;

    // 保存草稿
    await this.saveDraft();

    return room;
  }

  async joinRoom(roomId: string, name: string): Promise<IPlayerInfo> {
    await this.ensureInitialized();

    try {
      await this.signaling!.connect(roomId);
    } catch (error) {
      console.error('[HHPlayService] 信令连接失败', error);
      throw error;
    }

    // 设置为加入方
    this.isCreator = false;

    // 返回房间信息,等待 UI 确认
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('等待房间信息超时'));
      }, 15000);

      this.messageHandler!.setCallbacks({
        onRoomInfo: (info) => {
          clearTimeout(timeout);

          // 保存房间 ID 和房间信息,等待 confirmJoin
          this.pendingRoomId = roomId;
          this.pendingRoomInfo = {
            creatorName: info.name,
            creatorColor: info.color,
            handicap: info.handicap,
            timeLimit: info.timeLimit,
          };

          // 不直接加入,抛出异常提示 UI 显示确认框
          // 这里我们返回一个特殊的 player info,标记为等待确认
          const pendingPlayer: IPlayerInfo = {
            name: name,
            color: info.color === 'black' ? 'white' : 'black',
            isCreator: false,
          };

          // 注意:这里不发送 join-confirm,需要等待 confirmJoin
          resolve(pendingPlayer);
        },
        onError: (error) => {
          clearTimeout(timeout);
          console.error('[HHPlayService] 收到错误', error);
          reject(new Error(error.message || '加入房间失败'));
        },
      });
    });
  }

  /**
   * 检查是否可以落子（不改变状态）
   */
  canMove(x: number, y: number): boolean {
    if (!this.isMyTurn()) return false;
    return this.game.canPlaceStone(x, y);
  }

  async move(x: number, y: number): Promise<void> {
    if (!this.isMyTurn()) throw new Error('不是你的回合');

    // 记录落子时间戳
    const now = Date.now();
    const elapsed = this.lastMoveTimestamp > 0
      ? Math.floor((now - this.lastMoveTimestamp) / 1000)
      : 0;
    this.lastMoveTimestamp = now;

    const color = this.game.getState().currentPlayer;
    const result = this.game.placeStone(x, y);
    if (!result.success) throw new Error(result.error || '落子失败');

    const times = this.timer?.getTimes() ?? { blackTime: 0, whiteTime: 0 };

    // 发送带时间戳的消息
    this.peerConnection?.send({
      type: 'move',
      x,
      y,
      color,
      blackTime: times.blackTime,
      whiteTime: times.whiteTime,
      timestamp: now,
    });

    // 更新本地 Timer 的 currentPlayer
    const nextPlayer = this.game.getState().currentPlayer;
    if (this.timer && nextPlayer) {
      this.timer.switchPlayer(nextPlayer);
    }

    // 同步保存草稿(关键:确保落子后立即保存)
    await this.saveDraft();

    // 触发提子回调
    if (result.captured && result.captured.length > 0) {
      this.callbacks.onCapture?.(result.captured.length, color);
    }

    this.callbacks.onMove?.(x, y, this.game.getState().currentPlayer);
  }

  async pass(): Promise<void> {
    if (!this.isMyTurn()) throw new Error('不是你的回合');
    const color = this.game.getState().currentPlayer; this.game.pass();
    const times = this.timer?.getTimes() ?? { blackTime: 0, whiteTime: 0 };
    this.peerConnection?.send({ type: 'pass', color, ...times });

    // 同步保存草稿
    await this.saveDraft();

    if (this.game.getState().phase === 'ended') {
      this.endGame(color === 'black' ? 'white' : 'black', 'double_pass');
    } else {
      // 通知本地 UI(切换当前玩家)
      const nextPlayer = this.game.getState().currentPlayer;
      if (this.timer && nextPlayer) {
        this.timer.switchPlayer(nextPlayer);
      }
      this.callbacks.onPass?.(color);
    }
  }

  async requestUndo(): Promise<void> {
    // 只有轮到本方落子时才可以悔棋
    if (!this.isMyTurn()) {
      throw new Error('只有轮到你落子时才可以悔棋');
    }
    this.peerConnection?.send({ type: 'undo-request', name: this.roomManager?.getState().me?.name });
  }
  async respondUndo(accept: boolean): Promise<void> {
    if (accept) {
      // 同意悔棋,发送 undo-response 并携带当前时间
      const times = this.timer?.getTimes() ?? { blackTime: 0, whiteTime: 0 };
      this.peerConnection?.send({
        type: 'undo-response',
        accept,
        blackTime: times.blackTime,
        whiteTime: times.whiteTime,
      });
      // 被请求方也执行撤销
      this.handleUndo();
      // 恢复时间
      this.timer?.setTimes(times.blackTime, times.whiteTime);
    } else {
      // 拒绝悔棋
      this.peerConnection?.send({ type: 'undo-response', accept });
    }
  }
  async resign(): Promise<void> { const c = this.roomManager?.getState().me?.color ?? 'black'; this.peerConnection?.send({ type: 'resign' as any, color: c }); this.endGame(c === 'black' ? 'white' : 'black', 'resign'); }
  async reconnect(): Promise<void> { const s = this.roomManager?.getState(); if (!s?.room) throw new Error('无房间信息'); await this.ensureInitialized(); await this.signaling!.connect(s.room.id); }
  async leaveRoom(): Promise<void> {
    this.timer?.stop();
    this.signaling?.disconnect();
    this.peerConnection?.close();
    this.roomManager?.clear();
    this.game.newGame();
    this.inGame = false;

    // 清除草稿
    await this.clearDraft();
  }

  getState(): IHHPlayState {
    const rs = this.roomManager?.getState() ?? { room: null, me: null, opponent: null };
    const gs = this.game.getState();
    const times = this.timer?.getTimes() ?? { blackTime: 0, whiteTime: 0 };
    return {
      room: rs.room, me: rs.me, opponent: rs.opponent, board: getBoardState(gs.board), currentPlayer: gs.currentPlayer,
      moveHistory: gs.moveHistory.map(toSimpleMove).filter((m): m is NonNullable<typeof m> => m !== null).map(m => ({ x: m.x, y: m.y, color: m.player })),
      blackTime: times.blackTime, whiteTime: times.whiteTime, gameEnded: gs.phase === 'ended', inGame: this.inGame,
    };
  }

  setCallbacks(callbacks: IHHPlayCallbacks): void { this.callbacks = { ...this.callbacks, ...callbacks }; }

  getMoveHistory(): Array<{ x: number; y: number; color: PlayerColor }> { return this.getState().moveHistory; }

  exportSgf(metadata?: { blackName?: string; whiteName?: string; result?: string }): string {
    const gs = this.game.getState();
    const rs = this.roomManager?.getState() ?? { room: null, me: null, opponent: null };
    return new SGFWriter().write(gs.moveHistory, {
      size: 19,
      komi: gs.komi,
      blackName: metadata?.blackName ?? rs.room?.creatorName ?? '黑方',
      whiteName: metadata?.whiteName ?? rs.opponent?.name ?? '白方',
      result: metadata?.result,
    });
  }

  /**
   * 获取待确认的房间信息
   */
  getRoomInfo(): {
    creatorName: string;
    creatorColor: PlayerColor;
    handicap: number;
    timeLimit: number;
  } | null {
    return this.pendingRoomInfo;
  }

  /**
   * 确认加入房间
   */
  async confirmJoin(name: string): Promise<IPlayerInfo> {
    if (!this.pendingRoomInfo) {
      throw new Error('无待确认的房间信息');
    }
    if (!this.pendingRoomId) {
      throw new Error('无待确认的房间 ID');
    }
    if (!this.roomManager || !this.signaling) {
      throw new Error('未连接到房间');
    }

    const info = this.pendingRoomInfo;
    const roomId = this.pendingRoomId;

    const player = this.roomManager.joinRoom(roomId, name, {
      creatorName: info.creatorName,
      creatorColor: info.creatorColor,
      handicap: info.handicap,
      timeLimit: info.timeLimit,
    });

    // 设置对手信息(创建方的名称)
    this.roomManager.setOpponent(info.creatorName);

    this.timer = new TimeController({ timeLimit: info.timeLimit });
    this.setupTimer();
    this.inGame = true;

    // 初始化游戏
    // 计算让子后的贴目
    const baseKomi = 7.5;
    const handicapKomi = baseKomi - info.handicap;

    this.game.newGame({
      size: 19,
      handicap: info.handicap,
      komi: handicapKomi,
    });

    // 根据当前玩家设置计时器
    const currentPlayer = this.game.getState().currentPlayer;
    if (this.timer && currentPlayer) {
      this.timer.switchPlayer(currentPlayer);
    }

    // 启动计时器
    this.timer?.start();

    // 发送 join-confirm
    this.signaling.send({ type: 'join-confirm', name });

    // 清除待确认信息
    this.pendingRoomId = null;
    this.pendingRoomInfo = null;

    // 保存草稿
    await this.saveDraft();

    return player;
  }

  /**
   * 申请数子
   */
  async requestCount(): Promise<void> {
    if (!this.peerConnection) throw new Error('未连接');

    this.peerConnection.send({
      type: 'request-count',
      from: this.roomManager?.getState().me?.name
    });

  }

  /**
   * 回应数子请求
   */
  async respondCount(agree: boolean): Promise<void> {
    if (!this.peerConnection) throw new Error('未连接');

    this.peerConnection.send({
      type: 'count-response',
      agree
    });

    if (agree) {
      await this.doCount();
    }

  }

  /**
   * 执行数子
   */
  async doCount(): Promise<void> {
    console.log('[HHPlayService] doCount() 开始执行');

    if (!this.aiController) {
      console.error('[HHPlayService] AI 未加载');
      throw new Error('数子功能暂不可用,AI 未加载');
    }

    // 重置数子结果
    this.myCountResult = null;
    // opponentCountResult 不重置,因为可能已经收到对手结果

    const gs = this.game.getState();
    const moveHistory = gs.moveHistory.map(toSimpleMove)
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .map(m => ({ x: m.x, y: m.y, player: m.player }));

    console.log('[HHPlayService] 准备调用 AI 数子,moveHistory.length:', moveHistory.length, 'komi:', gs.komi);

    try {
      // 从游戏状态中获取正确的 komi
      const komi = gs.komi;

      const scoreLead = await this.aiController.countTerritory(
        getBoardState(gs.board),
        moveHistory,
        komi
      );

      console.log('[HHPlayService] AI 数子完成,scoreLead:', scoreLead);

      this.myCountResult = scoreLead;

      // 发送数子结果给对手
      this.peerConnection?.send({
        type: 'count-result',
        scoreLead
      });
      console.log('[HHPlayService] 已发送数子结果给对手');

      // 检查是否已收到对手结果
      if (this.opponentCountResult !== null) {
        console.log('[HHPlayService] 对手已完成数子,准备合并结果');
        await this.mergeCountResults();
      } else {
        console.log('[HHPlayService] 等待对手数子结果');
      }
    } catch (error) {
      console.error('[HHPlayService] 数子失败:', error);
      throw new Error('数子失败:' + (error as Error).message);
    }
  }

  /**
   * 合并双方数子结果
   */
  private async mergeCountResults(): Promise<void> {
    // 避免重复调用
    if (!this.myCountResult || this.opponentCountResult === null) {
      return;
    }

    const myResult = this.myCountResult;
    const opponentResult = this.opponentCountResult;

    // 检查一致性
    const diff = Math.abs(myResult - opponentResult);
    if (diff > 1) {
      console.warn('[HHPlayService] 数子结果差异过大', {
        myResult,
        opponentResult,
        diff,
      });
    }

    // 使用平均值作为最终结果
    const finalScoreLead = (myResult + opponentResult) / 2;
    const winner = finalScoreLead > 0.5 ? 'black' : finalScoreLead < -0.5 ? 'white' : 'draw';

    // 结束对局,传递 scoreLead(会触发 onGameEnd 回调显示弹框)
    this.endGame(winner, 'count', finalScoreLead);
  }

  /**
   * 数子(形势判断)
   * @param komi - 贴目
   * @returns 领地计算结果
   */
  async countTerritory(komi: number): Promise<{
    blackTerritory: number;
    whiteTerritory: number;
    scoreLead: number;
    winner: 'black' | 'white' | 'draw';
  }> {
    if (!this.aiController) {
      throw new Error('数子功能暂不可用,AI 未加载');
    }

    const gs = this.game.getState();
    const moveHistory = gs.moveHistory.map(toSimpleMove)
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .map(m => ({ x: m.x, y: m.y, player: m.player }));

    try {
      const scoreLead = await this.aiController.countTerritory(getBoardState(gs.board), moveHistory, komi);
      const winner = scoreLead > 0.5 ? 'black' : scoreLead < -0.5 ? 'white' : 'draw';
      return {
        blackTerritory: Math.max(0, Math.round(scoreLead > 0 ? scoreLead : 0)),
        whiteTerritory: Math.max(0, Math.round(scoreLead < 0 ? -scoreLead : 0)),
        scoreLead,
        winner,
      };
    } catch (error) {
      throw new Error('数子功能暂不可用:' + (error as Error).message);
    }
  }

  private setupMessageHandler(): void {
    this.messageHandler!.setCallbacks({
      onReady: () => {

        // 如果之前在等待重连,清除等待对话框
        if (this.inGame) {
          this.callbacks.onOpponentReconnected?.();
        }

        // 如果是本方重连,清除标记
        if (this.isReconnect) {
          this.isReconnect = false;
        }

        // 如果是创建方,发送房间信息给加入方
        if (this.isCreator) {
          const roomState = this.roomManager?.getState();
          if (roomState?.room && roomState.me) {
            this.signaling!.send({
              type: 'room-info',
              name: roomState.me.name,
              color: roomState.me.color,
              handicap: roomState.room.handicap,
              timeLimit: roomState.room.timeLimit,
            });
          }
        }
      },
      onConnected: (clients) => {

        // 重连时,如果只有自己,说明对手已离开
        if (this.isReconnect && clients === 1) {
          // 按照 demo 的逻辑:等待30秒后才结束对局
          // 触发对手断线回调,显示等待对话框
          this.callbacks.onOpponentDisconnected?.();
        }
      },
      onDisconnected: () => {

        // 通过信令服务器检测到对手断线
        if (this.inGame && this.game.getState().phase !== 'ended') {
          this.callbacks.onOpponentDisconnected?.();
        }
      },
      onGameStart: () => {

        // 如果已经在游戏中(重连),不重置游戏状态
        if (this.inGame) {
          return;
        }

        // 获取房间信息中的 handicap
        const roomState = this.roomManager?.getState();
        const handicap = roomState?.room?.handicap ?? 0;

        // 计算让子后的贴目
        // 标准规则:让 N 子,贴目减少 N 目
        const baseKomi = 7.5;
        const handicapKomi = baseKomi - handicap;

        // 初始化游戏
        this.game.newGame({
          size: 19,
          handicap: handicap,
          komi: handicapKomi,
        });
        this.inGame = true;

        // 触发棋盘渲染更新(显示让子棋子)
        const gs = this.game.getState();
        this.callbacks.onMove?.(-1, -1, gs.currentPlayer);

        // 根据 game 的当前玩家设置 timer
        // 注意:让子情况下,白方先行
        const currentPlayer = this.game.getState().currentPlayer;
        if (this.timer && currentPlayer) {
          this.timer.switchPlayer(currentPlayer);
        }

        this.timer?.start();
      },
      onMove: (x, y, color, bt, wt) => {
        const result = this.game.placeStone(x, y);
        this.timer?.setTimes(bt, wt);

        // 更新 Timer 的当前玩家
        const currentPlayer = this.game.getState().currentPlayer;
        if (this.timer && currentPlayer) {
          this.timer.switchPlayer(currentPlayer);
        }

        // 触发提子回调
        if (result.captured && result.captured.length > 0) {
          this.callbacks.onCapture?.(result.captured.length, color);
        }

        this.callbacks.onMove?.(x, y, color);
      },
      onPass: (color) => this.handlePass(color),
      onUndo: (accept, bt, wt) => {
        if (accept) {
          this.handleUndo();
          // 请求方恢复时间
          if (bt !== undefined && wt !== undefined) {
            this.timer?.setTimes(bt, wt);
          }
        } else {
          // 拒绝悔棋,通知 UI
          this.callbacks.onUndoRejected?.();
        }
      },
      onResign: (color) => this.endGame(color === 'black' ? 'white' : 'black', 'resign'),
      onGameEnd: async (winner, reason, scoreLead) => {
        this.inGame = false;
        this.timer?.stop();

        // 清除草稿(游戏结束时)
        await this.clearDraft();

        this.callbacks.onGameEnd?.(winner, reason, scoreLead);
      },
      onRoomInfo: (info) => {

        if (this.inGame) {
          // 重连:已经在游戏中,直接发送 join-confirm 建立连接
          this.signaling!.send({ type: 'join-confirm', name: this.roomManager!.getState().me!.name });

          // 更新对手名称
          const player = this.roomManager!.setOpponent(info.name);
          this.callbacks.onPlayerJoined?.(player);
        } else {
          // 首次加入:保存房间信息,等待用户确认
          this.pendingRoomInfo = {
            creatorName: info.name,
            creatorColor: info.color,
            handicap: info.handicap,
            timeLimit: info.timeLimit,
          };
          this.callbacks.onRoomInfo?.(info);
        }
      },
      onJoinConfirm: (name) => {
        const player = this.roomManager!.setOpponent(name);
        this.callbacks.onPlayerJoined?.(player);
        this.startP2P();
      },
      onCountRequest: (from) => {
        this.callbacks.onCountRequest?.(from);
      },
      onUndoRequest: (from) => {
        this.callbacks.onUndoRequest?.(from);
      },
      onCountResponse: async (agree) => {
        console.log('[HHPlayService] 收到数子响应:', agree);
        this.callbacks.onCountResponse?.(agree);
        if (agree) {
          // 对手同意数子，我也开始数子
          try {
            await this.doCount();
          } catch (error) {
            console.error('[HHPlayService] 数子执行失败:', error);
            // 触发错误回调
            this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
          }
        }
      },
      onCountResult: async (scoreLead) => {
        this.opponentCountResult = scoreLead;
        // 如果我也完成了数子,合并结果
        if (this.myCountResult !== null) {
          await this.mergeCountResults();
        }
      },
      onHeartbeat: (version) => {
        this.handleHeartbeat(version);
      },
      onStateSync: (data) => {
        this.handleStateSync(data);
      },
      onConnectionStateChange: (state) => {
        this.handleConnectionStateChange(state);
      },
    });
  }

  private handlePass(color: PlayerColor): void {
    this.game.pass();

    // 更新 Timer 的当前玩家
    const currentPlayer = this.game.getState().currentPlayer;
    if (this.timer && currentPlayer) {
      this.timer.switchPlayer(currentPlayer);
    }

    if (this.game.getState().phase === 'ended') {
      this.endGame(color, 'double_pass');
    } else {
      // 通知 UI 更新
      this.callbacks.onPass?.(color);
    }
  }
  private handleUndo(): void {
    const beforeCount = this.game.getState().moveHistory.length;

    // 撤销两步:对手的最后一手 + 自己的最后一手
    this.game.undo();
    this.game.undo();

    const afterCount = this.game.getState().moveHistory.length;

    this.timer?.switchPlayer(this.game.getState().currentPlayer);

    // 触发 UI 更新
    const currentPlayer = this.game.getState().currentPlayer;
    this.callbacks.onMove?.(-1, -1, currentPlayer);
  }
  private async startP2P(): Promise<void> { const offer = await this.peerConnection!.createOffer(); this.signaling!.send({ type: 'offer', data: offer }); }
  private setupTimer(): void {
    this.timer?.setCallbacks({
      onTimeUpdate: (bt, wt) => this.callbacks.onTimeUpdate?.(bt, wt),
      onTimeout: (color) => this.endGame(color === 'black' ? 'white' : 'black', 'timeout'),
    });
  }
  private endGame(winner: PlayerColor | 'draw', reason: 'timeout' | 'count' | 'resign' | 'double_pass', scoreLead?: number): void {
    this.timer?.stop();
    // 发送 game-end 消息时携带 scoreLead
    this.peerConnection?.send({ type: 'game-end', winner, reason, scoreLead });
    this.callbacks.onGameEnd?.(winner, reason, scoreLead);

    // 清除草稿(异步,不阻塞)
    this.clearDraft().catch(() => {});
  }
  private isMyTurn(): boolean {
    const me = this.roomManager?.getState()?.me;
    const s = this.game.getState();
    const result = me?.color === s.currentPlayer && s.phase !== 'ended';
    return result;
  }

  // ===== 草稿管理 =====

  /**
   * 从草稿恢复对局
   * @description 恢复棋盘、房间信息、时间,并尝试重新连接
   */
  async restoreFromDraft(draft: HHPlayDraft): Promise<void> {

    // 1. 解析 SGF,恢复棋盘状态
    const { SGFParser } = await import('../../../domain/sgf');
    const parser = new SGFParser();
    const result = parser.parse(draft.sgf);

    // 2. 初始化游戏
    // 计算让子后的贴目
    const baseKomi = 7.5;
    const handicapKomi = baseKomi - draft.handicap;

    this.game.newGame({
      size: 19,
      handicap: draft.handicap,
      komi: handicapKomi,
    });

    // 3. 重放棋谱
for (let i = 0; i < result.moves.length; i++) {
      const move = result.moves[i]!;
      const coord = move.coord;
      if (coord === 'tt' || coord === '' || !coord) {
        this.game.pass();
      } else {
        const x = coord.charCodeAt(0) - 97;
        const y = coord.charCodeAt(1) - 97;
        const moveResult = this.game.placeStone(x, y);
      }
    }

    const gamestate = this.game.getState();

    // 4. 初始化基础设施
    await this.ensureInitialized();

    // 5. 恢复房间状态
    this.isCreator = draft.isCreator;
    this.roomManager!.restoreRoom({
      id: draft.roomId,
      creatorName: draft.isCreator ? draft.myName : draft.opponentName,
      creatorColor: draft.myColor,
      handicap: draft.handicap,
      timeLimit: draft.timeLimit,
      createdAt: Date.now(), // 恢复时使用当前时间
    }, {
      name: draft.myName,
      color: draft.myColor,
      isCreator: draft.isCreator,
    });

    // 6. 恢复对手信息
    if (draft.opponentName) {
      this.roomManager!.setOpponent(draft.opponentName);
    }

    // 7. 初始化计时器
    this.timer = new TimeController({ timeLimit: draft.timeLimit });
    this.setupTimer();

    // 8. 计算断线期间消耗的时间
    let blackTime = draft.blackTime;
    let whiteTime = draft.whiteTime;
    if (draft.lastMoveTimestamp > 0) {
      const elapsed = Math.floor((Date.now() - draft.lastMoveTimestamp) / 1000);
      if (draft.currentPlayer === 'black') {
        blackTime = Math.max(0, blackTime - elapsed);
      } else {
        whiteTime = Math.max(0, whiteTime - elapsed);
      }
    }
    this.timer.setTimes(blackTime, whiteTime);

    // 9. 设置对局状态
    this.inGame = true;
    this.lastMoveTimestamp = draft.lastMoveTimestamp;

    // 10. 重新连接信令服务器
    await this.signaling!.connect(draft.roomId);

    // 11. 设置重连标记
    this.isReconnect = true;

    // 12. 设置当前玩家(关键!)
    const currentPlayer = this.game.getState().currentPlayer;
    if (this.timer && currentPlayer) {
      this.timer.switchPlayer(currentPlayer);
    }

    // 13. 启动计时器
    this.timer?.start();
  }

  /**
   * 保存草稿
   * @description 保存对局状态到持久化存储
   */
  async saveDraft(): Promise<void> {
    if (!this.draftManager) return;
    const draft = this.createDraftData();
    await this.draftManager.save(draft);
  }

  /**
   * 保存指定的草稿数据
   */
  async saveDraftWithData(draft: HHPlayDraft): Promise<void> {
    if (!this.draftManager) return;
    await this.draftManager.save(draft);
  }

  /**
   * 加载草稿
   * @description 从持久化存储恢复对局状态
   */
  async loadDraft(): Promise<HHPlayDraft | null> {
    if (!this.draftManager) return null;
    return await this.draftManager.load();
  }

  /**
   * 清除草稿
   * @description 清除持久化的对局状态
   */
  async clearDraft(): Promise<void> {
    if (!this.draftManager) return;
    await this.draftManager.clear();
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    // 停止心跳
    this.stopHeartbeat();

    // 断开 P2P 连接
    if (this.peerConnection) {
      this.peerConnection.close();
    }

    // 断开信令连接
    if (this.signaling) {
      this.signaling.disconnect();
    }

    // 重置状态
    this.inGame = false;
    this.isReconnect = false;

  }

  /**
   * 构造草稿数据
   */
  private createDraftData(): HHPlayDraft {
    const rs = this.roomManager?.getState() ?? { room: null, me: null, opponent: null };
    const gs = this.game.getState();
    const times = this.timer?.getTimes() ?? { blackTime: 0, whiteTime: 0 };

    return {
      roomId: rs.room?.id ?? '',
      isCreator: this.isCreator,
      myName: rs.me?.name ?? '',
      myColor: rs.me?.color ?? 'black',
      opponentName: rs.opponent?.name ?? '',
      timeLimit: rs.room?.timeLimit ?? 30,
      handicap: rs.room?.handicap ?? 0,
      sgf: this.exportSgf(),
      blackTime: times.blackTime,
      whiteTime: times.whiteTime,
      currentPlayer: gs.currentPlayer,
      lastMoveTimestamp: this.lastMoveTimestamp,
      lastMoveWasPass: false, // TODO: 从游戏状态获取
      inGame: this.inGame,
      gameEnded: gs.phase === 'ended',
    };
  }

  // ===== 心跳和状态同步 =====

  /**
   * 启动 P2P 心跳(仅用于状态同步)
   */
  private startHeartbeat(): void {
    if (this.p2pHeartbeatTimer) return;

    // 每5秒发送一次心跳
    this.p2pHeartbeatTimer = setInterval(() => {
      // P2P 心跳(检测状态同步)
      if (this.peerConnection && this.peerConnection.connectionState === 'connected' && this.inGame) {
        const version = this.game.getState().moveHistory.length;
        this.peerConnection.send({ type: 'heartbeat', version });
      }
    }, 5000);

  }

  /**
   * 停止 P2P 心跳
   */
  private stopHeartbeat(): void {
    if (this.p2pHeartbeatTimer) {
      clearInterval(this.p2pHeartbeatTimer);
      this.p2pHeartbeatTimer = null;
    }
  }

  /**
   * 处理心跳消息(仅用于状态同步)
   */
  private handleHeartbeat(version: number): void {
    const myVersion = this.game.getState().moveHistory.length;

    if (version !== myVersion) {
      this.sendStateSync();
    }

    // 兜底检查:如果收到心跳,说明对手已连接
    // 触发状态纠正逻辑
    this.callbacks.onHeartbeatReceived?.();
  }

  /**
   * 发送状态同步
   */
  private sendStateSync(): void {
    if (!this.peerConnection || this.peerConnection.connectionState !== 'connected') {
      return;
    }

    const rs = this.roomManager?.getState() ?? { room: null, me: null, opponent: null };
    const gs = this.game.getState();
    const times = this.timer?.getTimes() ?? { blackTime: 0, whiteTime: 0 };

    this.peerConnection.send({
      type: 'state-sync',
      name: rs.me?.name ?? '',
      color: rs.me?.color ?? 'black',
      opponentName: rs.opponent?.name ?? '',
      handicap: rs.room?.handicap ?? 0,
      komi: gs.komi,
      timeLimit: rs.room?.timeLimit ?? 30,
      board: getBoardState(gs.board),
      moveHistory: gs.moveHistory.map(toSimpleMove).filter((m): m is NonNullable<typeof m> => m !== null).map(m => ({ x: m.x, y: m.y, color: m.player })),
      currentPlayer: gs.currentPlayer,
      blackTime: times.blackTime,
      whiteTime: times.whiteTime,
      lastMoveTimestamp: this.lastMoveTimestamp,
    });

  }

  /**
   * 处理状态同步消息
   */
  private handleStateSync(data: any): void {
    const myVersion = this.game.getState().moveHistory.length;
    const theirVersion = data.moveHistory ? data.moveHistory.length : 0;


    if (theirVersion > myVersion) {
      // 对手版本更新,同步对手的状态

      // 同步对手名称
      const rs = this.roomManager?.getState();
      if (rs?.opponent) {
        rs.opponent.name = data.name || data.opponentName || '';
      }

      // 重置游戏状态
      this.game.newGame({
        size: 19,
        handicap: data.handicap ?? 0,
        komi: data.komi ?? (7.5 - (data.handicap ?? 0)),
      });

      // 重放棋谱
      if (data.moveHistory && Array.isArray(data.moveHistory)) {
        for (const move of data.moveHistory) {
          if (move.x !== undefined && move.y !== undefined && move.color) {
            this.game.placeStone(move.x, move.y);
          }
        }
      }

      // 同步时间
      let blackTime = data.blackTime ?? 0;
      let whiteTime = data.whiteTime ?? 0;

      // 计算断线期间消耗的时间
      if (data.lastMoveTimestamp && data.currentPlayer) {
        const elapsed = Math.floor((Date.now() - data.lastMoveTimestamp) / 1000);
        if (data.currentPlayer === 'black') {
          blackTime = Math.max(0, blackTime - elapsed);
        } else {
          whiteTime = Math.max(0, whiteTime - elapsed);
        }
        this.lastMoveTimestamp = Date.now(); // 更新时间戳
      }

      this.timer?.setTimes(blackTime, whiteTime);

      // 设置当前玩家
      if (data.currentPlayer && this.timer) {
        this.timer.switchPlayer(data.currentPlayer);
      }

      // 触发回调通知 UI 更新
      this.callbacks.onMove?.(0, 0, this.game.getState().currentPlayer); // 触发 UI 更新

      console.log('[HHPlayService] 状态同步完成', {
        version: this.game.getState().moveHistory.length,
        blackTime,
        whiteTime,
      });
    } else if (myVersion > theirVersion) {
      // 我的版本更新,发送我的状态
      this.sendStateSync();
    }
  }

  /**
   * 处理连接状态变化
   */
  private handleConnectionStateChange(state: RTCPeerConnectionState): void {

    if (state === 'connected') {
      // P2P 连接成功,启动心跳
      this.startHeartbeat();

      // 发送状态同步
      setTimeout(() => {
        this.sendStateSync();
      }, 500);
    } else if (state === 'disconnected' || state === 'failed') {
      // P2P 连接断开,停止心跳
      this.stopHeartbeat();
    }
  }
}
