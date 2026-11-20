import { Injectable } from '@angular/core';
import {
  Prediction, Verification, MarketSnapshot, WindowType, VerifyResult,
} from '../models';
import { uid } from './store.service';

export interface VerifyInput {
  basePrice: number;
  targetPrice: number;
  baseLabel: string;
  targetLabel: string;
}

@Injectable({ providedIn: 'root' })
export class VerificationService {
  /** 阈值 = max(用户设定幅度, 0.5%)，防蒙对方向 */
  threshold(p: Prediction): number {
    return Math.max(p.expectedMagnitude ?? 0, 0.5);
  }

  /**
   * 纯判定函数：变动 = (验证价 - 基准价) / 基准价 × 100%
   * 看涨 change>=+阈 / 看跌 change<=-阈 / 震荡 |change|<阈
   * 方向对但幅度不足 → partial；无有效价格 → invalid
   */
  judge(p: Prediction, input: VerifyInput, window: WindowType, verifyDate: string): Verification {
    const { basePrice, targetPrice } = input;
    const valid = Number.isFinite(basePrice) && Number.isFinite(targetPrice) && basePrice > 0 && targetPrice > 0;
    const change = valid ? ((targetPrice - basePrice) / basePrice) * 100 : 0;
    const th = this.threshold(p);

    let result: VerifyResult = 'invalid';
    let directionCorrect = false;
    let magnitudeMet = false;

    if (valid) {
      if (p.direction === 'up') {
        directionCorrect = change > 0;
        magnitudeMet = change >= th;
      } else if (p.direction === 'down') {
        directionCorrect = change < 0;
        magnitudeMet = change <= -th;
      } else {
        directionCorrect = Math.abs(change) < th;
        magnitudeMet = directionCorrect;
      }

      if (magnitudeMet && directionCorrect) result = 'hit';
      else if (directionCorrect && !magnitudeMet) result = 'partial';
      else result = 'miss';
    }

    return {
      id: uid(),
      predictionId: p.id,
      windowType: window,
      nDays: window === 'n_day' ? p.nDays : null,
      verifyDate,
      basePrice: valid ? basePrice : 0,
      targetPrice: valid ? targetPrice : 0,
      actualChangePct: change,
      threshold: th,
      directionCorrect,
      magnitudeMet,
      result,
      baseLabel: input.baseLabel,
      targetLabel: input.targetLabel,
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * 从行情快照提取某窗口的基准价与验证价。
   * open_gap: 昨收 → 今开
   * day_close: 昨收 → 今收
   * n_day: T日收 → T+N 收（需要 tPlusNClose）
   * intraday: 今开 → 今收
   */
  extract(snap: MarketSnapshot, window: WindowType, nDays: number | null): VerifyInput | null {
    switch (window) {
      case 'open_gap':
        return {
          basePrice: snap.prevClose, targetPrice: snap.open,
          baseLabel: '昨收', targetLabel: '今开',
        };
      case 'day_close':
        return {
          basePrice: snap.prevClose, targetPrice: snap.close,
          baseLabel: '昨收', targetLabel: '今收',
        };
      case 'intraday':
        return {
          basePrice: snap.open, targetPrice: snap.close,
          baseLabel: '今开', targetLabel: '今收',
        };
      case 'n_day':
        if (snap.tPlusNClose === null || snap.tPlusNClose <= 0) return null;
        return {
          basePrice: snap.close, targetPrice: snap.tPlusNClose,
          baseLabel: 'T日收', targetLabel: `T+${nDays}收`,
        };
    }
  }

  /**
   * 批量验证：按代码 + 交易日匹配行情快照，逐窗口生成验证记录。
   * 已验证过的窗口不重复生成。
   */
  batchVerify(
    predictions: Prediction[],
    snapshots: MarketSnapshot[],
    existing: Verification[],
    hasWindow: (pid: string, w: WindowType, n: number | null) => boolean
  ): Verification[] {
    const out: Verification[] = [];
    for (const p of predictions) {
      const snap = snapshots.find(
        s => s.assetCode === p.assetCode && s.tradeDate === p.targetMarketDate
      );
      if (!snap) continue;
      for (const w of p.windows) {
        const n = w === 'n_day' ? p.nDays : null;
        if (hasWindow(p.id, w, n)) continue;
        const input = this.extract(snap, w, n);
        if (!input) continue;
        out.push(this.judge(p, input, w, snap.tradeDate));
      }
    }
    return out;
  }
}
