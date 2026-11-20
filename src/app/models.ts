export type Direction = 'up' | 'down' | 'flat';
export type WindowType = 'open_gap' | 'day_close' | 'n_day' | 'intraday';
export type PredictionStatus = 'pending' | 'verified' | 'expired' | 'void';
export type VerifyResult = 'hit' | 'miss' | 'partial' | 'invalid';

export interface AssetCandidate {
  code: string;
  name: string;
  type: 'stock' | 'index' | 'sector';
  reason: string;
}

export interface NewsItem {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
  category: string;
  assetCode: string;
  assetName: string;
  createdAt: string;
  /** P1: RSS 自动标注的候选标的，供用户确认 */
  candidates?: AssetCandidate[];
  /** P1: 是否已确认过标的标注 */
  tagged?: boolean;
  /** P1: 宏观政策信号词 */
  signals?: string[];
}

export interface Prediction {
  id: string;
  newsId: string;
  templateType: 'pre_market' | 'intraday' | 'event';
  assetCode: string;
  assetName: string;
  direction: Direction;
  windows: WindowType[];
  nDays: 1 | 3 | 5;
  expectedMagnitude: number | null;
  confidence: 1 | 2 | 3 | 4 | 5;
  reasoning: string;
  targetMarketDate: string;
  createdAt: string;
  lockedAt: string;
  status: PredictionStatus;
}

export interface Verification {
  id: string;
  predictionId: string;
  windowType: WindowType;
  nDays: number | null;
  verifyDate: string;
  basePrice: number;
  targetPrice: number;
  actualChangePct: number;
  threshold: number;
  directionCorrect: boolean;
  magnitudeMet: boolean;
  result: VerifyResult;
  baseLabel: string;
  targetLabel: string;
  verifiedAt: string;
}

export interface MarketSnapshot {
  id: string;
  assetCode: string;
  tradeDate: string;
  prevClose: number;
  open: number;
  close: number;
  tPlusNClose: number | null;
  importedAt: string;
}

export const DIRECTION_LABEL: Record<Direction, string> = {
  up: '看涨',
  down: '看跌',
  flat: '震荡',
};

export const WINDOW_LABEL: Record<WindowType, string> = {
  open_gap: '开盘跳空',
  day_close: '当日方向',
  n_day: '趋势延续',
  intraday: '日内走势',
};

export const RESULT_LABEL: Record<VerifyResult, string> = {
  hit: '命中',
  miss: '未命中',
  partial: '部分命中',
  invalid: '失效',
};

export const DEFAULT_WINDOWS: WindowType[] = ['open_gap', 'day_close', 'n_day'];
