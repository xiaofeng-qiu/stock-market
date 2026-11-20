import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { StoreService, uid } from '../../services/store.service';
import {
  NewsItem, Prediction, Direction, WindowType, DEFAULT_WINDOWS,
  DIRECTION_LABEL, WINDOW_LABEL,
} from '../../models';

@Component({
  selector: 'app-predict',
  imports: [FormsModule, NgClass],
  templateUrl: './predict.html',
  styleUrl: './predict.css',
})
export class PredictPage implements OnInit {
  readonly store = inject(StoreService);
  private readonly route = inject(ActivatedRoute);

  readonly directionOptions: Direction[] = ['up', 'down', 'flat'];
  readonly windowOptions: WindowType[] = ['open_gap', 'day_close', 'n_day'];
  readonly dirLabel = DIRECTION_LABEL;
  readonly winLabel = WINDOW_LABEL;

  showForm = signal(false);
  linkedNews: NewsItem | null = null;

  assetCode = '';
  assetName = '';
  direction: Direction = 'up';
  windows: WindowType[] = [...DEFAULT_WINDOWS];
  nDays: 1 | 3 | 5 = 3;
  expectedMagnitude: number | null = null;
  confidence: 1 | 2 | 3 | 4 | 5 = 3;
  reasoning = '';
  targetMarketDate = '';

  private localDate(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  ngOnInit(): void {
    const newsId = this.route.snapshot.queryParamMap.get('newsId');
    this.targetMarketDate = this.localDate();
    if (newsId) {
      const n = this.store.news().find(x => x.id === newsId);
      if (n) {
        this.linkedNews = n;
        this.assetCode = n.assetCode;
        this.assetName = n.assetName;
        this.showForm.set(true);
      }
    }
    if (!this.linkedNews && this.store.news().length) {
      this.linkedNews = null;
    }
  }

  openBlank(): void {
    this.linkedNews = null;
    this.assetCode = '';
    this.assetName = '';
    this.showForm.set(true);
  }

  toggleWindow(w: WindowType): void {
    this.windows = this.windows.includes(w)
      ? this.windows.filter(x => x !== w)
      : [...this.windows, w];
  }

  submit(): void {
    if (!this.assetCode.trim() || !this.windows.length) return;
    const now = new Date().toISOString();
    const p: Prediction = {
      id: uid(),
      newsId: this.linkedNews?.id ?? '',
      templateType: this.linkedNews ? 'pre_market' : 'event',
      assetCode: this.assetCode.trim(),
      assetName: this.assetName.trim(),
      direction: this.direction,
      windows: [...this.windows],
      nDays: this.nDays,
      expectedMagnitude: this.expectedMagnitude,
      confidence: this.confidence,
      reasoning: this.reasoning.trim(),
      targetMarketDate: this.targetMarketDate,
      createdAt: now,
      lockedAt: now,
      status: 'pending',
    };
    this.store.addPrediction(p);
    this.showForm.set(false);
    this.linkedNews = null;
    this.reasoning = '';
    this.expectedMagnitude = null;
  }

  voidPrediction(id: string): void {
    if (confirm('作废这条预判？原记录会保留。')) {
      this.store.setPredictionStatus(id, 'void');
    }
  }

  verifiedCount(p: Prediction): number {
    return this.store.verifications().filter(v => v.predictionId === p.id).length;
  }

  windowLabels(windows: WindowType[]): string {
    return windows.map(w => WINDOW_LABEL[w]).join('、');
  }

  formatTime(iso: string): string {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}
