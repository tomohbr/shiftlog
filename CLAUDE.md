# シフトログ（shiftlog）

## プロジェクト概要
エアシフトの代替となるシフト管理アプリ（販売用プロダクト）。

## 技術スタック
- Frontend: React 18 + TypeScript + Vite
- Backend: Express + TypeScript + SQLite (better-sqlite3)
- デプロイ: Railway（GitHub push で自動デプロイ）

## リポジトリ
- GitHub: `tomohbr/shiftlog` (branch: main)
- 本番URL: https://shiftlog-production.up.railway.app（Railwayプロジェクト: shiftlog）

※ `shift-app-production-61b2.up.railway.app` は自社用の別インスタンス。販売用の作業では触らないこと。

## ディレクトリ構成
```
frontend/   - React フロントエンド
backend/    - Express バックエンド
```

## 認証フロー
- 管理者ログイン: メールアドレス + パスワード（必須）
- PINログイン: 会社PIN入力 → スタッフ一覧 → 名前タップ → JWT発行
- 出退勤（Kiosk）: 会社PIN → スタッフ選択 → 打刻
- JWT有効期限: 90日

## デプロイ手順
```bash
git add . && git commit -m "変更内容" && git push origin main
```
Railway が自動でビルド・デプロイする。

## 注意事項
- 日本語で会話すること
- 作業完了後はTelegramで通知すること
