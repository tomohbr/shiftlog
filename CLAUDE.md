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
frontend/          - React フロントエンド
  src/native/      - iOS アプリ専用の層（Webでは no-op）
  ios/             - Capacitor が生成した Xcode プロジェクト（SPM。CocoaPods は使わない）
backend/           - Express バックエンド
  certs/           - Apple ルート証明書（App内課金の JWS 検証用）
docs/              - iOS 化の設計・環境構築・提出手順
store-assets/      - ストア掲載情報・スクリーンショット・アイコン生成
```

## iOS アプリ（App Store 版）
Capacitor 8 で既存の React アプリをネイティブシェルに載せている。ネイティブ固有の実装:

- **オフライン打刻** — 圏外でも打刻でき、復帰後に「打った時刻」のまま同期（`src/native/offlinePunch.ts` / `backend/src/utils/punch.ts`）
- **APNs プッシュ通知** — シフト公開・交代依頼・ヘルプ募集・希望収集開始（`backend/src/utils/apns.ts`）
- **Face ID / Touch ID** — アプリロックとかんたんログイン
- **App内課金（StoreKit 2）** — iOS では Stripe の導線を出さない（Guideline 3.1.1）

```bash
# Web を変更したら iOS に反映する（毎回必要）
cd frontend && npm run build && npx cap sync ios && npx cap open ios
```

提出までの手順は `docs/ios-release.md`。実装状況は `docs/ios-plan.md`。

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
- `frontend/package.json` の `overrides`（`@squareetlabs/capacitor-subscriptions` → `@capacitor/core`）は消さないこと。StoreKitプラグインの peer 競合で `npm install` が ERESOLVE になり Railway のビルドが落ちる
- CORS の設定で許可外オリジンに例外を投げないこと（静的ファイルの配信まで500になる）
