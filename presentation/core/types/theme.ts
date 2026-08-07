/**
 * 主题类型定义
 * @module presentation/core/types/theme
 */
/**
 * 主题模式
 */
export type ThemeMode = 'light' | 'dark' | 'system';
/**
 * 颜色定义
 */
export interface ThemeColors {
  primary: string;
  primaryDark: string;
  primaryLight: string;
  secondary: string;
  text: string;
  textSecondary: string;
  textHint: string;
  textInverse: string;
  bg: string;
  bgCard: string;
  bgOverlay: string;
  border: string;
  borderFocus: string;
  success: string;
  warning: string;
  error: string;
  info: string;
}
/**
 * 间距定义
 */
export interface ThemeSpacing {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}
/**
 * 圆角定义
 */
export interface ThemeRadius {
  sm: number;
  md: number;
  lg: number;
  xl: number;
  full: number;
}
/**
 * 字体大小定义
 */
export interface ThemeFontSize {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
}
/**
 * 阴影定义
 */
export interface ThemeShadows {
  sm: string;
  md: string;
  lg: string;
  xl: string;
}
/**
 * 完整主题定义
 */
export interface Theme {
  mode: ThemeMode;
  colors: ThemeColors;
  spacing: ThemeSpacing;
  radius: ThemeRadius;
  fontSize: ThemeFontSize;
  shadows: ThemeShadows;
}
/**
 * 主题配置
 */
export interface ThemeConfig {
  mode?: ThemeMode;
  overrides?: Partial<Theme>;
}
