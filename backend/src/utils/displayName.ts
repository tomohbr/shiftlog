import db from '../db';

// 呼び名（下の名前）の自動設定。
// その会社がスタッフを呼び名で表示している（バイト・パートの誰かに呼び名が入っている）ときだけ、
// 新しく入った人の氏名から下の名前を取り出して呼び名に入れる。氏名に区切り（空白）が無ければ入れない。
export function givenNameOf(name: string | null | undefined): string | null {
  const parts = String(name || '').trim().split(/[\s　]+/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 1].slice(0, 20) : null;
}

export function usesDisplayNames(companyId: number): boolean {
  return !!db.prepare(
    "SELECT 1 FROM user_companies WHERE company_id = ? AND role = 'staff' AND display_name IS NOT NULL AND display_name != '' LIMIT 1"
  ).get(companyId);
}

// 戻り値: 入れた呼び名（入れなかった・入れられなかったら null）。呼び名を使っていない会社では何もしない。
export function autoDisplayName(companyId: number, userId: number, name: string | null | undefined): { used: boolean; set: string | null } {
  if (!usesDisplayNames(companyId)) return { used: false, set: null };
  const g = givenNameOf(name);
  if (g) db.prepare("UPDATE user_companies SET display_name = ? WHERE user_id = ? AND company_id = ? AND (display_name IS NULL OR display_name = '')").run(g, userId, companyId);
  return { used: true, set: g };
}
