/**
 * @fileoverview 真人对弈服务测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HHPlayService } from '../HHPlayService';
import { SignalingClient } from '../SignalingClient';
import { PeerConnection } from '../PeerConnection';
import { Game } from '../../../../domain';
import type { IHHPlayCallbacks, PlayerColor } from '../types';
import type { IConfigProvider } from '../../../infrastructure/config/interfaces/IConfigProvider';

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    setTimeout(() => this.onopen?.(), 0);
  }

  send(data: string): void {}
  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

// Mock RTCPeerConnection
class MockRTCPeerConnection {
  connectionState: RTCPeerConnectionState = 'connected';
  localDescription: RTCSessionDescription | null = null;
  onicecandidate: ((e: RTCIceCandidateEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((e: RTCDataChannelEvent) => void) | null = null;

  async createOffer() {
    return { type: 'offer' as const, sdp: 'offer-sdp' };
  }

  async createAnswer() {
    return { type: 'answer' as const, sdp: 'answer-sdp' };
  }

  async setLocalDescription(desc: any) {
    this.localDescription = desc as RTCSessionDescription;
  }

  async setRemoteDescription(desc: any) {}

  async addIceCandidate(candidate: any) {}

  createDataChannel(label: string) {
    return {
      readyState: 'open',
      onopen: null as (() => void) | null,
      onclose: null as (() => void) | null,
      onmessage: null as ((e: MessageEvent) => void) | null,
      send: vi.fn(),
      close: vi.fn(),
    } as unknown as RTCDataChannel;
  }

  close() {
    this.connectionState = 'closed';
  }
}

// Setup globals
(global as any).WebSocket = MockWebSocket;
(global as any).RTCPeerConnection = MockRTCPeerConnection;

/** 创建 Mock ConfigProvider */
function createMockConfigProvider(): IConfigProvider {
  return {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    getModuleConfig: vi.fn().mockResolvedValue({
      signalingUrl: 'wss://test.com/signal',
      defaultTimeLimit: 30,
      defaultHandicap: 0,
      soundEnabled: true,
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    }),
    setModuleConfig: vi.fn().mockResolvedValue(undefined),
    onChange: vi.fn().mockReturnValue(() => {}),
    reset: vi.fn().mockResolvedValue(undefined),
    has: vi.fn().mockResolvedValue(false),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

describe('HHPlayService', () => {
  let service: HHPlayService;
  let callbacks: IHHPlayCallbacks;
  let game: Game;

  beforeEach(() => {
    game = new Game();
    service = new HHPlayService(game, createMockConfigProvider());
    callbacks = {
      onRoomCreated: vi.fn(),
      onPlayerJoined: vi.fn(),
      onMove: vi.fn(),
      onPass: vi.fn(),
      onTimeUpdate: vi.fn(),
      onGameEnd: vi.fn(),
      onOpponentDisconnected: vi.fn(),
      onError: vi.fn(),
    };
    service.setCallbacks(callbacks);
  });

  describe('createRoom', () => {
    it('should create room and return room info', async () => {
      const room = await service.createRoom('玩家A', { timeLimit: 30 });

      expect(room.id).toHaveLength(6);
      expect(room.creatorName).toBe('玩家A');
      expect(room.timeLimit).toBe(30);
    });
  });

  describe('getState', () => {
    it('should return initial state', () => {
      const state = service.getState();

      expect(state.room).toBeNull();
      expect(state.me).toBeNull();
      expect(state.opponent).toBeNull();
      expect(state.currentPlayer).toBe('black');
      expect(state.inGame).toBe(false);
    });
  });

  describe('leaveRoom', () => {
    it('should reset game state', async () => {
      await service.createRoom('玩家A', { timeLimit: 30 });
      await service.leaveRoom();

      const state = service.getState();
      expect(state.room).toBeNull();
      expect(state.inGame).toBe(false);
    });
  });

  describe('getMoveHistory', () => {
    it('should return move history from state', async () => {
      await service.createRoom('玩家A', { timeLimit: 30 });
      game.placeStone(3, 3); // 黑棋落子
      game.placeStone(15, 15); // 白棋落子

      const history = service.getMoveHistory();
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({ x: 3, y: 3, color: 'black' });
      expect(history[1]).toEqual({ x: 15, y: 15, color: 'white' });
    });

    it('should return empty array when no moves', async () => {
      await service.createRoom('玩家A', { timeLimit: 30 });
      const history = service.getMoveHistory();
      expect(history).toEqual([]);
    });
  });

  describe('exportSgf', () => {
    it('should generate SGF with default metadata', async () => {
      await service.createRoom('玩家A', { timeLimit: 30 });
      game.placeStone(3, 3);
      game.placeStone(15, 15);

      const sgf = service.exportSgf();
      expect(sgf).toContain('PB[玩家A]');
      expect(sgf).toContain('PW[白方]');
      expect(sgf).toContain('SZ[19]');
      expect(sgf).toContain(';B[dd]');
      expect(sgf).toContain(';W[pp]');
    });

    it('should generate SGF with custom metadata', async () => {
      await service.createRoom('玩家A', { timeLimit: 30 });
      game.placeStone(3, 3);

      const sgf = service.exportSgf({
        blackName: '柯洁',
        whiteName: 'AlphaGo',
        result: 'B+R',
      });

      expect(sgf).toContain('PB[柯洁]');
      expect(sgf).toContain('PW[AlphaGo]');
      expect(sgf).toContain('RE[B+R]');
    });

    it('should handle empty move history', async () => {
      await service.createRoom('玩家A', { timeLimit: 30 });
      const sgf = service.exportSgf();

      expect(sgf).toContain('PB[玩家A]');
      expect(sgf).toContain('PW[白方]');
      expect(sgf).toContain('SZ[19]');
    });
  });
});

describe('SignalingClient', () => {
  let client: SignalingClient;

  beforeEach(() => {
    client = new SignalingClient({ url: 'wss://test.com/signal' });
  });

  it('should connect and call onConnect callback', async () => {
    const onConnect = vi.fn();
    client.setCallbacks({ onConnect });

    await client.connect('ROOM123');

    expect(onConnect).toHaveBeenCalled();
    expect(client.isConnected).toBe(true);
  });

  it('should send message when connected', async () => {
    await client.connect('ROOM123');

    expect(() => client.send({ type: 'ping' })).not.toThrow();
  });

  it('should disconnect properly', async () => {
    await client.connect('ROOM123');
    client.disconnect();

    expect(client.isConnected).toBe(false);
  });
});

describe('PeerConnection', () => {
  let pc: PeerConnection;

  beforeEach(() => {
    pc = new PeerConnection();
  });

  it('should create offer', async () => {
    const offer = await pc.createOffer();

    expect(offer.type).toBe('offer');
  });

  it('should handle offer and create answer', async () => {
    const offer = { type: 'offer' as const, sdp: 'offer-sdp' };
    const answer = await pc.handleOffer(offer);

    expect(answer.type).toBe('answer');
  });

  it('should close connection', async () => {
    await pc.createOffer();
    pc.close();

    expect(pc.connectionState).toBe('closed');
  });
});

describe('TimeController', () => {
  it('should track time correctly', async () => {
    const { TimeController } = await import('../TimeController');
    const timer = new TimeController({ timeLimit: 30, interval: 100 });

    const times = timer.getTimes();
    expect(times.blackTime).toBe(30 * 60);
    expect(times.whiteTime).toBe(30 * 60);
  });

  it('should switch player', async () => {
    const { TimeController } = await import('../TimeController');
    const timer = new TimeController({ timeLimit: 30, interval: 100 });

    timer.switchPlayer('white');
    expect(timer.currentPlayerTime).toBe(30 * 60);
  });
});

describe('RoomManager', () => {
  it('should create room', async () => {
    const { RoomManager } = await import('../RoomManager');
    const manager = new RoomManager();

    const room = manager.createRoom('玩家A', { timeLimit: 30 }, 'black');

    expect(room.creatorName).toBe('玩家A');
    expect(room.creatorColor).toBe('black');
  });

  it('should join room', async () => {
    const { RoomManager } = await import('../RoomManager');
    const manager = new RoomManager();

    const playerInfo = manager.joinRoom('ROOM123', '玩家B', {
      creatorName: '玩家A',
      creatorColor: 'black',
      timeLimit: 30,
    });

    expect(playerInfo.name).toBe('玩家B');
    expect(playerInfo.color).toBe('white');
    expect(playerInfo.isCreator).toBe(false);
  });
});