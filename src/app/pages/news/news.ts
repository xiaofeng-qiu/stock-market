import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { StoreService, uid } from '../../services/store.service';
import { ApiService, RssItem } from '../../services/api.service';
import { NewsItem } from '../../models';

@Component({
  selector: 'app-news',
  imports: [FormsModule, RouterLink],
  templateUrl: './news.html',
  styleUrl: './news.css',
})
export class NewsPage {
  readonly store = inject(StoreService);
  readonly api = inject(ApiService);
  readonly router = inject(Router);

  showForm = signal(false);
  showTagsFor = signal<string | null>(null);
  title = '';
  summary = '';
  source = '手动录入';
  category = '宏观政策';
  assetCode = '';
  assetName = '';

  add(): void {
    if (!this.title.trim()) return;
    const item: NewsItem = {
      id: uid(),
      source: this.source.trim() || '手动录入',
      title: this.title.trim(),
      summary: this.summary.trim(),
      url: '',
      publishedAt: new Date().toISOString(),
      category: this.category,
      assetCode: this.assetCode.trim(),
      assetName: this.assetName.trim(),
      createdAt: new Date().toISOString(),
      tagged: true,
    };
    this.store.addNews(item);
    this.title = '';
    this.summary = '';
    this.assetCode = '';
    this.assetName = '';
    this.showForm.set(false);
  }

  async sync(): Promise<void> {
    await this.api.syncAll((items: RssItem[], source) =>
      this.store.addRssNews(items, source.name)
    );
  }

  toggleTags(id: string): void {
    this.showTagsFor.set(this.showTagsFor() === id ? null : id);
  }

  confirmTag(news: NewsItem, code: string, name: string): void {
    this.store.confirmTag(news.id, code, name);
    this.showTagsFor.set(null);
  }

  goPredict(news: NewsItem): void {
    this.router.navigate(['/predict'], { queryParams: { newsId: news.id } });
  }

  remove(id: string): void {
    if (confirm('删除这条新闻？')) this.store.removeNews(id);
  }

  formatTime(iso: string): string {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}
