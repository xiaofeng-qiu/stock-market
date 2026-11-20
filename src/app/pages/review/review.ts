import { Component, inject, signal, computed } from '@angular/core';
import { NgClass } from '@angular/common';
import { StoreService } from '../../services/store.service';
import { RESULT_LABEL, WINDOW_LABEL, Verification } from '../../models';

@Component({
  selector: 'app-review',
  imports: [NgClass],
  templateUrl: './review.html',
  styleUrl: './review.css',
})
export class ReviewPage {
  readonly store = inject(StoreService);
  readonly resultLabel = RESULT_LABEL;
  readonly winLabel = WINDOW_LABEL;

  readonly filter = signal<'all' | 'hit' | 'miss' | 'partial'>('all');

  readonly allVerifications = computed(() =>
    [...this.store.verifications()].sort(
      (a, b) => new Date(b.verifiedAt).getTime() - new Date(a.verifiedAt).getTime()
    )
  );

  readonly filtered = computed(() => {
    const f = this.filter();
    const list = this.allVerifications();
    if (f === 'all') return list;
    return list.filter(v => v.result === f);
  });

  predictionFor(id: string) {
    return this.store.predictions().find(p => p.id === id);
  }

  fmtPct(n: number): string {
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  resetAll(): void {
    if (confirm('清空所有数据？此操作不可恢复。')) this.store.clearAll();
  }
}
