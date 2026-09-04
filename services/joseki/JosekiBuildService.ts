import { JosekiBuilder } from '@domain/joseki/JosekiBuilder';
import { findConnectedComponents } from '@domain/joseki/ComponentDetector';

export interface BuildOptions {
  minFreq?: number;
  topK?: number;
  minMoves?: number;
  maxMoves?: number;
}

export class JosekiBuildService {
  async buildFromLatest(options: BuildOptions = {}): Promise<any[]> {
    console.log('🚀 定式库构建 - 简化版');
    
    const builder = new JosekiBuilder();
    
    // 模拟测试数据
    const testSeq = {
      stdCoords: ['pd', 'qc', 'pc', 'qd'],
      winrates: [0.5, 0.51, 0.52, 0.51],
      firstColor: 'B',
    };
    
    builder.addSequence(testSeq);
    
    const result = builder.build(options);
    console.log(`构建完成: ${result.length} 条定式`);
    
    return result;
  }
}
