// P1 轻量服务端：RSS 解析代理 + A股行情代理 + 验证提醒定时推送
// 只依赖 web-push；VAPID 密钥与订阅数据本地持久化，无需任何外部账号
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as webpush from 'web-push';

import { detectAssets, detectCategory, macroSignals } from './tagger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const SENT_FILE = path.join(DATA_DIR, 'sent.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

// ---------- VAPID ----------
let vapid = readJson(VAPID_FILE, null);
if (!vapid?.publicKey || !vapid?.privateKey) {
  vapid = webpush.generateVAPIDKeys();
  writeJson(VAPID_FILE, vapid);
}
webpush.setVapidDetails('mailto:local@prediction-app.dev', vapid.publicKey, vapid.privateKey);

let subscriptions = readJson(SUBS_FILE, []);
let sent = readJson(SENT_FILE, {});

// ---------- 行情 ----------
function normalizeCode(raw) {
  const s = String(raw || '').trim().toLowerCase();
  const m = s.match(/^(sh|sz|bj)?(\d{6})$/);
  if (!m) return null;
  if (m[1]) return m[1] + m[2];
  if (/^[69]/.test(m[2])) return 'sh' + m[2];
  if (/^[048]/.test(m[2])) return 'sz' + m[2];
  return 'sh' + m[2];
}

async function fetchQuote(codeInput) {
  const code = normalizeCode(codeInput);
  if (!code) throw new Error('代码格式不正确：' + codeInput);
  const res = await fetch(`https://qt.gtimg.cn/q=${code}`, {
    headers: { Referer: 'https://gu.qq.com/' },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let text;
  try { text = new TextDecoder('gbk').decode(buf); } catch { text = buf.toString('utf8'); }
  const m = text.match(/="([^"]*)"/);
  if (!m) throw new Error('无行情返回：' + code);
  const f = m[1].split('~');
  if (f.length < 35 || !f[3]) throw new Error('行情字段不足或停牌：' + code);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  return {
    code,
    name: f[1],
    price: num(f[3]),
    prevClose: num(f[4]),
    open: num(f[5]),
    high: num(f[33]),
    low: num(f[34]),
    time: f[30] || '',
  };
}

// ---------- RSS ----------
function decodeEntities(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
function stripHtml(s = '') {
  return decodeEntities(s)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function pick(block, ...tags) {
  for (const tag of tags) {
    const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (m) return stripHtml(m[1]);
  }
  return '';
}

// 过滤明显的海外/美股 SEC 噪音：本项目只做 A 股
function isRelevant(title, summary) {
  const t = (title + ' ' + summary);
  // 美股 SEC 公司公告特征：即便摘要含中文也过滤（本项目只做 A 股）
  if (/\b8-K\b|10-K|10-Q|Form\s?[SDF]-?\d|Regulation\s?S-K|Inc\.|Corp\.|Nasdaq|NYSE:|SEC\s?filing/i.test(title)) {
    // 除非明确涉及中国/港股
    if (!/中国|港股|A股|沪深|上证|深证|China|Hong Kong|HKEX/i.test(t)) return false;
  }
  // 含中文视为相关
  if (/[\u4e00-\u9fa5]/.test(t)) return true;
  // 纯英文但涉及中国/港股的保留
  if (/China|Chinese|Hong Kong|A-share|Shanghai|Shenzhen|HKEX|CSI\s?300/i.test(t)) return true;
  return false;
}

function parseRss(xml = '') {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  return blocks.slice(0, 80).map((b, i) => {
    const linkMatch = b.match(/<link[^>]*href=["']([^"']+)["']/i) || b.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const url = decodeEntities((linkMatch?.[1] || '').trim());
    const title = pick(b, 'title');
    const summary = pick(b, 'description', 'summary', 'content', 'content:encoded');
    const publishedRaw = pick(b, 'pubDate', 'published', 'updated', 'dc:date');
    const published = publishedRaw ? (new Date(publishedRaw).toISOString()) : new Date().toISOString();
    const text = title + ' ' + summary;
    return {
      id: url || `rss-${Date.now()}-${i}`,
      source: 'RSS',
      title,
      summary: summary.slice(0, 500),
      url,
      publishedAt: published,
      category: detectCategory(text),
      assetCandidates: detectAssets(text),
      macroSignals: macroSignals(text),
      createdAt: new Date().toISOString(),
    };
  })
    .filter(n => n.title && isRelevant(n.title, n.summary))
    .slice(0, 50);
}

// ---------- 交易日历（简化：周末 + 2026 主要节假日）----------
const HOLIDAYS_2026 = [
  '2026-01-01', '2026-01-02',
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20',
  '2026-04-06', '2026-05-01', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-09-25', '2026-10-01', '2026-10-02',
  '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08',
];
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isTradingDay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return false;
  const w = d.getDay();
  return w !== 0 && w !== 6 && !HOLIDAYS_2026.includes(dateStr);
}
function addTradingDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  let left = Math.max(1, Number(n) || 1);
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (isTradingDay(localDate(d))) left--;
  }
  return localDate(d);
}

// ---------- 定时提醒 ----------
// 前端订阅时一并提交待验证时点：[{ key, date, time, label }]
// 后端每分钟检查，到点推送一次（sent.json 去重）
function checkReminders() {
  const now = new Date();
  const today = localDate(now);
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  let changed = false;
  for (const sub of subscriptions) {
    for (const r of (sub.reminders || [])) {
      const due = r.date === today && r.time === hhmm;
      const key = `${sub.endpoint?.slice(-16) || 'anon'}|${r.key || r.date + r.time}`;
      if (due && !sent[key]) {
        sendPush(sub.subscription, {
          title: '有预判等待验证',
          body: r.label || `${r.date} ${r.time} · 打开 App 导入行情并验证`,
          url: '/verify',
        }).catch(() => {});
        sent[key] = new Date().toISOString();
        changed = true;
      }
    }
    // 清理过期提醒（保留近 3 天）
    sub.reminders = (sub.reminders || []).filter(r => r.date >= new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10));
  }
  if (changed) writeJson(SENT_FILE, sent);
  writeJson(SUBS_FILE, subscriptions);
}
async function sendPush(subscription, payload) {
  if (!subscription?.endpoint) return;
  await webpush.sendNotification(subscription, JSON.stringify(payload));
}

