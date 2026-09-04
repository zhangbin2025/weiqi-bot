import { CountMinSketch } from '../CMS';

describe('CountMinSketch', () => {
  test('基本统计功能', () => {
    const cms = new CountMinSketch(1000, 3);
    
    cms.update('item1', 10);
    cms.update('item2', 5);
    cms.update('item1', 3);
    
    expect(cms.estimate('item1')).toBeGreaterThanOrEqual(13);
    expect(cms.estimate('item2')).toBeGreaterThanOrEqual(5);
    expect(cms.estimate('item3')).toBeGreaterThanOrEqual(0);
    expect(cms.getSize()).toBe(18);
  });

  test('序列化和反序列化', () => {
    const cms = new CountMinSketch(1000, 3);
    cms.update('item1', 10);
    cms.update('item2', 5);
    
    const json = cms.toJSON();
    const restored = CountMinSketch.fromJSON(json);
    
    expect(restored.estimate('item1')).toBeGreaterThanOrEqual(10);
    expect(restored.estimate('item2')).toBeGreaterThanOrEqual(5);
    expect(restored.getSize()).toBe(15);
  });

  test('大量数据统计', () => {
    const cms = new CountMinSketch(10000, 5);
    
    // 插入不同的 item
    for (let i = 0; i < 100; i++) {
      cms.update(\`item_\${i}\`, i + 1);
    }
    
    // 验证前几个 item 的估计值
    expect(cms.estimate('item_0')).toBeGreaterThanOrEqual(1);
    expect(cms.estimate('item_10')).toBeGreaterThanOrEqual(11);
    expect(cms.getSize()).toBe(5050); // 1+2+...+100
  });

  test('清空功能', () => {
    const cms = new CountMinSketch(1000, 3);
    cms.update('item1', 10);
    expect(cms.getSize()).toBe(10);
    
    cms.clear();
    expect(cms.estimate('item1')).toBe(0);
    expect(cms.getSize()).toBe(0);
  });
});
