/**
 * 拍照记谱跨页传递
 * @module clients/web/shared/photo-handoff
 *
 * assistant 页拍照 → 压缩 → 写 sessionStorage → 跳转 recorder → recorder 读取并删除。
 *
 * ⚠️ 为什么必须经过 sessionStorage：拍照的是 assistant 页面，识别摆子的是
 * recorder 页面，两个页面各有自己的 JS 上下文，跳转后内存里的 File 对象就没了。
 * 也曾考虑过 IndexedDB（容量大、无需压缩），但它读写是异步的、且清理不干净会
 * 留垃圾；图片只在两页之间传一次，sessionStorage 关标签页即失效，反而更合适。
 */

/** sessionStorage 键名 */
const HANDOFF_KEY = 'weiqi-bot:photo-handoff';

/**
 * 压缩后的长边上限。
 *
 * 2000 是 weiqi-photo 内部的工作尺寸（`sc = max(w,h)/2000` 参与高斯模糊半径
 * 与霍夫参数的缩放），也是它测试集验证过的取值——再大不会更准，只是更慢。
 * services/photo 里 MAX_SIDE 同样取 2000，这里保持一致，不为了省体积牺牲精度。
 *
 * ⚠️ 但原始照片不能直接存：手机直出 3~10MB，而 sessionStorage 上限通常 5MB，
 * 直接 setItem 会抛 QuotaExceededError。所以必须先压缩——压缩是为了能存下，
 * 不是为了省时间。2000px + JPEG 0.85 实测约 400KB~1.2MB，稳稳放得下。
 */
const MAX_SIDE = 2000;

/** JPEG 质量。0.85 是肉眼无损与体积的平衡点 */
const JPEG_QUALITY = 0.85;

/** 单张图片体积上限（压缩后仍超就放弃，避免把 sessionStorage 撑爆） */
const MAX_BYTES = 4 * 1024 * 1024;

export interface PhotoHandoff {
  /** 压缩后的图片 dataURL（data:image/jpeg;base64,...） */
  readonly dataUrl: string;
  /** 写入时间戳（毫秒） */
  readonly ts: number;
}

/**
 * 把图片文件压成 JPEG dataURL。
 *
 * @param file 用户拍照/选图得到的原始图片
 * @returns dataURL，失败返回 null
 */
export async function compressPhoto(file: File): Promise<string | null> {
  const im = await loadImage(file);
  // 最长边缩到 MAX_SIDE，短边等比；已小于上限则不放大（放大不会更准）
  const s = Math.min(1, MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(im.naturalWidth * s));
  c.height = Math.max(1, Math.round(im.naturalHeight * s));
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', JPEG_QUALITY);
}

/**
 * 写入 handoff 供记谱页取用。
 *
 * @throws 压缩后仍超过 MAX_BYTES，或 sessionStorage 写入失败（容量不足/隐私模式）
 */
export async function writePhotoHandoff(file: File): Promise<void> {
  const dataUrl = await compressPhoto(file);
  if (!dataUrl) throw new Error('图片处理失败');

  // dataURL 里 base64 部分约占 3/4，粗略估算实际字节数即可，不必精确
  const bytes = Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
  if (bytes > MAX_BYTES) {
    throw new Error(`照片太大（${(bytes / 1048576).toFixed(1)}MB），请靠近些重拍`);
  }

  const payload: PhotoHandoff = { dataUrl, ts: Date.now() };
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(payload));
  } catch (e) {
    // 隐私模式下 sessionStorage 不可用，或压缩后仍超出配额
    throw new Error(
      '无法暂存照片（存储空间不足），请改用记谱页内的「拍照摆子」',
      { cause: e },
    );
  }
}

/**
 * 读取并**立即删除** handoff。
 *
 * 为什么读完就删：不做这一步，用户在 recorder 刷新页面或后退再进来，
 * 会把同一张照片再识别一遍并覆盖掉刚手动修正好的摆子。
 *
 * @returns handoff 数据，不存在/已过期/解析失败返回 null
 */
export function takePhotoHandoff(): PhotoHandoff | null {
  let raw: string;
  try {
    const item = sessionStorage.getItem(HANDOFF_KEY);
    if (!item) return null;
    raw = item;
    sessionStorage.removeItem(HANDOFF_KEY); // ⚠️ 先删再解析，解析失败也不留残留
  } catch {
    return null; // 隐私模式下 sessionStorage 不可用
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PhotoHandoff>;
    if (typeof parsed.dataUrl !== 'string' || !parsed.dataUrl.startsWith('data:image/')) {
      return null;
    }
    // 超过 10 分钟的 handoff 视为残留垃圾，不再自动摆子
    if (typeof parsed.ts === 'number' && Date.now() - parsed.ts > 10 * 60 * 1000) {
      return null;
    }
    return { dataUrl: parsed.dataUrl, ts: parsed.ts ?? Date.now() };
  } catch {
    return null;
  }
}

/** 把 dataURL 还原成 Blob（recognizePhoto 收 Blob，也方便走同一条解码路径） */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? 'image/jpeg';
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const im = new Image();
  return new Promise<HTMLImageElement>((resolve, reject) => {
    // ⚠️ 必须 `() => resolve(im)`：直接把 resolve 当 onload 回调时拿到的是 Event，
    //    naturalWidth 为 undefined → 缩放算出 NaN → canvas 尺寸 0 → drawImage 抛错
    im.onload = () => {
      URL.revokeObjectURL(url);
      resolve(im);
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    im.src = url;
  });
}
