# AirShift - シフト管理システム

AirShiftクローン。日本の店舗向けシフト管理Webアプリケーション。

## 機能

- ログイン認証（管理者 / スタッフ）
- 店舗管理
- スタッフ管理（追加・編集・削除・パスワードリセット）
- シフト作成・編集（月次カレンダー表示、横断テーブル表示）
- シフト申請（スタッフが希望シフトを申請）
- シフト確定・公開
- 勤務時間集計・給与計算・CSV出力

## 起動方法

### 方法1: 一括起動（Windows）

```
start.bat をダブルクリック
```

### 方法2: 手動起動

**バックエンド:**
```bash
cd backend
npm install
npm run dev
```

**フロントエンド:**
```bash
cd frontend
npm install
npm run dev
```

## アクセス

- フロントエンド: http://localhost:5173
- バックエンドAPI: http://localhost:3001

## デモアカウント

| 役割 | メールアドレス | パスワード |
|------|--------------|----------|
| 管理者 | admin@example.com | admin123 |
| スタッフ | staff1@example.com | staff123 |
| スタッフ | staff2@example.com | staff123 |

## 技術スタック

- **フロントエンド**: React + TypeScript + Vite + Tailwind CSS
- **バックエンド**: Node.js + Express + TypeScript
- **データベース**: SQLite (better-sqlite3)
- **認証**: JWT
