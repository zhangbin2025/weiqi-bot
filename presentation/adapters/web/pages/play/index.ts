/**
 * 对弈页面导出
 * @module presentation/pages/play
 */
export { PlayIndexPage, type PlayIndexPageConfig } from './PlayIndexPage';
export { HMPlayPage, type HMPlayPageConfig } from './HMPlayPage';
export { HHPlayPage, type HHPlayPageConfig } from './HHPlayPage';
export { MMPlayPage, type MMPlayPageConfig } from './MMPlayPage';
export { PlayHistoryPage, type PlayHistoryPageConfig } from './PlayHistoryPage';
export { HHRoomManager, type RoomCreateResult } from './HHRoomManager';
export { renderPlayState, renderSituation, type PlayState } from './HMPlayRenderer';
export { renderHHState, renderStatus, updateButtons, type HHRenderState } from './HHPlayRenderer';
export { renderMMState, type MMPlayState } from './MMPlayRenderer';