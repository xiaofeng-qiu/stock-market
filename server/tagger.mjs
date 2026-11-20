// 标的自动标注：从新闻标题/摘要中抽取股票名、代码、板块词
// 规则词库驱动，P1 不引入 NLP 依赖；识别结果作为候选标签供用户确认

// 常见ETF/指数代码 —— 避免把 000001 这类多义代码误判
const INDEX_CODES = {
  '000001': '上证指数', '399001': '深证成指', '399006': '创业板指',
  '000300': '沪深300', '000905': '中证500', '000688': '科创50',
  '399905': '中证500', '000016': '上证50', '899050': '北证50',
};

const STOCKS = [
  ['600519', '贵州茅台'], ['000858', '五粮液'], ['601318', '中国平安'],
  ['600036', '招商银行'], ['000001', '平安银行'], ['601166', '兴业银行'],
  ['300750', '宁德时代'], ['002594', '比亚迪'], ['601012', '隆基绿能'],
  ['600900', '长江电力'], ['601899', '紫金矿业'], ['600030', '中信证券'],
  ['002415', '海康威视'], ['000333', '美的集团'], ['000651', '格力电器'],
  ['600887', '伊利股份'], ['002475', '立讯精密'], ['688981', '中芯国际'],
  ['002230', '科大讯飞'], ['300059', '东方财富'], ['601888', '中国中免'],
  ['600276', '恒瑞医药'], ['300760', '迈瑞医疗'], ['002352', '顺丰控股'],
  ['600028', '中国石化'], ['601857', '中国石油'], ['600941', '中国移动'],
  ['601398', '工商银行'], ['601939', '建设银行'], ['000002', '万科A'],
  ['600048', '保利发展'], ['601668', '中国建筑'], ['600031', '三一重工'],
  ['002714', '牧原股份'], ['603259', '药明康德'], ['300124', '汇川技术'],
  ['002371', '北方华创'], ['688111', '金山办公'], ['600438', '通威股份'],
  ['300274', '阳光电源'], ['002460', '赣锋锂业'], ['300014', '亿纬锂能'],
];

const SECTORS = [
  '银行', '券商', '保险', '半导体', '芯片', '新能源', '光伏', '锂电', '储能',
  '医药', '医疗', '白酒', '消费', '汽车', '家电', '军工', '人工智能', '算力',
  '房地产', '地产', '煤炭', '有色金属', '钢铁', '化工', '农业', '电力',
  '通信', '传媒', '游戏', '教育', '旅游', '物流', '基建', '环保', '机器人',
  '低空经济', '量子科技', '数据中心', '云计算', '网络安全', '跨境电商',
];

const MACRO_KEYWORDS = [
  '央行', '降准', '降息', 'LPR', '证监会', '国务院', '财政部', '发改委',
  'CPI', 'PPI', 'GDP', '美联储', '关税', '出口管制', 'IPO', '注册制',
];

export function detectAssets(text = '') {
  const hits = [];
  const seen = new Set();
  const push = (code, name, type, reason) => {
    const key = code + '|' + type;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ code, name, type, reason });
  };

  // 1. 显式代码：6位数字，带不带 sh/sz/bj 前缀都识别
  const codeRe = /(?:sh|sz|bj)?(\d{6})/gi;
  let m;
  while ((m = codeRe.exec(text)) !== null) {
    const code = m[1];
    const name = STOCKS.find(s => s[0] === code)?.[1]
      || INDEX_CODES[code]
      || '';
    push(code, name, INDEX_CODES[code] ? 'index' : 'stock', '正文代码');
  }

  // 2. 股票名称
  for (const [code, name] of STOCKS) {
    if (text.includes(name)) push(code, name, 'stock', '正文名称');
  }

  // 3. 指数名称与ETF简称
  for (const [code, name] of Object.entries(INDEX_CODES)) {
    if (text.includes(name)) push(code, name, 'index', '正文指数名');
  }

  // 4. 板块词
  for (const s of SECTORS) {
    if (text.includes(s)) {
      hits.push({ code: '', name: s, type: 'sector', reason: '正文板块词' });
    }
  }

  return hits.slice(0, 10);
}

export function detectCategory(text = '') {
  if (/降准|降息|LPR|央行|财政|国务院|发改委|CPI|GDP|美联储|关税/.test(text)) return '宏观政策';
  if (/公告|业绩|财报|重组|收购|回购|减持|定增|IPO|停牌/.test(text)) return '公司公告';
  if (/半导体|芯片|算力|人工智能|机器人|光伏|锂电|储能|新能源/.test(text)) return '行业动态';
  if (/证监会|交易所|监管|处罚|注册制/.test(text)) return '监管动态';
  return '其他';
}

export function macroSignals(text = '') {
  return MACRO_KEYWORDS.filter(k => text.includes(k));
}
