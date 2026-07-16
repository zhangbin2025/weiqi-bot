/**
 * 实体验证器
 * @module domain/intent/EntityValidator
 * 
 * 提供统一的实体验证逻辑，包括：
 * - 姓名验证（百家姓）
 * - SGF 内容验证
 * - URL 验证
 * - taskId 验证
 * - 野狐昵称验证
 */

/**
 * 百家姓列表（常见姓氏）
 */
export const SURNAMES = [
  // 单姓
  '赵', '钱', '孙', '李', '周', '吴', '郑', '王', '冯', '陈', '褚', '卫', '蒋', '沈', '韩', '杨',
  '朱', '秦', '尤', '许', '何', '吕', '施', '张', '孔', '曹', '严', '华', '金', '魏', '陶', '姜',
  '戚', '谢', '邹', '喻', '柏', '水', '窦', '章', '云', '苏', '潘', '葛', '奚', '范', '彭', '郎',
  '鲁', '韦', '昌', '马', '苗', '凤', '花', '方', '俞', '任', '袁', '柳', '酆', '鲍', '史', '唐',
  '费', '廉', '岑', '薛', '雷', '贺', '倪', '汤', '滕', '殷', '罗', '毕', '郝', '邬', '安', '常',
  '乐', '于', '时', '傅', '皮', '卞', '齐', '康', '伍', '余', '元', '卜', '顾', '孟', '平', '黄',
  '和', '穆', '萧', '尹', '姚', '邵', '湛', '汪', '祁', '毛', '禹', '狄', '米', '贝', '明', '臧',
  '计', '伏', '成', '戴', '谈', '宋', '茅', '庞', '熊', '纪', '舒', '屈', '项', '祝', '董', '梁',
  '杜', '阮', '蓝', '闵', '席', '季', '麻', '强', '贾', '路', '娄', '江', '童', '颜', '郭', '梅',
  '盛', '林', '刁', '钟', '徐', '邱', '骆', '高', '夏', '蔡', '田', '樊', '胡', '凌', '霍', '虞',
  '万', '支', '柯', '昝', '管', '卢', '莫', '经', '房', '裘', '缪', '干', '解', '应', '宗', '丁',
  '宣', '邓', '郁', '单', '杭', '洪', '包', '诸', '左', '石', '崔', '吉', '钮', '龚', '程', '嵇',
  '邢', '滑', '裴', '陆', '荣', '翁', '荀', '羊', '甄', '家', '封', '芮', '羿', '储', '靳', '汲',
  '邴', '糜', '松', '井', '段', '富', '巫', '乌', '焦', '巴', '弓', '牧', '隗', '山', '谷', '车',
  '侯', '宓', '蓬', '全', '郗', '班', '仰', '秋', '仲', '伊', '宫', '宁', '仇', '栾', '暴', '甘',
  '钭', '厉', '戎', '祖', '武', '符', '刘', '景', '詹', '束', '龙', '叶', '幸', '司', '韶', '郜',
  '黎', '蓟', '溥', '印', '宿', '白', '怀', '蒲', '邰', '从', '鄂', '索', '咸', '籍', '赖', '卓',
  '蔺', '屠', '蒙', '池', '乔', '阴', '郁', '胥', '能', '苍', '双', '闻', '莘', '党', '翟', '谭',
  '贡', '劳', '逄', '姬', '申', '扶', '堵', '冉', '宰', '郦', '雍', '却', '璩', '桑', '桂', '濮',
  '牛', '寿', '通', '边', '扈', '燕', '冀', '浦', '尚', '农', '温', '别', '庄', '晏', '柴', '瞿',
  '阎', '充', '慕', '连', '茹', '习', '宦', '艾', '鱼', '容', '向', '古', '易', '慎', '戈', '廖',
  '庾', '终', '暨', '居', '衡', '步', '都', '耿', '满', '弘', '匡', '国', '文', '寇', '广', '禄',
  '阙', '东', '欧', '殳', '沃', '利', '蔚', '越', '夔', '隆', '师', '巩', '厍', '聂', '晁', '勾',
  '敖', '融', '冷', '訾', '辛', '阚', '那', '简', '饶', '空', '曾', '毋', '沙', '乜', '养', '鞠',
  '须', '丰', '巢', '关', '蒯', '相', '查', '后', '荆', '红', '游', '竺', '权', '逯', '盖', '益',
  '桓', '公', '佟',
  // 复姓
  '万俟', '司马', '上官', '欧阳', '夏侯', '诸葛', '闻人', '东方', '赫连', '皇甫', '尉迟',
  '公羊', '澹台', '公冶', '宗政', '濮阳', '淳于', '单于', '太叔', '申屠', '公孙', '仲孙', '轩辕',
  '令狐', '钟离', '宇文', '长孙', '慕容', '鲜于', '闾丘', '司徒', '司空', '亓官', '司寇', '仉',
  '督', '子车', '颛孙', '端木', '巫马', '公西', '漆雕', '乐正', '壤驷', '公良', '拓跋', '夹谷',
  '宰父', '谷梁', '晋', '楚', '闫', '法', '汝', '鄢', '涂', '钦', '段干', '百里', '东郭', '南门',
  '呼延', '归海', '羊舌', '微生', '岳', '帅', '缑', '亢', '况', '郈', '有', '琴', '梁丘', '左丘',
  '东门', '西门', '商', '牟', '佘', '佴', '伯', '赏', '南宫', '墨', '哈', '谯', '笪', '年', '爱',
  '阳',
];

