/**
 * 设计 Token
 * 供非 Web 平台使用的设计变量
 * @module presentation/core/styles/tokens
 */
/**
 * 设计 Token 定义
 */
export const tokens = {
  colors: {
    primary: '#667eea',
    primaryDark: '#5568d3',
    primaryLight: '#8b9cf5',
    secondary: '#764ba2',
    text: '#333333',
    textSecondary: '#666666',
    textHint: '#999999',
    textInverse: '#ffffff',
    bg: '#f5f5f5',
    bgCard: '#ffffff',
    bgOverlay: 'rgba(0, 0, 0, 0.5)',
    border: '#e0e0e0',
    borderFocus: '#667eea',
    success: '#4caf50',
    warning: '#ff9800',
    error: '#f44336',
    info: '#2196f3',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  radius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    full: 24,
  },
  fontSize: {
    xs: 11,
    sm: 12,
    md: 14,
    lg: 16,
    xl: 20,
    xxl: 24,
  },
  shadows: {
    sm: '0 2px 4px rgba(0, 0, 0, 0.1)',
    md: '0 4px 8px rgba(0, 0, 0, 0.15)',
    lg: '0 8px 16px rgba(0, 0, 0, 0.2)',
    xl: '0 20px 60px rgba(0, 0, 0, 0.3)',
  },
  transitions: {
    fast: '0.15s ease',
    normal: '0.3s ease',
    slow: '0.5s ease',
  },
} as const;
export type Tokens = typeof tokens;
