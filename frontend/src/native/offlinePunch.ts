import { Preferences } from '@capacitor/preferences'
import { Network } from '@capacitor/network'
import { App } from '@capacitor/app'
import { api } from '../api/client'
import { isNative } from './platform'

// オフライン打刻。
//
// 厨房・バックヤード・地下の店舗は電波が入らないことが多く、
// 「圏外だと打刻できない」は勤怠アプリとして致命的。ネイティブアプリにする一番の理由がここ。
//
// 仕組み:
//   1. 打刻はまずサーバーに投げる
//   2. 通信できなければ端末内のキュー（Preferences = iOS の UserDefaults）に積む
//   3. 通信が戻った / アプリが前面に来た / 一定時間ごとに、積んだ順に送り直す
//   4. 各打刻は client_uuid を持ち、サーバー側で冪等化されるので再送しても二重打刻にならない
//
// 再送時だけ「端末が打った時刻」を送る。オンライン初回はサーバー時刻を使う。サーバー到着時刻で記録すると、
// 圏外だった時間ぶんズレた勤怠が残ってしまう。

const QUEUE_KEY = 'shiftlog.punchQueue.v1'

export type PunchAction = 'clock_in' | 'clock_out' | 'break_start' | 'break_end'

const ENDPOINTS: Record<PunchAction, string> = {
  clock_in: '/timecards/clock-in',
  clock_out: '/timecards/clock-out',
  break_start: '/timecards/break-start',
  break_end: '/timecards/break-end',
}

export const ACTION_LABELS: Record<PunchAction, string> = {
  clock_in: '出勤',
  clock_out: '退勤',
  break_start: '休憩開始',
  break_end: '休憩終了',
}

export interface QueuedPunch {
  client_uuid: string
  action: PunchAction
  user_id: number
  user_name: string
  company_id: number
  /** 端末が打刻した時刻（JST, "YYYY-MM-DDTHH:mm"） */
  recorded_at: string
  queued_at: number
  attempts: number
}

export interface PunchResult {
  /** サーバーに届いたか。false ならキューに積まれた */
  synced: boolean
  record?: any
  queued?: QueuedPunch
}

// ---------------------------------------------------------------------------
// 時刻
// ---------------------------------------------------------------------------

