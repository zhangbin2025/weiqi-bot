/**
 * 分组选择策略
 * @description 根据分组名称计算优先级，选择默认分组
 * 优先级：公开 > 精英 > 中学 > 少年 > 儿童
 * 段位：5段 > 4段 > ... > 1级 > 2级 > ...
 */
export class GroupSelector {
  /** 计算分组优先级分数（越高越优先） */
  static getPriority(groupName: string): number {
    if (!groupName) return 0;
    const name = groupName.toLowerCase();

    // 组别优先级（权重50000）
    const groupTypes: Record<string, number> = {
      '公开': 50000, 'open': 50000,
      '精英': 40000, 'elite': 40000,
      '中学': 30000, 'middle': 30000, '高中': 30000,
      '少年': 20000, 'youth': 20000, '青少年': 20000,
      '儿童': 10000, 'child': 10000, '少儿': 10000, '幼儿': 5000,
    };

    // 段位优先级（权重100）
    const danLevels: Record<string, number> = {
      '9段': 990, '8段': 890, '7段': 790, '6段': 690,
      '5段': 590, '五段': 590, '业余5段': 590,
      '4段': 490, '四段': 490, '业余4段': 490,
      '3段': 390, '三段': 390, '业余3段': 390,
      '2段': 290, '二段': 290, '业余2段': 290,
      '1段': 190, '初段': 190, '业余1段': 190,
      '定段': 150, '定段组': 150,
    };

    let score = 0;
    for (const [key, value] of Object.entries(groupTypes)) {
      if (name.includes(key)) score = Math.max(score, value);
    }
    for (const [key, value] of Object.entries(danLevels)) {
      if (name.includes(key)) score += value;
    }
    // 级位匹配
    const kyuMatch = name.match(/(\d+)级/);
    if (kyuMatch?.[1]) score += Math.max(0, 100 - parseInt(kyuMatch[1], 10));

    // 无特殊关键字：最低优先级
    if (score === 0) score = 1;
    return score;
  }

  /** 按优先级从高到低排序分组（强→弱） */
  static sortByPriority<T extends { name: string }>(groups: T[]): T[] {
    return [...groups].sort((a, b) => GroupSelector.getPriority(b.name) - GroupSelector.getPriority(a.name));
  }

  /** 从分组列表中选择默认分组（优先级最高的） */
  static selectDefault<T extends { name: string }>(groups: T[]): T | undefined {
    if (!groups.length) return undefined;
    return GroupSelector.sortByPriority(groups)[0];
  }
}
