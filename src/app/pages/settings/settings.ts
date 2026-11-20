import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { PushService } from '../../services/push.service';
import { StoreService } from '../../services/store.service';
import type { FeedSource } from '../../services/api.service';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, RouterLink],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class SettingsPage {
  readonly api = inject(ApiService);
  readonly push = inject(PushService);
  readonly store = inject(StoreService);

  readonly groups: FeedSource['group'][] = ['宏观', '行业', '公告', '海外'];
  newName = '';
  newUrl = '';
  newGroup: FeedSource['group'] = '公告';
  formError = signal('');

  constructor() {
    this.push.init();
  }

  addFeed(): void {
    const err = this.api.addFeed(this.newName, this.newUrl, this.newGroup);
    if (err) { this.formError.set(err); return; }
    this.formError.set('');
    this.newName = '';
    this.newUrl = '';
  }

  useTemplate(kind: 'jiufeng' | 'daily' | 'rsshub'): void {
    if (kind === 'jiufeng') {
      this.newName = '玖峰日报';
      this.newUrl = 'https://xiaoxi.report365.com.cn/feed/daily.xml';
      this.newGroup = '宏观';
    } else if (kind === 'daily') {
      this.newName = '每日财经';
      this.newUrl = 'https://findailys.com/feed.xml';
      this.newGroup = '宏观';
    } else {
      this.newName = '财联社公司公告';
      this.newUrl = 'https://rsshub.app/cls/telegraph/announcement';
      this.newGroup = '公告';
    }
    this.formError.set('');
  }

  async syncOne(feed: FeedSource): Promise<void> {
    try {
      const items = await this.api.fetchRss(feed.url);
      const count = this.store.addRssNews(items, feed.name);
      this.api.syncMessage.set(`${feed.name}：新增 ${count} 条`);
    } catch (e) {
      this.api.syncMessage.set(`${feed.name} 拉取失败：${e instanceof Error ? e.message : '未知错误'}`);
    }
  }

  formatTime(iso: string | null): string {
    if (!iso) return '从未';
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}
