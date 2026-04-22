import db from '../db';

export interface AuditEntry {
  userId?: number | null;
  companyId?: number | null;
  action: 'create' | 'update' | 'delete' | 'login' | 'logout' | 'publish' | 'cancel' | 'bulk_import' | 'export' | string;
  entity: string;
  entityId?: number | null;
  summary?: string;
  detail?: any;
}

export function logAudit(entry: AuditEntry): void {
  try {
    db.prepare(
      'INSERT INTO audit_logs (user_id, company_id, action, entity, entity_id, summary, detail) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      entry.userId ?? null,
      entry.companyId ?? null,
      entry.action,
      entry.entity,
      entry.entityId ?? null,
      entry.summary ?? null,
      entry.detail ? JSON.stringify(entry.detail).slice(0, 2000) : null
    );
  } catch (e) {
    // ログ失敗は無視（メインのリクエスト処理を邪魔しない）
    console.error('[audit] failed to log:', e);
  }
}
