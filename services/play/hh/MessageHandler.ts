/**
 * @fileoverview 消息处理器 - 处理信令和 P2P 消息
 */

import type { PeerConnection } from './PeerConnection';
import type { SignalingClient } from './SignalingClient';
import type { P2PMessage, PlayerColor } from './types';

/** 消息处理器回调 */
export interface IMessageHandlerCallbacks {
  onGameStart?: () => void;
  onMove?: (x: number, y: number, color: PlayerColor, blackTime: number, whiteTime: number) => void;
  onPass?: (color: PlayerColor) => void;
  onUndo?: (accept: boolean, blackTime?: number, whiteTime?: number) => void;
  onUndoRequest?: (from: string) => void; // 收到悔棋请求
  onResign?: (color: PlayerColor) => void;
  onGameEnd?: (winner: PlayerColor | 'draw', reason: string, scoreLead?: number) => void;
  onRoomInfo?: (info: { name: string; color: PlayerColor; handicap: number; timeLimit: number }) => void;
  onJoinConfirm?: (name: string) => void;
  onReady?: () => void; // 双方都已连接到信令服务器
  onConnected?: (clients: number) => void; // 连接到信令服务器，返回房间内的客户端数量
  onDisconnected?: () => void; // 对手断开连接
  onError?: (error: Error) => void;
  /** 收到数子请求 */
  onCountRequest?: (from: string) => void;
  /** 收到数子回应 */
  onCountResponse?: (agree: boolean) => void;
  /** 收到数子结果 */
  onCountResult?: (scoreLead: number) => void;
  /** 收到心跳消息 */
  onHeartbeat?: (version: number) => void;
  /** 收到状态同步消息 */
  onStateSync?: (data: any) => void;
  /** P2P 连接状态变化 */
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
}

/**
 * 消息处理器
 * @ai-example
 * const handler = new MessageHandler(signaling, peerConnection);
 * handler.setCallbacks({ onMove: (x, y, color) => {} });
 */
export class MessageHandler {
  private signaling: SignalingClient;
  private peerConnection: PeerConnection;
  private callbacks: IMessageHandlerCallbacks = {};

  constructor(signaling: SignalingClient, peerConnection: PeerConnection) {
    this.signaling = signaling;
    this.peerConnection = peerConnection;
  }

  setup(): void {
    this.signaling.setCallbacks({
      onMessage: (msg) => this.handleSignalingMessage(msg),
      onError: (err) => this.callbacks.onError?.(err),
    });

    this.peerConnection.setCallbacks({
      onData: (data) => this.handleP2PMessage(data),
      onOpen: () => this.callbacks.onGameStart?.(),
      onConnectionStateChange: (state) => this.callbacks.onConnectionStateChange?.(state),
      onIceCandidate: (candidate) => {
        this.signaling.send({ type: 'ice', data: candidate });
      },
    });
  }

  setCallbacks(callbacks: IMessageHandlerCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  private async handleSignalingMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case 'connected':
        // 连接到信令服务器，返回房间内的客户端数量
        this.callbacks.onConnected?.(msg.clients ?? 0);
        break;
      case 'ready':
        // 双方都已连接到信令服务器
        this.callbacks.onReady?.();
        break;
      case 'disconnected':
        // 对手断开连接
        this.callbacks.onDisconnected?.();
        break;
      case 'offer':
        const answer = await this.peerConnection.handleOffer(msg.data);
        this.signaling.send({ type: 'answer', data: answer });
        break;
      case 'answer':
        await this.peerConnection.handleAnswer(msg.data);
        break;
      case 'ice':
        await this.peerConnection.addIceCandidate(msg.data);
        break;
      case 'room-info':
        this.callbacks.onRoomInfo?.({
          name: msg.name,
          color: msg.color,
          handicap: msg.handicap,
          timeLimit: msg.timeLimit,
        });
        break;
      case 'join-confirm':
        this.callbacks.onJoinConfirm?.(msg.name);
        break;
    }
  }

  private handleP2PMessage(data: P2PMessage): void {
    switch (data.type) {
      case 'move':
        const m = data as any;
        this.callbacks.onMove?.(m.x, m.y, m.color, m.blackTime, m.whiteTime);
        break;
      case 'pass':
        this.callbacks.onPass?.((data as any).color);
        break;
      case 'undo-request':
        // 收到悔棋请求
        this.callbacks.onUndoRequest?.((data as any).name);
        break;
      case 'undo-response':
        const undoResp = data as any;
        this.callbacks.onUndo?.(undoResp.accept, undoResp.blackTime, undoResp.whiteTime);
        break;
      case 'resign':
        this.callbacks.onResign?.((data as any).color);
        break;
      case 'game-end':
        const gameEndData = data as any;
        this.callbacks.onGameEnd?.(gameEndData.winner, gameEndData.reason, gameEndData.scoreLead);
        break;
      case 'request-count':
        // 对手申请数子
        this.callbacks.onCountRequest?.((data as any).from);
        break;
      case 'count-response':
        // 对手回应数子请求
        this.callbacks.onCountResponse?.((data as any).agree);
        break;
      case 'count-result':
        // 收到对手的数子结果
        this.callbacks.onCountResult?.((data as any).scoreLead);
        break;
      case 'heartbeat':
        // 收到心跳，触发版本检查
        this.callbacks.onHeartbeat?.((data as any).version);
        break;
      case 'state-sync':
        // 收到状态同步消息
        this.callbacks.onStateSync?.(data);
        break;
    }
  }
}