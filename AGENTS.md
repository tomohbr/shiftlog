# AGENTS.md — シフトログ（販売用）

コーディングエージェント向けの作業規約。人向けの概要は `CLAUDE.md` を参照。

## 構成
- `frontend/` React 18 + TypeScript + Vite + Tailwind 3。`src/pages/*.tsx` が画面、`src/components/` が共通部品、`src/api/client.ts` がAPI型と呼び出し
- `frontend/src/native/` iOS（Capacitor）専用。Web では no-op。ここを壊さないこと
- `backend/` Express + better-sqlite3。`src/routes/*.ts` がAPI、`src/db.ts` がスキーマとマイグレーション
- 本番は Railway。`main` に push すると自動デプロイされる

## 必ず守ること
- **依存パッケージを増やさない**（Tailwind と lucide-react の範囲で作る）
- API のリクエスト/レスポンス形は変えない。フロント側の見た目・構造の変更に留める
- コメント・UI文言は日本語。既存コードの命名・書き方に合わせる
- `frontend/.npmrc` と CORS 設定（`backend/src/index.ts`）には触らない
- 画面幅 375〜440px（iPhone）を第一に考える。PC幅（1024px以上）の既存レイアウトは壊さない
- ダークモードは `.dark` クラスで既存の置換ルール（`index.css`）が効く。`bg-white` / `text-gray-900` など既存のトークンを使えば自動で追従する

## 検証コマンド（作業の最後に必ず通す）
```bash
cd frontend && npx tsc --noEmit && npm run build
cd backend  && npx tsc --noEmit && npm run build
```

## 画面の確認方法（任意）
```bash
# 一時DBでサーバーを起動し、デモデータ入りアカウントを作る
cd backend && npm run build
DB_PATH=/tmp/shiftlog-ui.db PORT=3991 node dist/index.js &
API_BASE=http://127.0.0.1:3991 REVIEW_EMAIL=ui@example.com REVIEW_PASSWORD=Screenshot123 node scripts/create-review-account.js

# iPhone 6.9インチ相当（440×956 @3x）でスクリーンショットを撮る
cd ../store-assets
SHIFTLOG_URL=http://127.0.0.1:3991 SHIFTLOG_EMAIL=ui@example.com SHIFTLOG_PASSWORD=Screenshot123 node take-screenshots-ios.js
```
