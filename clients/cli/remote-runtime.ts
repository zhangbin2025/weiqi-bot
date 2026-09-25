import {
  RTCPeerConnection as WeriftRTCPeerConnection,
  RTCSessionDescription as WeriftRTCSessionDescription,
} from 'werift';

import type {
  AnalyzeGameOptions,
  AnalyzeOptions,
  EngineInfo,
  GameTurnAnalysis,
  ModelInfo,
} from '../../../infrastructure/ai/IAIEngine';

interface ITunnelConfig {
  signalingUrl: string;
  password: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitForIceGatheringComplete(pc: any, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const timer = setTimeout(() => resolve(), timeoutMs);
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        resolve();
      }
    };
    try { pc.addEventListener?.('icegatheringstatechange', onChange); } catch { /* ignore */ }
    const prev = pc.onicegatheringstatechange;
    pc.onicegatheringstatechange = (...args: any[]) => {
      if (typeof prev === 'function') prev(...args);
      onChange();
    };
  });
}

/**
 * 自包含的一次性隧道客户端（werift + Node 全局 WebSocket）。
 *
 * 关键机制「让位重试」：
 *   信令服务器把「房间创建方」身份给先连接者。若服务端（TunnelServer）此刻不在房间，
 *   客户端会抢先成为创建方，收到 ready 却永远等不到 room-info（因为没有服务端发 offer）。
 *   此时应断开把房间让回，等待服务端先就位，再作为「加入方」重连，
 *   方能收到 room-info → offer。
 */
