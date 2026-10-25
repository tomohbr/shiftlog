// 画面の用語。
// 普通のお店では「店舗」。催事モード（クリスマスマーケットなど複数ブースの運用）の会社だけ「会場」と呼ぶ。
// 同じ画面を両方で使うので、文言はここを通して出し分ける。
export function venueWord(company?: { event_mode?: boolean } | null): string {
  return company?.event_mode ? '会場' : '店舗'
}

export function isEventMode(company?: { event_mode?: boolean } | null): boolean {
  return !!company?.event_mode
}
