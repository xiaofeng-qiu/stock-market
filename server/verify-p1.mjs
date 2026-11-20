// P1 端到端验证：RSS 拉取 → 标的标注 → 行情代理 → 交易日历 → VAPID 配置
const BASE = 'http://127.0.0.1:4300';
const get = async (p) => (await fetch(BASE + p)).json();

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

console.log('\n=== 1. 健康检查 ===');
const health = await get('/api/health');
check('服务在线', health.ok === true);
check('VAPID 已生成', typeof health.subscribers === 'number');

console.log('\n=== 2. 行情代理 ===');
const quotes = await get('/api/quote?codes=000001,600519');
const q0 = quotes.quotes?.[0];
check('返回两条行情', quotes.quotes?.length === 2);
check('代码规范化 sz 前缀', q0?.code === 'sz000001', `实际 ${q0?.code}`);
check('昨收价有效', q0?.prevClose > 0, `实际 ${q0?.prevClose}`);
check('今开价有效', q0?.open > 0, `实际 ${q0?.open}`);
check('现价有效', q0?.price > 0, `实际 ${q0?.price}`);

console.log('\n=== 3. RSS 拉取与解析 ===');
const rss = await get('/api/rss?url=' + encodeURIComponent('https://xiaoxi.report365.com.cn/feed.xml'));
check('返回条目', rss.items?.length > 0, `实际 ${rss.items?.length}`);
const withCategory = rss.items?.filter(i => i.category && i.category !== '其他').length || 0;
check('自动分类生效', withCategory > 0, `${withCategory}/${rss.items?.length}`);
const withCandidates = rss.items?.filter(i => i.assetCandidates?.length > 0).length || 0;
console.log(`  · 含标候选的条目: ${withCandidates}/${rss.items?.length}`);
check('条目含发布时间', rss.items?.[0]?.publishedAt?.length > 0);
check('条目含原文链接', !!rss.items?.[0]?.url);

console.log('\n=== 4. 标的标注规则 ===');
const { detectAssets, detectCategory } = await import('./tagger.mjs');
const t1 = detectAssets('央行降准利好平安银行000001与贵州茅台');
check('识别股票名称', t1.some(x => x.name === '平安银行'), JSON.stringify(t1));
check('识别股票代码', t1.some(x => x.code === '600519'));
const t2 = detectAssets('半导体和新能源板块领涨');
check('识别板块词', t2.some(x => x.type === 'sector' && x.name === '半导体'), JSON.stringify(t2));
check('分类：降准→宏观政策', detectCategory('央行宣布降准') === '宏观政策');
check('分类：回购→公司公告', detectCategory('公司发布回购公告') === '公司公告');

console.log('\n=== 5. 交易日历 ===');
const td = await get('/api/trading-day?date=2026-11-20&n=3');
check('交易日判断正确', td.isTradingDay === true);
check('T+3 跳过周末', td.nextN === '2026-11-25', `实际 ${td.nextN}`);
const tdWeekend = await get('/api/trading-day?date=2026-11-21&n=1');
check('周末非交易日', tdWeekend.isTradingDay === false);

console.log('\n=== 6. VAPID 配置 ===');
const config = await get('/api/config');
check('公钥已生成', config.vapidPublicKey?.length > 50, `长度 ${config.vapidPublicKey?.length}`);

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