class CliTunnel {
  private ws: any = null;
  private pc: any = null;
  private dc: any = null;
  private authed = false;
  private rpcId = 0;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (d: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
  private engineInfo: EngineInfo = { backend: 'remote', modelName: null };

  private gotReady = false;
  private gotRoomInfo = false;
  private _resolveAuth: (() => void) | null = null;
  private _rejectAuth: ((e: Error) => void) | null = null;
  private _resolveRoom: (() => void) | null = null;

  constructor(private cfg: ITunnelConfig, private debug: boolean) {}

  private log(...a: unknown[]): void {
    // 关键连接日志无条件打印（connect 阶段）
    const always = ['连接尝试', '连接成功', 'Signaling OPEN', 'AUTH OK', 'answer 已发送', 'DC OPEN', '收到 room-info', '[sig]']
      .some(k => a.some(v => typeof v === 'string' && v.includes(k)));
    if (this.debug || always) console.error('[review-katago]', ...a);
  }

  private get WS(): any {
    const W = (globalThis as any).WebSocket;
    if (!W) throw new Error('当前 Node 版本无全局 WebSocket，请升级到 Node 22+ 或安装 ws 包');
    return W;
  }

  /**
   * 连接：最多尝试 attempts 次。每次遇到「当了创建方但没 room-info」就断开让位并等待。
   */
  async connect(attempts = 5, waitBetweenMs = 20000): Promise<void> {
    let lastErr: Error = new Error('连接失败');
    for (let i = 1; i <= attempts; i++) {
      this.log(`连接尝试 ${i}/${attempts}`);
      try {
        await this.connectOnce();
        this.log('连接成功');
        return;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        this.log(`尝试 ${i} 失败: ${lastErr.message}`);
        this.teardown();
        if (i < attempts) {
          this.log(`等待 ${Math.round(waitBetweenMs / 1000)}s 让房间释放后重试...`);
          await sleep(waitBetweenMs);
        }
      }
    }
    throw lastErr;
  }

  private connectOnce(): Promise<void> {
    this.gotReady = false;
    this.gotRoomInfo = false;
    this.authed = false;
    const W = this.WS;
    // password 同时作为 room 号和认证密码（与 ITunnelConfig 设计一致）
    this.ws = new W(`${this.cfg.signalingUrl}?room=${encodeURIComponent(this.cfg.password)}`);

    const readyPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('信令连接超时')), 10_000);
      this.ws.onopen = () => { clearTimeout(timer); this.log('Signaling OPEN'); resolve(); };
      this.ws.onerror = () => { clearTimeout(timer); reject(new Error('信令连接错误')); };
      this.ws.onmessage = (ev: any) => this.onSignalMessage(ev.data);
      this.ws.onclose = () => {
        if (!this.authed) {
          this._rejectAuth?.(new Error('信令已断开（服务端未就绪）'));
        }
      };
    });

    return readyPromise.then(() => {
      const authPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('等待服务端 room-info/P2P 超时（服务端可能未就绪）')), 30_000);
        this._resolveAuth = () => { clearTimeout(timeout); resolve(); };
        this._rejectAuth = (e: Error) => { clearTimeout(timeout); reject(e); };
      });
      // 若拿到 ready 却在 4s 内没 room-info → 说明我们当了创建方，服务端缺席，立即断开让位
      const noRoomInfoGuard = new Promise<never>((_, reject) => {
        const t = setInterval(() => {
          if (this.gotRoomInfo || this.authed) { clearInterval(t); return; }
          if (this.gotReady && Date.now() - this.readyAt > 4000) {
            clearInterval(t);
            reject(new Error('本连接成为房间创建方但无服务端响应'));
          }
          if (!this.gotReady && Date.now() - this.openAt > 8000) {
            clearInterval(t);
            reject(new Error('未收到信令 ready'));
          }
        }, 500);
      });
      return Promise.race([authPromise, noRoomInfoGuard]);
    });
  }

  private openAt = Date.now();
  private readyAt = Date.now();

  private async onSignalMessage(data: any): Promise<void> {
    let msg: any;
    try { msg = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf-8')); }
    catch { return; }
    this.log('[sig]', msg.type);
    switch (msg.type) {
      case 'connected':
        if (msg.turn) (this as any)._turn = msg.turn;
        this.openAt = Date.now();
        break;
      case 'ready':
        this.gotReady = true;
        this.readyAt = Date.now();
        break;
      case 'room-info':
        // 服务端在房间内 → 发 join-confirm 让服务端发起 offer
        this.gotRoomInfo = true;
        this.log('收到 room-info，发送 join-confirm');
        this.ws.send(JSON.stringify({ type: 'join-confirm', name: 'tunnel-client' }));
        break;
      case 'offer':
        await this.handleOffer(msg.data);
        break;
      case 'ice':
        if (msg.data && this.pc) {
          try { await this.pc.addIceCandidate(msg.data); } catch (e) { this.log('addIceCandidate error:', (e as Error).message); }
        }
        break;
    }
  }

  private async handleOffer(offer: any): Promise<void> {
    const iceServers: any[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    if ((this as any)._turn) iceServers.push((this as any)._turn);

    const pc = new WeriftRTCPeerConnection({ iceServers });
    this.pc = pc;

    pc.onicecandidate = () => { /* 非 trickle：候选随 answer 一起发 */ };
pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      this.log("P2P state:", state);
      if (state === "failed" || state === "disconnected" || state === "closed") {
        for (const [, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error("P2P 连接断开: " + state));
        }
        this.pending.clear();
        this.authed = false;
      }
    };
    pc.ondatachannel = (e: any) => this.setupDataChannel(e.channel);

    await pc.setRemoteDescription(new WeriftRTCSessionDescription(offer.sdp, offer.type));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGatheringComplete(pc);
    const finalSdp = pc.localDescription?.sdp ?? answer.sdp;
    this.ws.send(JSON.stringify({ type: 'answer', data: { type: 'answer', sdp: finalSdp } }));
    this.log('answer 已发送（非 trickle）');
  }

  private setupDataChannel(dc: any): void {
    this.dc = dc;
    dc.onopen = () => {
      this.log('DC OPEN → auth');
      this.send({ type: 'auth', password: this.cfg.password });
    };
    dc.onmessage = (ev: any) => this.onDataMessage(ev.data);
    dc.onclose = () => {
      this.log("DC CLOSED");
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("数据通道已关闭"));
      }
      this.pending.clear();
      this.authed = false;
    };
    dc.onerror = (e: any) => {
      this.log("DC ERROR:", e?.message ?? e);
    };
  }

  private async onDataMessage(data: any): Promise<void> {
    let msg: any;
    try { msg = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf-8')); }
    catch { return; }
    switch (msg.type) {
      case 'auth-ok':
        this.authed = true;
        this.log('AUTH OK');
        this._resolveAuth?.();
        break;
      case 'auth-fail':
        this._rejectAuth?.(new Error(msg.reason || '密码错误'));
        break;
      case 'rpc-response': {
        const p = this.pending.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error));
          else p.resolve(msg.result);
        }
        break;
      }
      case 'rpc-progress': {
        this.pending.get(msg.id)?.onProgress?.(msg.data);
        break;
      }
      case 'ping':
        this.send({ type: 'pong' });
        break;
    }
  }

  private send(obj: any): void {
    if (this.dc && this.dc.readyState === 'open') {
      this.dc.send(JSON.stringify(obj));
    } else if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  get isConnected(): boolean { return this.authed; }
  getEngineInfo(): EngineInfo { return this.engineInfo; }

  async call(service: string, method: string, params: unknown, onProgress?: (d: unknown) => void, timeoutMs = 1_800_000): Promise<unknown> {
    if (!this.authed) throw new Error('隧道未连接');
    const id = 'rpc-' + Date.now() + '-' + (++this.rpcId);
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('RPC 超时: ' + service + '.' + method));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, onProgress, timer });
    });
    this.send({ type: 'rpc-request', id, service, method, params });
    return promise;
  }

  private teardown(): void {
    // 先移除回调，避免 close 时触发 onconnectionstatechange 打印误导性日志
    if (this.pc) this.pc.onconnectionstatechange = null;
    try { this.dc?.close?.(); } catch { /* ignore */ }
    try { this.pc?.close?.(); } catch { /* ignore */ }
    try { this.ws?.close?.(); } catch { /* ignore */ }
    this.dc = null; this.pc = null; this.ws = null;
    this.authed = false;
  }

  disconnect(): void { this.teardown(); }
}