// ---------- HTTP ----------
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
function json(res, status, data) {
  res.writeHead(status, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

// ---------- 静态文件托管（同源部署）----------
// 开发时 dist 不存在，仅提供 API；生产/发布时托管 Angular 构建产物
const WEB_DIR = path.resolve(__dirname, '..', 'dist', 'prediction-app', 'browser');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
function serveStatic(pathname, res) {
  if (!fs.existsSync(WEB_DIR)) return false;
  // 解码并规范化路径，防目录穿越
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { rel = pathname; }
  rel = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '').replace(/^[\/\\]+/, '');
  let file = path.join(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR)) return false;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(WEB_DIR, 'index.html'); // SPA 路由回退
    if (!fs.existsSync(file)) return false;
  }
  const ext = path.extname(file).toLowerCase();
  const data = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  res.end(data);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return json(res, 204, {});
  // 非 API 请求 → 静态文件（Angular 应用）
  if (!url.pathname.startsWith('/api/')) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (serveStatic(url.pathname, res)) return;
    }
    return json(res, 404, { error: 'Not found' });
  }
  try {
    // 健康与配置
    if (url.pathname === '/api/health') {
      return json(res, 200, { ok: true, time: new Date().toISOString(), subscribers: subscriptions.length });
    }
    if (url.pathname === '/api/config') {
      return json(res, 200, { vapidPublicKey: vapid.publicKey });
    }

    // 行情：支持逗号分隔批量
    if (url.pathname === '/api/quote') {
      const codes = (url.searchParams.get('codes') || url.searchParams.get('code') || '')
        .split(',').map(s => s.trim()).filter(Boolean).slice(0, 30);
      if (!codes.length) return json(res, 400, { error: '缺少 code 参数' });
      const results = await Promise.all(codes.map(async c => {
        try { return await fetchQuote(c); } catch (e) { return { code: c, error: e.message }; }
      }));
      return json(res, 200, { quotes: results });
    }

    // RSS 代理：服务端抓取规避浏览器跨域
    if (url.pathname === '/api/rss') {
      const target = url.searchParams.get('url');
      if (!target || !/^https?:\/\//.test(target)) return json(res, 400, { error: '缺少合法 url 参数' });
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 15000);
      try {
        const r = await fetch(target, {
          signal: ctl.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PredictionApp/1.0)', Accept: 'application/rss+xml,application/xml,text/xml,*/*' },
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const buf = Buffer.from(await r.arrayBuffer());
        const text = buf.toString('utf8').replace(/^\uFEFF/, '');
        const items = parseRss(text);
        return json(res, 200, { items, count: items.length, fetchedAt: new Date().toISOString() });
      } finally { clearTimeout(timer); }
    }

    // 交易日历
    if (url.pathname === '/api/trading-day') {
      const date = url.searchParams.get('date') || localDate();
      const n = Number(url.searchParams.get('n') || 1);
      return json(res, 200, {
        date,
        isTradingDay: isTradingDay(date),
        nextN: addTradingDays(date, n),
      });
    }

    // 推送订阅
    if (url.pathname === '/api/push/subscribe' && req.method === 'POST') {
      const b = await body(req);
      if (!b.subscription?.endpoint) return json(res, 400, { error: '缺少 subscription' });
      const idx = subscriptions.findIndex(s => s.subscription?.endpoint === b.subscription.endpoint);
      const entry = { subscription: b.subscription, reminders: b.reminders || [], updatedAt: new Date().toISOString() };
      if (idx >= 0) subscriptions[idx] = entry; else subscriptions.push(entry);
      writeJson(SUBS_FILE, subscriptions);
      return json(res, 200, { ok: true, subscribers: subscriptions.length });
    }
    if (url.pathname === '/api/push/unsubscribe' && req.method === 'POST') {
      const b = await body(req);
      subscriptions = subscriptions.filter(s => s.subscription?.endpoint !== b.endpoint);
      writeJson(SUBS_FILE, subscriptions);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/push/test' && req.method === 'POST') {
      const b = await body(req);
      await sendPush(b.subscription || subscriptions[0]?.subscription, {
        title: '推送测试', body: '验证提醒通道已打通', url: '/verify',
      });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/reminders' && req.method === 'POST') {
      const b = await body(req);
      if (!b.endpoint) return json(res, 400, { error: '缺少 endpoint' });
      const sub = subscriptions.find(s => s.subscription?.endpoint === b.endpoint);
      if (sub) { sub.reminders = b.reminders || []; writeJson(SUBS_FILE, subscriptions); }
      return json(res, 200, { ok: !!sub });
    }

    return json(res, 404, { error: 'Not found' });
  } catch (e) {
    return json(res, 500, { error: e.message || '服务器错误' });
  }
});

const PORT = Number(process.env.PORT || 4300);
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`[prediction-server] http://${HOST}:${PORT}`);
  console.log(`[prediction-server] web dir: ${WEB_DIR} (${fs.existsSync(WEB_DIR) ? 'present' : 'absent, API only'})`);
  console.log(`[prediction-server] VAPID public key: ${vapid.publicKey}`);
});
setInterval(checkReminders, 60 * 1000);
