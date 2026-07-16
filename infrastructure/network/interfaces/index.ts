/**
 * 网络层接口统一导出
 * @description 导出所有网络层接口和类型
 */

// 基础类型
export {
  Environment,
  type IEnvironmentDetector,
  type EnvironmentCapabilities
} from './Environment';

export { UserType, UserPermission } from './UserType';

// HTTP 相关接口
export {
  type HttpMethod,
  type ResponseType,
  type IRequestConfig,
  type IRequestInterceptor,
  type IResponseInterceptor
} from './IRequestConfig';

export {
  type IResponse,
  type IResponseWrapper
} from './IResponse';

// WebSocket 接口
export {
  WebSocketReadyState,
  type IWebSocketEvent,
  type IWebSocketOptions,
  type IWebSocket
} from './IWebSocket';

// WebRTC 接口
export {
  type RTCPeerConnectionState,
  type RTCIceConnectionState,
  type RTCIceCandidateInit,
  type RTCSessionDescriptionInit,
  type IWebRTCConfig,
  type IWebRTC
} from './IWebRTC';

// 核心接口
export {
  type INetworkProvider,
  type INetworkProviderConfig
} from './INetworkProvider';

export {
  type IProviderRegistry,
  type IProviderFilter
} from './IProviderRegistry';

// 插件接口
export {
  type INetworkPlugin,
  type IPluginManager,
  type IPluginConfig
} from './INetworkPlugin';

// 用户上下文
export {
  type IUserContext,
  type IUserContextProvider
} from './IUserContext';

// 网络策略
export {
  type INetworkStrategy,
  type INetworkStrategyConfig,
  type IFallbackStrategy
} from './INetworkStrategy';

// 错误类型
export {
  NetworkError,
  TimeoutError,
  NetworkUnreachableError,
  AuthenticationError,
  PermissionError,
  RequestError,
  AllProvidersFailedError
} from './NetworkError';

// Sniffer 相关接口（统一抓包）
export {
  type ISnifferProvider,
  type ISnifferSession
} from './ISnifferProvider';

export {
  type SnifferMessageType,
  type WsMessageData,
  type HttpRequestData,
  type HttpResponseData,
  type SnifferMessage,
  type SnifferOptions,
  type SnifferSession,
  type SnifferResult,
  type SnifferCallbacks
} from './SnifferTypes';
