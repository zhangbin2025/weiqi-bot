/**
 * 拍照摆子模块
 * @module services/photo
 *
 * 用 weiqi-photo 从照片还原棋盘矩阵，供记谱页「拍照摆子」使用。
 * 纯前端计算，照片不上传服务器；ONNX Runtime Web 走 CDN，模型懒加载。
 */

export {
  ensureOnnxModel,
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