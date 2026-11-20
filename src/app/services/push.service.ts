import { Injectable, inject, signal } from '@angular/core';
import { ApiService, VerifierReminder } from './api.service';
import { StoreService } from './store.service';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly api = inject(ApiService);
  private readonly store = inject(StoreService);

  readonly supported = signal(
    typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
  );
  readonly subscribed = signal(false);
  readonly permission = signal<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );
  readonly busy = signal(false);
  readonly message = signal('');

  async init(): Promise<void> {
    if (!this.supported()) return;
    this.permission.set(Notification.permission);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      this.subscribed.set(!!sub);
    } catch { /* ignore */ }
  }

  /** 依赖待验证预判生成提醒时点：
   *  - 有 targetMarketDate 的预判 → open_gap 09:31、day_close 15:05
   *  - n_day → T+N 日的 15:05（用后端交易日历推算）
   */
  async syncReminders(): Promise<VerifierReminder[]> {
    const subs = await this.currentSubscription();
    if (!subs) return [];
    const reminders: VerifierReminder[] = [];
    const today = this.localDate();
    for (const p of this.store.predictions()) {
      if (p.status !== 'pending') continue;
      const date = p.targetMarketDate < today ? today : p.targetMarketDate;
      for (const w of p.windows) {
        if (this.store.hasWindow(p.id, w, w === 'n_day' ? p.nDays : null)) continue;
        if (w === 'open_gap') {
          reminders.push({ key: `${p.id}-open`, date, time: '09:31', label: `${p.assetName || p.assetCode} 开盘验证提醒` });
        } else if (w === 'day_close' || w === 'intraday') {
          reminders.push({ key: `${p.id}-close`, date, time: '15:05', label: `${p.assetName || p.assetCode} 收盘验证提醒` });
        } else if (w === 'n_day') {
          try {
            const nd = await this.api.getTradingDay(date, p.nDays);
            reminders.push({ key: `${p.id}-n${p.nDays}`, date: nd, time: '15:05', label: `${p.assetName || p.assetCode} T+${p.nDays} 验证提醒` });
          } catch { /* 交易日历不可用则跳过该提醒 */ }
        }
      }
    }
    await this.api.updateReminders(subs.endpoint, reminders);
    return reminders;
  }

  private localDate(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private async currentSubscription(): Promise<PushSubscription | null> {
    if (!this.supported()) return null;
    try {
      const reg = await navigator.serviceWorker.ready;
      return await reg.pushManager.getSubscription();
    } catch { return null; }
  }

  async enable(): Promise<void> {
    if (!this.supported()) { this.message.set('当前浏览器不支持推送（需 HTTPS 或 localhost）'); return; }
    this.busy.set(true);
    this.message.set('');
    try {
      const perm = await Notification.requestPermission();
      this.permission.set(perm);
      if (perm !== 'granted') { this.message.set('通知权限未授予'); return; }
      const key = await this.api.getVapidKey();
      if (!key) { this.message.set('无法连接服务端，推送不可用'); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
        });
      }
      const reminders = await this.syncReminders();
      const ok = await this.api.subscribe(sub, reminders);
      this.subscribed.set(ok);
      this.message.set(ok ? `已开启，安排了 ${reminders.length} 个验证提醒` : '订阅保存到服务端失败');
    } catch (e) {
      this.message.set('开启失败：' + (e instanceof Error ? e.message : String(e)));
    } finally { this.busy.set(false); }
  }

  async disable(): Promise<void> {
    const sub = await this.currentSubscription();
    if (sub) await sub.unsubscribe();
    await this.api.updateReminders(sub?.endpoint || '', []);
    this.subscribed.set(false);
    this.message.set('已关闭推送提醒');
  }

  async sendTest(): Promise<void> {
    const sub = await this.currentSubscription();
    const ok = await this.api.testPush();
    this.message.set(ok ? (sub ? '测试通知已发送' : '服务端已收到测试请求') : '发送失败，检查服务端是否运行');
  }
}