/**
 * 自包含的远程 KataGo 引擎（IAIEngine 的远程子集）。
 */
export class CliRemoteKataGoEngine {
  private tunnel: CliTunnel;

  constructor(signalingUrl: string, password: string, debug = false) {
    this.tunnel = new CliTunnel({ signalingUrl, password }, debug);
  }

  async connect(): Promise<void> {
    await this.tunnel.connect();
    try {
      const info = (await this.tunnel.call('katago', 'getEngineInfo', undefined)) as EngineInfo;
      if (info) (this.tunnel as any).engineInfo = info;
    } catch {
      /* ignore */
    }
  }

  /** AIController 调 engine.init(options)，远程模式：连接 + 确保服务端引擎就绪 */
  async init(_options?: any): Promise<void> {
    if (!this.tunnel.isConnected) {
      await this.connect();
    }
    // 检查服务端引擎是否已初始化
    let info = this.tunnel.getEngineInfo();
    if (info.modelName) {
      // 服务端已有模型，直接用
      return;
    }
    // 服务端未加载模型，先查服务端可用模型列表
    const models = (await this.tunnel.call("katago", "listModels", undefined)) as ModelInfo[];
    // 优先选服务端当前选中的模型，其次默认模型，再退到第一个
    const chosen = models.find(m => m.isCurrent) ?? models.find(m => m.isDefault) ?? models[0];
    if (!chosen) {
      throw new Error("服务端无可用模型");
    }
    const modelUrl = chosen.url ?? `/models/${chosen.id}.bin.gz`;
    if (this.debug) console.error(`[review-katago] 服务端引擎未初始化，发送 init RPC, model=${chosen.id} url=${modelUrl}`);
    await this.tunnel.call("katago", "init", { modelUrl }, undefined, 600_000);
    // 重新从服务端拉取引擎信息
    const fresh = (await this.tunnel.call("katago", "getEngineInfo", undefined)) as EngineInfo;
    if (fresh) (this.tunnel as any).engineInfo = fresh;
    info = this.tunnel.getEngineInfo();
    if (this.debug) console.error("[review-katago] 服务端引擎就绪:", JSON.stringify(info));
  }

  getEngineInfo(): EngineInfo { return this.tunnel.getEngineInfo(); }

  async analyzeGame(options: AnalyzeGameOptions): Promise<GameTurnAnalysis[]> {
    const serializable: any = { ...options };
    delete serializable.onResultProgress;
    return (await this.tunnel.call(
      'katago',
      'analyzeGame',
      serializable,
      (data: unknown) => {
        const d = data as { current: number; total: number };
        options.onResultProgress?.(d.current, d.total);
      },
      1_800_000,
    )) as GameTurnAnalysis[];
  }

  async analyze(options: AnalyzeOptions): Promise<any> {
    const serializable: any = { ...options };
    delete serializable.onProgress;
    return this.tunnel.call('katago', 'analyze', serializable, undefined, 600_000);
  }

  async evaluate(options: any): Promise<any> { return this.tunnel.call('katago', 'evaluate', options); }
  async evaluateBatch(options: any): Promise<any[]> { return this.tunnel.call('katago', 'evaluateBatch', options) as Promise<any[]>; }
  async listModels(): Promise<ModelInfo[]> { return (await this.tunnel.call('katago', 'listModels', undefined)) as ModelInfo[]; }

  disconnect(): void { this.tunnel.disconnect(); }
}
