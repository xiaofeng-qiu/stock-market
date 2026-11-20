import { Injectable, signal, computed, effect } from '@angular/core';
import {
  NewsItem, Prediction, Verification, MarketSnapshot, AssetCandidate,
  PredictionStatus, WindowType, DIRECTION_LABEL, WINDOW_LABEL,
} from '../models';
import type { RssItem } from './api.service';

const KEY = {
  news: 'pa.news.v1',
  predictions: 'pa.predictions.v1',
  verifications: 'pa.verifications.v1',
  prices: 'pa.prices.v1',
};

function load<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function save<T>(key: string, value: T[]): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function uid(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

@Injectable({ providedIn: 'root' })
export class StoreService {
  readonly news = signal<NewsItem[]>(load<NewsItem>(KEY.news));
  readonly predictions = signal<Prediction[]>(load<Prediction>(KEY.predictions));
  readonly verifications = signal<Verification[]>(load<Verification>(KEY.verifications));
  readonly prices = signal<MarketSnapshot[]>(load<MarketSnapshot>(KEY.prices));

  constructor() {
    effect(() => save(KEY.news, this.news()));
    effect(() => save(KEY.predictions, this.predictions()));
    effect(() => save(KEY.verifications, this.verifications()));
    effect(() => save(KEY.prices, this.prices()));
  }

  addNews(item: NewsItem): void {
    this.news.update(list => [item, ...list]);
  }

  removeNews(id: string): void {
    this.news.update(list => list.filter(n => n.id !== id));
  }

  /** RSS 批量入库：按 url 指纹 + 标题相似度去重，返回新增条数 */
  addRssNews(items: RssItem[], sourceName: string): number {
    const existing = this.news();
    const urls = new Set(existing.map(n => n.url).filter(Boolean));
    const titles = new Set(existing.map(n => n.title.trim()));
    const fresh: NewsItem[] = [];
    for (const it of items) {
      if (it.url && urls.has(it.url)) continue;
      if (titles.has(it.title.trim())) continue;
      const candidates = (it.assetCandidates || []).slice(0, 5) as AssetCandidate[];
      const first = candidates.find(c => c.type !== 'sector');
      fresh.push({
        id: uid(),
        source: sourceName,
        title: it.title,
        summary: it.summary,
        url: it.url,
        publishedAt: it.publishedAt,
        category: it.category,
        assetCode: first?.code || '',
        assetName: first?.name || '',
        createdAt: new Date().toISOString(),
        candidates,
        tagged: false,
        signals: it.macroSignals || [],
      });
      if (it.url) urls.add(it.url);
      titles.add(it.title.trim());
    }
    if (fresh.length) this.news.update(list => [...fresh, ...list]);
    return fresh.length;
  }

  /** 用户确认某条新闻的标的标注 */
  confirmTag(newsId: string, code: string, name: string): void {
    this.news.update(list => list.map(n =>
      n.id === newsId ? { ...n, assetCode: code, assetName: name, tagged: true } : n
    ));
  }

  addPrediction(p: Prediction): void {
    this.predictions.update(list => [p, ...list]);
  }

  setPredictionStatus(id: string, status: PredictionStatus): void {
    this.predictions.update(list =>
      list.map(p => p.id === id ? { ...p, status } : p)
    );
  }

  verificationsFor(predictionId: string): Verification[] {
    return this.verifications().filter(v => v.predictionId === predictionId);
  }

  /** 某条预判是否已验证过指定窗口（防重复） */
  hasWindow(predictionId: string, window: WindowType, nDays: number | null): boolean {
    return this.verifications().some(
      v => v.predictionId === predictionId && v.windowType === window && v.nDays === nDays
    );
  }

  addVerifications(records: Verification[]): void {
    if (!records.length) return;
    this.verifications.update(list => [...records, ...list]);
  }

  addPrices(snapshots: MarketSnapshot[]): void {
    if (!snapshots.length) return;
    this.prices.update(list => [...snapshots, ...list]);
  }

  clearAll(): void {
    this.news.set([]);
    this.predictions.set([]);
    this.verifications.set([]);
    this.prices.set([]);
  }

  /** 演示数据：一键填充一组完整闭环样例 */
  seedDemo(): void {
    if (this.news().length || this.predictions().length) return;
    const today = new Date();
    const d0 = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const news: NewsItem = {
      id: uid(),
      source: '手动录入',
      title: '央行宣布全面降准 0.5 个百分点',
      summary: '预计释放长期流动性约 1 万亿元，利好银行与地产板块。',
      url: '',
      publishedAt: new Date().toISOString(),
      category: '宏观政策',
      assetCode: '000001',
      assetName: '平安银行',
      createdAt: new Date().toISOString(),
    };
    this.news.set([news]);

    this.predictions.set([{
      id: uid(),
      newsId: news.id,
      templateType: 'pre_market',
      assetCode: '000001',
      assetName: '平安银行',
      direction: 'up',
      windows: ['open_gap', 'day_close', 'n_day'],
      nDays: 3,
      expectedMagnitude: 1,
      confidence: 4,
      reasoning: '流动性宽松利好银行息差与估值修复',
      targetMarketDate: d0,
      createdAt: new Date().toISOString(),
      lockedAt: new Date().toISOString(),
      status: 'pending',
    }]);
  }

  /** 统计：按窗口汇总 */
  statsByWindow = computed(() => {
    const vs = this.verifications();
    const windows: WindowType[] = ['open_gap', 'day_close', 'n_day', 'intraday'];
    return windows.map(w => {
      const list = vs.filter(v => v.windowType === w && v.result !== 'invalid');
      const hit = list.filter(v => v.result === 'hit').length;
      const partial = list.filter(v => v.result === 'partial').length;
      return {
        window: w,
        label: WINDOW_LABEL[w],
        total: list.length,
        hit,
        partial,
        miss: list.length - hit - partial,
        rate: list.length ? Math.round((hit / list.length) * 100) : 0,
      };
    });
  });

  /** 统计：置信度校准 */
  calibration = computed(() => {
    const vs = this.verifications();
    const ps = this.predictions();
    const map = new Map<string, number>();
    ps.forEach(p => map.set(p.id, p.confidence));
    const buckets = [
      { label: '1-2 分', min: 1, max: 2 },
      { label: '3 分', min: 3, max: 3 },
      { label: '4-5 分', min: 4, max: 5 },
    ];
    return buckets.map(b => {
      const list = vs.filter(v => {
        const c = map.get(v.predictionId);
        return c !== undefined && c >= b.min && c <= b.max && v.result !== 'invalid';
      });
      const hit = list.filter(v => v.result === 'hit').length;
      return {
        label: b.label,
        total: list.length,
        hit,
        rate: list.length ? Math.round((hit / list.length) * 100) : 0,
      };
    });
  });

  overallStats = computed(() => {
    const vs = this.verifications().filter(v => v.result !== 'invalid');
    const hit = vs.filter(v => v.result === 'hit').length;
    const partial = vs.filter(v => v.result === 'partial').length;
    const invalid = this.verifications().filter(v => v.result === 'invalid').length;
    return {
      total: vs.length,
      hit,
      partial,
      miss: vs.length - hit - partial,
      invalid,
      rate: vs.length ? Math.round((hit / vs.length) * 100) : 0,
    };
  });

  statusLabel(status: PredictionStatus): string {
    return { pending: '待验证', verified: '已验证', expired: '已过期', void: '已作废' }[status];
  }

  directionLabel(d: keyof typeof DIRECTION_LABEL): string {
    return DIRECTION_LABEL[d];
  }
}
