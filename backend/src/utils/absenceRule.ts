import db from '../db';

// 「前日・当日の休みは必ず電話で」のようなお店の決まり。
// LINE の「休みの連絡」と Web の欠勤連絡の両方で使う。
// absence_phone_days: NULL=制限なし、0=当日だけ電話、1=前日・当日は電話、2=2日前から電話

const jstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

export function daysUntil(date: string): number {
  return Math.round((new Date(`${date}T00:00:00Z`).getTime() - new Date(`${jstToday()}T00:00:00Z`).getTime()) / 86400000);
}

export function absenceRule(companyId: number, storeId?: number | null): { days: number | null; phone: string | null } {
  const s = db.prepare('SELECT absence_phone_days, absence_phone FROM line_settings WHERE company_id = ?').get(companyId) as any;
  const store = storeId ? db.prepare('SELECT phone FROM stores WHERE id = ?').get(storeId) as any : null;
  const company = db.prepare('SELECT phone FROM companies WHERE id = ?').get(companyId) as any;
  return {
    days: s?.absence_phone_days ?? null,
    // 電話番号は お店の休み連絡用 → 会場 → 会社 の順
    phone: s?.absence_phone || store?.phone || company?.phone || null,
  };
}

/** この日のシフトの休みは電話でしか受けないか */
export function phoneOnly(companyId: number, date: string, storeId?: number | null): boolean {
  const { days } = absenceRule(companyId, storeId);
  return days !== null && daysUntil(date) <= days;
}

export function phoneOnlyMessage(companyId: number, storeId?: number | null): string {
  const { days, phone } = absenceRule(companyId, storeId);
  const when = days === 0 ? '当日' : days === 1 ? '前日・当日' : `${days}日前から当日まで`;
  const contact = (db.prepare('SELECT contact_name FROM line_settings WHERE company_id = ?').get(companyId) as any)?.contact_name;
  return `${when}のお休みは、LINEではなく必ず${contact ? `担当の${contact}` : 'お店'}に電話してください。${phone ? `\n📞 ${phone}` : ''}`;
}
