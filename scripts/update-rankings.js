#!/usr/bin/env node
/**
 * @fileoverview 更新月度榜单数据
 * @description 一键完成：下载 → 精简 → 压缩
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// 配置
// ============================================

const YEYUWEIQI_URLS = {
  BASE: 'https://yeyuweiqi.cn',
  RANKINGS_DIR: '/rankings/月度榜单',
  RANKINGS_FILE: '月度榜单_{{year}}_{{month}}.json',
};

const OUTPUT_DIR = path.join(__dirname, '../clients/web/shared/assets/data/rankings');

// ============================================
// 工具函数
// ============================================

function getRankingsUrl(year, month) {
  const filename = YEYUWEIQI_URLS.RANKINGS_FILE
    .replace('{{year}}', String(year))
    .replace('{{month}}', String(month));
  return `${YEYUWEIQI_URLS.BASE}${YEYUWEIQI_URLS.RANKINGS_DIR}/${filename}`;
}

function getSnapshotCandidates(n = 3) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const candidates = [];

  for (let i = 0; i < n; i++) {
    let m = month - i - 1;
    let y = year;
    if (m <= 0) {
      m += 12;
      y -= 1;
    }
    candidates.push({
      url: getRankingsUrl(y, m),
      filename: `月度榜单_${y}_${m}.json`,
      year: y,
      month: m,
    });
  }

  return candidates;
}

// ============================================
// 步骤 1: 下载
// ============================================

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': YEYUWEIQI_URLS.BASE,
      }
    }, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        const redirectUrl = response.headers.location;
        https.get(redirectUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': YEYUWEIQI_URLS.BASE,
          }
        }, (redirectResponse) => {
          redirectResponse.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve(true);
          });
        }).on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      } else if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(true);
        });
      } else {
        fs.unlink(destPath, () => {});
        resolve(false);
      }
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function downloadRankings(outputDir, force) {
  console.log(`\n📥 步骤 1/3: 下载榜单数据\n`);
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const candidates = getSnapshotCandidates(3);
  const downloaded = [];

  for (const candidate of candidates) {
    const destPath = path.join(outputDir, candidate.filename);
    
    if (!force && fs.existsSync(destPath)) {
      console.log(`⏭️  已存在: ${candidate.filename}`);
      downloaded.push({ ...candidate, path: destPath });
      continue;
    }

    console.log(`⬇️  下载: ${candidate.url}`);
    
    try {
      const success = await downloadFile(candidate.url, destPath);
      if (success) {
        const stats = fs.statSync(destPath);
        const sizeKB = (stats.size / 1024).toFixed(2);
        console.log(`✅ 成功: ${candidate.filename} (${sizeKB} KB)\n`);
        downloaded.push({ ...candidate, path: destPath });
      } else {
        console.log(`❌ 失败: ${candidate.filename} (文件不存在)\n`);
      }
    } catch (error) {
      console.log(`❌ 错误: ${candidate.filename} - ${error.message}\n`);
    }
  }

  return downloaded;
}

// ============================================
// 步骤 2: 精简
// ============================================

function slimPlayer(player) {
  const slim = {
    姓名: player.姓名,
    段位: player.段位,
  };

  if (player.等级分 !== undefined) slim.等级分 = player.等级分;
  if (player.全国排名 !== undefined) slim.全国排名 = player.全国排名;
  if (player.省区排名 !== undefined) slim.省区排名 = player.省区排名;
  if (player.本市排名 !== undefined) slim.本市排名 = player.本市排名;
  if (player.省区) slim.省区 = player.省区;
  if (player.城市) slim.城市 = player.城市;
  if (player.性别) slim.性别 = player.性别;
  if (player.出生) slim.出生 = player.出生;

  return slim;
}

async function slimRankings(downloaded) {
  console.log(`🔧 步骤 2/3: 精简数据\n`);

  for (const item of downloaded) {
    const originalData = JSON.parse(fs.readFileSync(item.path, 'utf-8'));
    const slimData = originalData.map(slimPlayer);
    fs.writeFileSync(item.path, JSON.stringify(slimData), 'utf-8');
    
    const sizeKB = (fs.statSync(item.path).size / 1024).toFixed(2);
    console.log(`✅ ${item.filename} (${sizeKB} KB)`);
  }
}

// ============================================
// 步骤 3: 压缩
// ============================================

async function gzipRankings(downloaded) {
  console.log(`\n📦 步骤 3/3: 压缩数据\n`);

  for (const item of downloaded) {
    const gzipPath = `${item.path}.gz`;
    
    await pipeline(
      fs.createReadStream(item.path),
      createGzip(),
      fs.createWriteStream(gzipPath)
    );

    const originalSize = fs.statSync(item.path).size;
    const gzipSize = fs.statSync(gzipPath).size;
    const reduction = ((1 - gzipSize / originalSize) * 100).toFixed(1);

    console.log(`✅ ${item.filename}.gz`);
    console.log(`   原始: ${(originalSize / 1024).toFixed(2)} KB`);
    console.log(`   压缩: ${(gzipSize / 1024).toFixed(2)} KB`);
    console.log(`   减少: ${reduction}%\n`);

    // 删除原始 JSON 文件
    fs.unlinkSync(item.path);
  }
}

// ============================================
// 主函数
// ============================================

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force') || args.includes('-f');

  console.log(`\n🔄 更新月度榜单数据`);
  console.log(`📁 输出目录: ${OUTPUT_DIR}\n`);

  // 步骤 1: 下载
  const downloaded = await downloadRankings(OUTPUT_DIR, force);

  if (downloaded.length === 0) {
    console.log(`\n❌ 没有下载任何文件\n`);
    process.exit(1);
  }

  // 步骤 2: 精简
  await slimRankings(downloaded);

  // 步骤 3: 压缩
  await gzipRankings(downloaded);

  console.log(`\n✅ 更新完成！\n`);
}

main().catch(console.error);
