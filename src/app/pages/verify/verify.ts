import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StoreService, uid } from '../../services/store.service';
import { VerificationService } from '../../services/verification.service';
import { ApiService } from '../../services/api.service';
import { PushService } from '../../services/push.service';
import { MarketSnapshot, Prediction } from '../../models';

interface PriceLine {
  code: string;
  date: string;
  prevClose: number;
  open: number;
  close: number;
  tPlusNClose: number | null;
}

@Component({
  selector: 'app-verify',
  imports: [FormsModule],
  templateUrl: './verify.html',
  styleUrl: './verify.css',
})
export class VerifyPage {
  readonly store = inject(StoreService);
  private readonly verifier = inject(VerificationService);
  readonly api = inject(ApiService);
  readonly push = inject(PushService);

  readonly showForm = signal(false);
  readonly lastRun = signal<{ matched: number; verified: number; skipped: string[] } | null>(null);
  readonly parseError = signal('');
  readonly autoBusy = signal(false);
  readonly autoMessage = signal('');

  csv = '';

  readonly pending = computed(() =>
    this.store.predictions().filter(p => p.status === 'pending')
  );

  /** 手动单条验证（当行情源没有对应快照时用） */
  manualOpen = signal(false);
  manualPredictionId = '';
  manualBase = 0;
  manualTarget = 0;
  manualWindow: 'open_gap' | 'day_close' | 'n_day' = 'day_close';

  runImport(): void {
    this.parseError.set('');
    const lines = this.csv.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    if (!lines.length) {
      this.parseError.set('没有可解析的数据行');
      return;
    }

    const parsed: PriceLine[] = [];
    const errors: string[] = [];
    lines.forEach((line, i) => {
      const parts = line.split(/[,，\t]/).map(s => s.trim());
      if (parts.length < 5) {
        errors.push(`第 ${i + 1} 行：字段不足（需 代码,日期,昨收,今开,今收）`);
        return;
      }
      const [code, date, prev, open, close, tpn] = parts;
      const prevClose = Number(prev), o = Number(open), c = Number(close);
      if (!code || !date || !Number.isFinite(prevClose) || !Number.isFinite(o) || !Number.isFinite(c)) {
        errors.push(`第 ${i + 1} 行：代码/日期/价格无效`);
        return;
      }
      parsed.push({
        code, date, prevClose, open: o, close: c,
        tPlusNClose: tpn && Number.isFinite(Number(tpn)) ? Number(tpn) : null,
      });
    });

    if (errors.length) {
      this.parseError.set(errors.slice(0, 3).join('；'));
      return;
    }

    const snapshots: MarketSnapshot[] = parsed.map(p => ({
      id: uid(),
      assetCode: p.code,
      tradeDate: p.date,
      prevClose: p.prevClose,
      open: p.open,
      close: p.close,
      tPlusNClose: p.tPlusNClose,
      importedAt: new Date().toISOString(),
    }));
    this.store.addPrices(snapshots);

    const allPredictions = this.store.predictions().filter(p => p.status === 'pending');
    const existing = this.store.verifications();
    const records = this.verifier.batchVerify(
      allPredictions,
      snapshots,
      existing,
      (pid, w, n) => this.store.hasWindow(pid, w, n)
    );
    this.store.addVerifications(records);

    // 更新已全部验证的预判状态
    const touched = new Set(records.map(r => r.predictionId));
    for (const pid of touched) {
      const p = this.store.predictions().find(x => x.id === pid);
      if (!p) continue;
      const done = p.windows.every(w => {
        const n = w === 'n_day' ? p.nDays : null;
        return this.store.hasWindow(pid, w, n);
      });
      if (done) this.store.setPredictionStatus(pid, 'verified');
    }

    const skipped: string[] = [];
    for (const p of allPredictions) {
      const snap = snapshots.find(s => s.assetCode === p.assetCode && s.tradeDate === p.targetMarketDate);
      if (!snap) {
        skipped.push(`${p.assetCode} ${p.targetMarketDate} 未找到行情`);
      } else if (p.windows.includes('n_day') && snap.tPlusNClose === null) {
        skipped.push(`${p.assetCode} 缺 T+N 收盘价`);
      }
    }

    this.lastRun.set({ matched: parsed.length, verified: records.length, skipped });
    this.csv = '';
    this.showForm.set(false);
  }