/** 端末のタイムゾーンに関係なく JST の "YYYY-MM-DDTHH:mm" を返す */
export function jstStamp(date: Date = new Date()): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${jst.getUTCFullYear()}-${p(jst.getUTCMonth() + 1)}-${p(jst.getUTCDate())}` +
    `T${p(jst.getUTCHours())}:${p(jst.getUTCMinutes())}`
}

function newUuid(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID()
  // randomUUID が無い環境向けのフォールバック
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// ---------------------------------------------------------------------------
// キューの読み書き
// ---------------------------------------------------------------------------

async function readQueue(): Promise<QueuedPunch[]> {
  try {
    const { value } = await Preferences.get({ key: QUEUE_KEY })
    if (!value) return []
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeQueue(queue: QueuedPunch[]): Promise<void> {
  await Preferences.set({ key: QUEUE_KEY, value: JSON.stringify(queue) })
  notify(queue)
}

// 読み取りから保存までを直列化し、同期中の追加を消さない。
let queueUpdate: Promise<unknown> = Promise.resolve()
function updateQueue(update: (queue: QueuedPunch[]) => QueuedPunch[]): Promise<QueuedPunch[]> {
  const next = queueUpdate.then(async () => {
    const queue = update(await readQueue())
    await writeQueue(queue)
    return queue
  })
  queueUpdate = next.catch(() => {})
  return next
}

// ---------------------------------------------------------------------------
// 未同期件数の購読（UI のバッジ用）
// ---------------------------------------------------------------------------

type Listener = (pending: QueuedPunch[]) => void
const listeners = new Set<Listener>()
let lastKnown: QueuedPunch[] = []

function notify(queue: QueuedPunch[]) {
  lastKnown = queue
  listeners.forEach(l => {
    try { l(queue) } catch { /* リスナー側の例外で同期を止めない */ }
  })
}

export function subscribePending(listener: Listener): () => void {
  listeners.add(listener)
  listener(lastKnown)
  return () => { listeners.delete(listener) }
}

export function getPendingSnapshot(): QueuedPunch[] {
  return lastKnown
}

export async function refreshPending(): Promise<QueuedPunch[]> {
  const queue = await readQueue()
  notify(queue)
  return queue
}

// ---------------------------------------------------------------------------
// 打刻
// ---------------------------------------------------------------------------

function isOfflineError(error: any): boolean {
  // レスポンスが返っていない = 通信できていない
  if (error?.response) return false
  return true
}

/**
 * 打刻する。オンラインならそのまま送信し、通信できなければキューに積む。
 * Web（ブラウザ）ではキューを使わず、従来どおり失敗をそのまま投げる。
 */
export async function punch(
  action: PunchAction,
  ctx: { userId: number; userName: string; companyId: number }
): Promise<PunchResult> {
  // Webは通常のPOSTだけで打刻する。
  if (!isNative) {
    const res = await api.post(ENDPOINTS[action], { user_id: ctx.userId })
    return { synced: true, record: res.data?.record }
  }
  const entry: QueuedPunch = {
    client_uuid: newUuid(),
    action,
    user_id: ctx.userId,
    user_name: ctx.userName,
    company_id: ctx.companyId,
    recorded_at: jstStamp(),
    queued_at: Date.now(),
    attempts: 0,
  }

  // 未同期分を追い越さず、必ず末尾へ追加する。
  await refreshPending()
  if (flushing || getPendingSnapshot().length > 0) {
    await updateQueue(queue => [...queue, entry])
    return { synced: false, queued: entry }
  }
  try {
    const res = await send(entry, { includeRecordedAt: false })
    return { synced: true, record: res }
  } catch (error: any) {
    if (!isNative || !isOfflineError(error)) throw error

    await updateQueue(queue => [...queue, entry])
    return { synced: false, queued: entry }
  }
}

async function send(entry: QueuedPunch, { includeRecordedAt }: { includeRecordedAt: boolean }): Promise<any> {
  const res = await api.post(
    ENDPOINTS[entry.action],
    {
      user_id: entry.user_id,
      client_uuid: entry.client_uuid,
      ...(includeRecordedAt ? { recorded_at: entry.recorded_at } : {}),
    },
    // キューを流すときは選択中の会社が変わっている可能性があるので、
    // 打刻したときの会社を明示する
    { headers: { 'X-Company-Id': String(entry.company_id) } }
  )
  return res.data?.record
}

// ---------------------------------------------------------------------------
// 同期
// ---------------------------------------------------------------------------

export interface FlushResult {
  synced: number
  /** サーバーに拒否されて破棄した打刻（重複・出勤打刻なし など） */
  rejected: { entry: QueuedPunch; reason: string }[]
  remaining: number
}

let flushing = false

/** 溜まった打刻を古い順に送る。通信エラーが出たらそこで中断し、順序を保つ。 */
export async function flushQueue(): Promise<FlushResult> {
  const result: FlushResult = { synced: 0, rejected: [], remaining: 0 }
  if (flushing) {
    result.remaining = (await readQueue()).length
    return result
  }
  flushing = true

  try {
    let queue = await readQueue()
    if (queue.length === 0) {
      notify(queue)
      return result
    }
    if (!localStorage.getItem('token')) {
      // 未ログイン中は送れない。ログイン後に再度呼ばれる。
      result.remaining = queue.length
      return result
    }

    while (queue.length > 0) {
      const entry = queue[0]
      try {
        await send(entry, { includeRecordedAt: true })
        result.synced++
        queue = await updateQueue(current => current.filter(item => item.client_uuid !== entry.client_uuid))
      } catch (error: any) {
        const status = error?.response?.status

        if (status && status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429) {
          // 「既に出勤打刻済み」「出勤打刻がありません」など、再送しても直らないもの。
          // 残し続けると永久に詰まるので捨てて、呼び出し側に伝える。
          result.rejected.push({
            entry,
            reason: error?.response?.data?.error || '同期できませんでした',
          })
          queue = await updateQueue(current => current.filter(item => item.client_uuid !== entry.client_uuid))
          continue
        }

        // 通信エラー / 認証切れ / サーバーエラーは順序を保ったまま次回に回す
        entry.attempts++
        queue = await updateQueue(current => current.map(item => item.client_uuid === entry.client_uuid ? entry : item))
        break
      }
    }

    result.remaining = queue.length
    return result
  } finally {
    flushing = false
  }
}

// ---------------------------------------------------------------------------
// 起動時の配線
// ---------------------------------------------------------------------------

type FlushHandler = (result: FlushResult) => void
let onFlushed: FlushHandler | null = null
// 画面側の購読開始前に完了した結果も一度だけ通知する。
let pendingFlush: FlushResult | null = null

export function setFlushHandler(handler: FlushHandler | null): void {
  onFlushed = handler
  if (handler && pendingFlush) {
    const result = pendingFlush
    pendingFlush = null
    handler(result)
  }
}

async function tryFlush() {
  const result = await flushQueue()
  if (result.synced > 0 || result.rejected.length > 0) {
    if (onFlushed) onFlushed(result)
    else pendingFlush = {
      synced: (pendingFlush?.synced || 0) + result.synced,
      rejected: [...(pendingFlush?.rejected || []), ...result.rejected],
      remaining: result.remaining,
    }
  }
}

let initialized = false

/** 通信復帰・アプリ復帰・定期実行で自動同期する。ネイティブでのみ動く。 */
export async function initOfflinePunch(): Promise<void> {
  if (!isNative || initialized) return
  initialized = true

  await refreshPending()

  try {
    setOnlineState((await Network.getStatus()).connected)
  } catch { /* 取得できなければオンライン扱いのまま */ }

  Network.addListener('networkStatusChange', status => {
    setOnlineState(status.connected)
    if (status.connected) void tryFlush()
  })

  App.addListener('appStateChange', state => {
    if (state.isActive) void tryFlush()
  })

  // 通信状態のイベントを取りこぼしても最終的に送られるようにする保険。
  // キューが空のときはストレージを読みに行かない（キオスク端末は一日中この画面を開いている）
  setInterval(() => { if (lastKnown.length > 0) void tryFlush() }, 60_000)

  void tryFlush()
}

// ---------------------------------------------------------------------------
// オンライン状態（画面のバナー用）。ポーリングせず Network のイベントで更新する
// ---------------------------------------------------------------------------

let onlineState = true
const onlineListeners = new Set<(online: boolean) => void>()

function setOnlineState(online: boolean) {
  if (onlineState === online) return
  onlineState = online
  onlineListeners.forEach(l => {
    try { l(online) } catch { /* リスナー側の例外は無視 */ }
  })
}

/** オンライン/オフラインの変化を購読する。呼んだ直後に現在値を1回渡す。 */
export function subscribeOnline(listener: (online: boolean) => void): () => void {
  onlineListeners.add(listener)
  listener(isNative ? onlineState : navigator.onLine)
  return () => { onlineListeners.delete(listener) }
}

/** 現在オンラインかどうか（打刻ボタンの表示に使う） */
export async function isOnline(): Promise<boolean> {
  if (!isNative) return navigator.onLine
  try {
    return (await Network.getStatus()).connected
  } catch {
    return true
  }
}
