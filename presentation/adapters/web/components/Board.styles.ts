/**
 * 棋盘样式配置
 * @module presentation/adapters/web/components/Board.styles
 */
/** 颜色配置 */
export const BoardStyles = {
  colors: {
    classic: {
      bg: '#E3C16F',      // 棋盘背景色（匹配 demo）
      line: '#666',       // 网格线颜色
      star: '#333',       // 星位颜色
    },
    wooden: {
      bg: '#DCB35C',
      line: '#8B7355',
      star: '#333',
    },
    modern: {
      bg: '#C4A76C',
      line: '#5A5A5A',
      star: '#333',
    },
  },
  stones: {
    black: {
      light: '#666',
      dark: '#000',
      border: '#000',
    },
    white: {
      light: '#fff',
      dark: '#ccc',
      border: '#999',
    },
  },
  highlights: {
    last: 'rgba(255, 255, 255, 0.8)',
    selected: 'rgba(66, 133, 244, 0.5)',
    candidate: 'rgba(255, 152, 0, 0.5)',
  },
  /** 星位坐标 */
  starPoints: {
    9: [[2, 2], [2, 6], [4, 4], [6, 2], [6, 6]],
    13: [[3, 3], [3, 9], [6, 6], [9, 3], [9, 9]],
    19: [[3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15]],
  } as Record<number, [number, number][]>,
};
