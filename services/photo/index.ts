/**
 * 拍照摆子模块
 * @module services/photo
 *
 * 用 weiqi-photo 从照片还原棋盘矩阵，供记谱页「拍照摆子」使用。
 * 纯前端计算，照片不上传服务器；opencv.js 懒加载，不进主 bundle。
 */

export {
  ensureCv,
  loadPhotoCanvas,
  recognizeRegion,
  recognizePhoto,
  PHOTO_BOARD_SIZE,
  MIN_CROP_SIDE,
} from './PhotoImportService';
export type {
  PhotoBoardResult,
  PhotoProgress,
  PhotoStage,
  CropRect,
} from './PhotoImportService';