  submitManual(): void {
    const p = this.store.predictions().find(x => x.id === this.manualPredictionId);
    if (!p || !Number.isFinite(this.manualBase) || !Number.isFinite(this.manualTarget)) return;
    if (this.store.hasWindow(p.id, this.manualWindow, this.manualWindow === 'n_day' ? p.nDays : null)) return;

    const labels: Record<string, [string, string]> = {
      open_gap: ['昨收', '今开'],
      day_close: ['昨收', '今收'],
      n_day: ['T日收', `T+${p.nDays}收`],
    };
    const [baseLabel, targetLabel] = labels[this.manualWindow];
    const rec = this.verifier.judge(
      p,
      { basePrice: this.manualBase, targetPrice: this.manualTarget, baseLabel, targetLabel },
      this.manualWindow,
      p.targetMarketDate
    );
    this.store.addVerifications([rec]);

    const done = p.windows.every(w => {
      const n = w === 'n_day' ? p.nDays : null;
      return this.store.hasWindow(p.id, w, n);
    });
    if (done) this.store.setPredictionStatus(p.id, 'verified');

    this.manualOpen.set(false);
    this.manualBase = 0;
    this.manualTarget = 0;
  }

  /**
   * 自动拉取实时行情并验证（P1）
   * 约束：实时行情只反映当日，仅验证目标交易日 = 今天的预判；
   * n_day 需要未来收盘价，实时数据拿不到，跳过并提示手动补录。
   */
  async autoFetch(): Promise<void> {
    if (!this.api.online()) {
      this.autoMessage.set('后端服务未连接，无法拉取实时行情');
      return;
    }
    this.autoBusy.set(true);
    this.autoMessage.set('');
    try {
      const today = this.localDate();
      const due = this.pending().filter(p => p.targetMarketDate === today);
      if (!due.length) {
        this.autoMessage.set('今天没有待验证的预判（自动验证仅处理目标日为今天的预判）');
        return;
      }

      // 收集需要实时行情的代码（n_day 窗口无法用实时价验证，排除）
      const codes = [...new Set(due.map(p => p.assetCode).filter(Boolean))];
      if (!codes.length) {
        this.autoMessage.set('待验证预判没有关联标的代码');
        return;
      }
      const quotes = await this.api.getQuotes(codes);
      const quoteByInput = new Map<string, (typeof quotes)[number]>();
      codes.forEach((c, i) => { if (quotes[i] && !quotes[i].error) quoteByInput.set(c, quotes[i]); });

      const snapshots: MarketSnapshot[] = [];
      const skipped: string[] = [];
      for (const [inputCode, q] of quoteByInput) {
        if (!q.open || !q.prevClose || !q.price) {
          skipped.push(`${inputCode} 行情不完整`);
          continue;
        }
        snapshots.push({
          id: uid(),
          assetCode: inputCode, // 用原始输入代码，与预判匹配
          tradeDate: today,
          prevClose: q.prevClose,
          open: q.open,
          close: q.price, // 收盘后 price 即当日收盘价；盘中为现价
          tPlusNClose: null, // T+N 需等对应交易日，实时拿不到
          importedAt: new Date().toISOString(),
        });
      }
      this.store.addPrices(snapshots);

      const existing = this.store.verifications();
      const records = this.verifier.batchVerify(
        due, snapshots, existing,
        (pid, w, n) => this.store.hasWindow(pid, w, n)
      );
      this.store.addVerifications(records);

      // 更新状态 + 记录被跳过的 n_day 窗口
      for (const p of due) {
        if (p.windows.includes('n_day') && !this.store.hasWindow(p.id, 'n_day', p.nDays)) {
          skipped.push(`${p.assetName || p.assetCode} 的 T+${p.nDays} 需到期后手动补收盘价`);
        }
        const done = p.windows.every(w =>
          this.store.hasWindow(p.id, w, w === 'n_day' ? p.nDays : null)
        );
        if (done) this.store.setPredictionStatus(p.id, 'verified');
      }

      // 提醒时点同步：移除已验证窗口
      this.push.syncReminders();

      this.autoMessage.set(
        `自动验证完成：新增 ${records.length} 条结果` +
        (skipped.length ? `；${skipped.slice(0, 3).join('；')}` : '')
      );
      this.lastRun.set({ matched: snapshots.length, verified: records.length, skipped });
    } catch (e) {
      this.autoMessage.set('拉取失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      this.autoBusy.set(false);
    }
  }

  private localDate(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  manualWindowsFor(p: Prediction): string[] {
    return p.windows.filter(w => !this.store.hasWindow(p.id, w, w === 'n_day' ? p.nDays : null));
  }

  verifiedCount(p: Prediction): number {
    return this.store.verifications().filter(v => v.predictionId === p.id).length;
  }
}
