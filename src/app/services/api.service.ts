import { Injectable, signal } from '@angular/core';

export interface FeedSource {
  id: string;
  name: string;
  url: string;
  group: '宏观' | '行业' | '公告' | '海外';
  enabled: boolean;
  failCount: number;
  lastFetchedAt: string | null;
  lastError: string | null;
}

export interface AssetCandidate {
  code: string;
  name: string;
  type: 'stock' | 'index' | 'sector';
  reason: string;
}

export interface RssItem {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
  category: string;
  assetCandidates: AssetCandidate[];
  macroSignals: string[];
  createdAt: string;
}

export interface Quote {
  code: string;
  name: string;
  price: number | null;
  prevClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  time: string;
  error?: string;
}

export interface VerifierReminder {
  key: string;
  date: string;
  time: string;
  label: string;
}

// 同源部署：API 走相对路径。开发由 proxy.conf.json 代理到 4300，生产由后端托管静态+API 同一端口。
const API_BASE = '';
const KEY_FEEDS = 'pa.feeds.v1';

const DEFAULT_FEEDS: FeedSource[] = [
  { id: 'daily', name: '每日财经', url: 'https://findailys.com/feed.xml', group: '宏观', enabled: true, failCount: 0, lastFetchedAt: null, lastError: null },
  { id: 'jiufeng', name: '玖峰投研精选', url: 'https://xiaoxi.report365.com.cn/feed.xml', group: '宏观', enabled: false, failCount: 0, lastFetchedAt: null, lastError: null },
];

