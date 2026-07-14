// 日本時間ヘルパー（サーバーTZに依存せず常にJSTを返す）
// 旧実装は toISOString(UTC日付) + toTimeString(サーバーローカル時刻) で、
// Railway(UTC)では日付も時刻も9時間ズレる事故が起きた。
// 打刻・日付判定など「今のJST」が必要な箇所は必ずここを使うこと。
export function jstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

// "YYYY-MM-DD" (JST)
export function getJSTDate(): string {
  return jstNow().toISOString().split('T')[0];
}

// "HH:MM" (JST)
export function getJSTTime(): string {
  return jstNow().toISOString().split('T')[1].slice(0, 5);
}