/**
 * 黑名单：常见动词/关键词（不是姓名）
 */
export const PLAYER_BLACKLIST = [
  '查询', '分析', '下载', '复盘', '记谱', '定式', '赛事', '比赛', '对弈', '下棋',
  '做题', '答题', '打谱', '回放', '帮助', '搜索', '研究', '挖掘', '发现', '探索',
  '学习', '人机', '真人', '观摩', '练习', '恶手', '选点', '决策', '生成', '记录',
  '录入', '刷题', '棋手', '对手', '玩家', '选手',
];

/**
 * URL 正则
 */
export const URL_REGEX = /(https?:\/\/[^\s]+)/gi;

/**
 * SGF 内容正则
 * 以 ( 开头，后跟 ; （中间可有空白/换行）
 * 标准格式 (;GM[1]，变体 (\n;GM[1]
 */
export const SGF_REGEX = /^\s*\(\s*;/;

/**
 * taskId 正则
 * 格式：task_数字_字母数字
 */
export const TASK_ID_REGEX = /task_\d+_[0-9a-f]+/;

/**
 * 实体验证器类
 */
export class EntityValidator {
  /**
   * 验证是否是真实姓名（百家姓 + 名）
   * @param name 待验证的姓名
   * @returns 是否是有效的棋手姓名
   */
  static isValidPlayerName(name: string): boolean {
    // 检查黑名单
    if (PLAYER_BLACKLIST.some(k => name.includes(k))) {
      return false;
    }
    
    // 检查长度：2-4个汉字
    if (name.length < 2 || name.length > 4) {
      return false;
    }
    
    // 检查是否全是汉字
    if (!/^[\u4e00-\u9fa5]+$/.test(name)) {
      return false;
    }
    
    // 尝试匹配单姓 + 名
    for (const surname of SURNAMES) {
      if (surname.length === 1 && name.startsWith(surname)) {
        const namePart = name.substring(1);
        if (namePart.length >= 1 && namePart.length <= 2) {
          return true;
        }
      }
    }
    
    // 尝试匹配复姓 + 名
    for (const surname of SURNAMES) {
      if (surname.length === 2 && name.startsWith(surname)) {
        const namePart = name.substring(2);
        if (namePart.length >= 1 && namePart.length <= 2) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * 验证是否是 SGF 内容
   * @param text 待验证的文本
   * @returns 是否是 SGF 内容
   */
  static isSgf(text: string): boolean {
    return SGF_REGEX.test(text);
  }

  /**
   * 验证是否是 URL
   * @param text 待验证的文本
   * @returns 是否是 URL
   */
  static isUrl(text: string): boolean {
    return URL_REGEX.test(text);
  }

  /**
   * 验证是否是 taskId 格式
   * @param text 待验证的文本
   * @returns 是否是 taskId
   */
  static isTaskId(text: string): boolean {
    return TASK_ID_REGEX.test(text);
  }

  /**
   * 从文本中提取 URL
   * @param text 文本内容
   * @returns 提取到的 URL，如果没有则返回 null
   */
  static extractUrl(text: string): string | null {
    const match = text.match(URL_REGEX);
    return match ? match[0] : null;
  }

  /**
   * 从文本中提取 taskId
   * @param text 文本内容
   * @returns 提取到的 taskId，如果没有则返回 null
   */
  static extractTaskId(text: string): string | null {
    const match = text.match(TASK_ID_REGEX);
    return match ? match[0] : null;
  }

  /**
   * 从文本中提取 SGF 内容
   * SGF 文件以 "(;" 开头，包含多层嵌套的括号
   * @param text 文本内容
   * @returns 提取到的 SGF 内容，如果没有则返回 null
   */
  static extractSgf(text: string): string | null {
    // 查找 SGF 开始标记 "(;"
    const sgfStart = text.indexOf('(;');
    if (sgfStart === -1) return null;

    // 使用括号匹配找到 SGF 结束位置
    let depth = 0;
    for (let i = sgfStart; i < text.length; i++) {
      if (text[i] === '(') depth++;
      if (text[i] === ')') {
        depth--;
        if (depth === 0) {
          return text.substring(sgfStart, i + 1);
        }
      }
    }

    // 如果没有找到结束，返回从开始到文本末尾
    return text.substring(sgfStart);
  }
}