function loadFeeds(): FeedSource[] {
  try {
    const raw = localStorage.getItem(KEY_FEEDS);
    if (raw) {
      const list = JSON.parse(raw) as FeedSource[];
      // 迁移：旧默认源顺序（玖峰启用）→ 新的 A 股优先配置
      const mi = localStorage.getItem('pa.feeds.migrated');
      if (!mi) {
        localStorage.setItem('pa.feeds.migrated', '1');
        return DEFAULT_FEEDS.map(f => {
          const old = list.find(x => x.id === f.id);
          // 保留用户自定义新增的源，但重置两条默认源的启停
          return old ? { ...f, enabled: f.enabled, lastFetchedAt: old.lastFetchedAt } : f;
        }).concat(list.filter(x => x.id !== 'daily' && x.id !== 'jiufeng'));
      }
      return list;
    }
  } catch { /* ignore */ }
  localStorage.setItem('pa.feeds.migrated', '1');
  return DEFAULT_FEEDS;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  readonly online = signal(true);
  readonly feeds = signal<FeedSource[]>(loadFeeds());
  readonly syncing = signal(false);
  readonly lastSync = signal<string | null>(null);
  readonly syncMessage = signal('');

  private persist(): void {
    localStorage.setItem(KEY_FEEDS, JSON.stringify(this.feeds()));
  }

  constructor() {
    this.ping();
  }

  async ping(): Promise<boolean> {
    try {
      const r = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
      const ok = r.ok;
      this.online.set(ok);
      return ok;
    } catch {
      this.online.set(false);
      return false;
    }
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json() as Promise<T>;
  }

  async fetchRss(url: string): Promise<RssItem[]> {
    const data = await this.json<{ items: RssItem[] }>('/api/rss?url=' + encodeURIComponent(url));
    return data.items || [];
  }

  async getQuotes(codes: string[]): Promise<Quote[]> {
    if (!codes.length) return [];
    const data = await this.json<{ quotes: Quote[] }>('/api/quote?codes=' + encodeURIComponent(codes.join(',')));
    return data.quotes || [];
  }

  async getTradingDay(date: string, n: number): Promise<string> {
    const data = await this.json<{ nextN: string }>(`/api/trading-day?date=${date}&n=${n}`);
    return data.nextN;
  }

  async getVapidKey(): Promise<string | null> {
    try {
      const data = await this.json<{ vapidPublicKey: string }>('/api/config');
      return data.vapidPublicKey;
    } catch { return null; }
  }

  async subscribe(subscription: PushSubscription, reminders: VerifierReminder[]): Promise<boolean> {
    try {
      await this.json('/api/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({ subscription, reminders }),
      });
      return true;
    } catch { return false; }
  }

  async updateReminders(endpoint: string, reminders: VerifierReminder[]): Promise<void> {
    try {
      await this.json('/api/reminders', {
        method: 'POST',
        body: JSON.stringify({ endpoint, reminders }),
      });
    } catch { /* 提醒同步失败不影响主流程 */ }
  }

  async testPush(): Promise<boolean> {
    try {
      await this.json('/api/push/test', { method: 'POST', body: '{}' });
      return true;
    } catch { return false; }
  }

  addFeed(name: string, url: string, group: FeedSource['group']): string | null {
    const clean = url.trim();
    if (!/^https?:\/\//.test(clean)) return '请输入以 http:// 或 https:// 开头的地址';
    if (this.feeds().some(f => f.url === clean)) return '该地址已存在';
    const item: FeedSource = {
      id: 'feed-' + Date.now().toString(36),
      name: name.trim() || clean.slice(0, 30),
      url: clean,
      group,
      enabled: true,
      failCount: 0,
      lastFetchedAt: null,
      lastError: null,
    };
    this.feeds.update(list => [...list, item]);
    this.persist();
    return null;
  }

  removeFeed(id: string): void {
    this.feeds.update(list => list.filter(f => f.id !== id));
    this.persist();
  }

  toggleFeed(id: string): void {
    this.feeds.update(list => list.map(f =>
      f.id === id ? { ...f, enabled: !f.enabled, failCount: 0, lastError: null } : f
    ));
    this.persist();
  }

  /** 拉取所有启用的源；连续失败 3 次自动暂停
   * onItems 返回真正入库的条数（去重后），用于准确反馈 */
  async syncAll(onItems: (items: RssItem[], source: FeedSource) => number): Promise<void> {
    if (this.syncing()) return;
    // 拉取前实时探测服务，避免初始化后服务启停导致状态过期
    const reachable = await this.ping();
    if (!reachable) {
      this.syncMessage.set('后端服务未连接，请先在 server 目录运行 npm start');
      return;
    }
    this.syncing.set(true);
    this.syncMessage.set('正在拉取…');
    let fetched = 0;   // 拉取到的总条数
    let added = 0;     // 去重后真正新增的条数
    let failed = 0;
    let skipped = 0;
    const errors: string[] = [];
    try {
      for (const feed of this.feeds()) {
        if (!feed.enabled) {
          if (feed.failCount >= 3) skipped++;
          continue;
        }
        try {
          const items = await this.fetchRss(feed.url);
          fetched += items.length;
          added += onItems(items, feed); // 用去重后的真实入库数
          this.feeds.update(list => list.map(f => f.id === feed.id
            ? { ...f, failCount: 0, lastFetchedAt: new Date().toISOString(), lastError: null }
            : f));
        } catch (e) {
          failed++;
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${feed.name}: ${msg}`);
          this.feeds.update(list => list.map(f => {
            if (f.id !== feed.id) return f;
            const failCount = f.failCount + 1;
            return {
              ...f, failCount, lastError: msg,
              enabled: failCount < 3 ? f.enabled : false,
            };
          }));
        }
      }
      this.persist();
      this.lastSync.set(new Date().toISOString());
      const parts = [`拉取 ${fetched} 条，新增 ${added} 条`];
      if (failed) parts.push(`${failed} 个源失败（${errors[0] || ''}）`);
      if (skipped) parts.push(`${skipped} 个源已暂停`);
      if (!added && fetched && !failed) parts.push('内容均已存在');
      this.syncMessage.set(parts.join('；'));
    } finally {
      this.syncing.set(false);
    }
  }
}
