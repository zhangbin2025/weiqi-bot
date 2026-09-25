/**
 * @fileoverview WebRTC P2P 连接管理
 */

import type { IGameEndMessage, IMoveMessage, IPassMessage, PlayerColor } from './types';

/** 分片大小（64KB） */
const CHUNK_SIZE = 64 * 1024;
/** 分片阈值（超过则分片） */
const CHUNK_THRESHOLD = 50 * 1024;

/** 分片接收缓冲 */
interface ChunkBuffer {
  total: number;
  size: number;
  parts: string[];
  received: number;
}

/** 分片接收器：合并分片消息 */
export class ChunkReceiver {
  private buffers = new Map<string, ChunkBuffer>();

  /** 处理收到的消息，返回完整消息或 null（分片未齐） */
  process(msg: any): any | null {
    if (msg.type === "chunk-start") {
      this.buffers.set(msg.chunkId, { total: msg.total, size: msg.size, parts: new Array(msg.total), received: 0 });
      return null;
    }
    if (msg.type === "chunk-data") {
      const buf = this.buffers.get(msg.chunkId);
      if (!buf) return null;
      buf.parts[msg.index] = msg.data;
      buf.received++;
      return null;
    }
    if (msg.type === "chunk-end") {
      const buf = this.buffers.get(msg.chunkId);
      if (!buf) return null;
      this.buffers.delete(msg.chunkId);
      const json = buf.parts.join("");
      try { return JSON.parse(json); } catch { return null; }
    }
    return msg; // 非分片消息
  }
}

/** 分片发送：大消息拆成多个 chunk */
function sendChunked(dc: RTCDataChannel, msg: any): void {
  const json = JSON.stringify(msg);
  if (json.length <= CHUNK_THRESHOLD) {
    dc.send(json);
    return;
  }
  const chunkId = "chunk-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const total = Math.ceil(json.length / CHUNK_SIZE);
  dc.send(JSON.stringify({ type: "chunk-start", chunkId, total, size: json.length }));
  for (let i = 0; i < total; i++) {
    dc.send(JSON.stringify({ type: "chunk-data", chunkId, index: i, data: json.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) }));
  }
  dc.send(JSON.stringify({ type: "chunk-end", chunkId }));
}

/** WebRTC 配置 */
export interface IPeerConnectionConfig {
  iceServers?: Array<{
    urls: string | string[];
    username?: string | undefined;
    credential?: string | undefined;
  }>;
  dataChannelLabel?: string | undefined;
}

/** P2P 消息类型 */
export type P2PMessageType =
  | 'move' | 'pass' | 'undo-request' | 'undo-response'
  | 'resign' | 'game-end' | 'state-sync' | 'heartbeat'
  | 'request-count' | 'count-response' | 'count-trigger' | 'count-result';

/** P2P 消息 */
type P2PMessage = IMoveMessage | IPassMessage | IGameEndMessage | {
  type: 'undo-request' | 'undo-response' | 'heartbeat' | 'state-sync' | 'request-count' | 'count-response' | 'count-trigger' | 'count-result';
  [key: string]: unknown;
};

/** P2P 连接回调 */
export interface IPeerConnectionCallbacks {
  onOpen?: () => void;
  onClose?: () => void;
  onData?: (data: P2PMessage) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onError?: (error: Error) => void;
  onIceCandidate?: (candidate: RTCIceCandidateInit) => void;
}

/** ICE 候选 */
export interface RTCIceCandidateInit {
  candidate?: string | undefined;
  sdpMid?: string | null | undefined;
  sdpMLineIndex?: number | null | undefined;
}

/**
 * WebRTC P2P 连接管理器
 * @ai-example
 * const pc = new PeerConnection({ iceServers: [...] });
 * pc.setCallbacks({ onData: (msg) => console.log(msg) });
 * await pc.createOffer();
 */
export class PeerConnection {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private config: IPeerConnectionConfig;
  private callbacks: IPeerConnectionCallbacks = {};

  constructor(config: IPeerConnectionConfig = {}) {
    this.config = {
      iceServers: config.iceServers ?? [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
      dataChannelLabel: config.dataChannelLabel ?? 'game',
    };
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.pc = new RTCPeerConnection({ iceServers: this.config.iceServers as RTCIceServer[] | undefined } as RTCConfiguration);
    this.dataChannel = this.pc.createDataChannel(this.config.dataChannelLabel!);
    this.setupDataChannel();
    this.setupPeerConnection();

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    this.pc = new RTCPeerConnection({ iceServers: this.config.iceServers as RTCIceServer[] | undefined } as RTCConfiguration);
    this.setupPeerConnection();

    await this.pc.setRemoteDescription(offer);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    await this.pc?.setRemoteDescription(answer as globalThis.RTCSessionDescriptionInit);
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    await this.pc?.addIceCandidate(candidate as globalThis.RTCIceCandidateInit);
  }

  send(data: P2PMessage): void {
    if (this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(data));
    }
  }

  setCallbacks(callbacks: IPeerConnectionCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /** 添加 ICE 服务器（在 createOffer/handleOffer 之前调用，确保 TURN 凭证生效） */
  addIceServers(servers: Array<{ urls: string | string[]; username?: string; credential?: string }>): void {
    this.config.iceServers = [...(this.config.iceServers ?? []), ...servers];
  }

  get connectionState(): RTCPeerConnectionState {
    return this.pc?.connectionState ?? 'closed';
  }

  close(): void {
    this.dataChannel?.close();
    this.pc?.close();
    this.dataChannel = null;
    this.pc = null;
  }

  private setupPeerConnection(): void {
    if (!this.pc) return;

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.callbacks.onIceCandidate?.(e.candidate.toJSON());
      }
    };

    this.pc.onconnectionstatechange = () => {
      this.callbacks.onConnectionStateChange?.(this.pc!.connectionState);
    };

    this.pc.ondatachannel = (e) => {
      this.dataChannel = e.channel;
      this.setupDataChannel();
    };
  }

  private setupDataChannel(): void {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => this.callbacks.onOpen?.();
    this.dataChannel.onclose = () => this.callbacks.onClose?.();
    this.dataChannel.onerror = () => this.callbacks.onError?.(new Error('DataChannel 错误'));
    this.dataChannel.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as P2PMessage;
        this.callbacks.onData?.(data);
      } catch {
        this.callbacks.onError?.(new Error('消息解析失败'));
      }
    };
  }
}
