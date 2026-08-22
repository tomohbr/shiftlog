# iOS 化 実装計画書

販売用シフトログを App Store に出すための設計と作業計画。前提は `ios-setup.md` を完了していること。

---

## 0. 方針

既存の React + Vite アプリを **Capacitor** でネイティブシェルに載せる。ただし「WebViewで包んだだけ」では審査を通らないため、**ネイティブでしか実現できない機能を実装する**ことが本質的な作業になる。

```
┌─────────────────────────────────────┐
│ iOS アプリ（Capacitor シェル）        │
│  ┌───────────────────────────────┐  │
│  │ WKWebView                     │  │
│  │  既存の React アプリ（そのまま） │  │
│  └───────────────────────────────┘  │
│  ネイティブ層で追加するもの:           │
│   - オフライン打刻キュー               │
│   - APNs プッシュ通知                 │
│   - Face ID / Touch ID                │
│   - ウィジェット（今日のシフト）        │
│   - カメラ（QR読み取り）               │
│   - StoreKit 2（IAP）                 │
└─────────────────────────────────────┘
              ↕ HTTPS
     Railway 上の Express + SQLite（既存）
```

WebView が読むのは**バンドルしたローカルアセット**にする（`server.url` でリモートを直接読ませない）。リモートURLを読むだけの構成は Guideline 4.2 で弾かれやすく、オフライン動作も作れない。

---

## 1. 審査ブロッカーと対応状況

| # | ガイドライン | 内容 | 状態 |
|---|---|---|---|
| 1 | **5.1.1(v)** | アカウント作成できるアプリは、アプリ内から削除もできること | ✅ **実装済み**（2026-08-22） |
| 2 | **4.2** | 最低限の機能。Webサイトのラッパーは却下 | ⬜ 未着手（本計画の主作業） |
| 3 | **3.1.1** | アプリ内で使うデジタルコンテンツは IAP 必須 | ⬜ 未着手 |
| 4 | **5.1.1** | プライバシーポリシーの掲示 | △ LPに記載あり、公開URLの確定が必要 |
| 5 | **2.1** | 審査用のデモアカウント提供 | ⬜ 未着手 |

### 1-1. アカウント削除（実装済み）

App Store で最も機械的に弾かれる要件。以下を実装済み。

- `GET /api/auth/account` — 退会すると何が消えるかの事前提示
  - 自分が唯一の管理者である会社 → **会社ごと全データ削除**
  - 他に管理者がいる会社 → **自分だけ退出**
- `DELETE /api/auth/account` — 実行。パスワード確認（PINのみのスタッフは「削除」入力）
- Stripe のサブスクリプションを削除前に解約
- 設定画面（`/settings`）に「アカウントの削除」セクションと確認モーダル

あわせて、既存の会社削除が23テーブル中6テーブルしか消しておらず孤児データが残っていた問題も、共通処理 `deleteCompanyData()` に統一して修正済み。

---

## 2. Guideline 4.2 対策：実装するネイティブ機能

「通知を出せます」程度では通らない。**打刻アプリとして本当に必要な機能**を選んでいる。優先度順。

### 優先度1: オフライン打刻（最重要）

厨房・バックヤード・地下店舗は電波が入らないことが多く、「圏外だと打刻できない」は実務上の致命傷。ここを解決するとネイティブである理由が明確になり、4.2 の説明も通しやすい。

- 打刻を端末内（SQLite / Preferences）にキューとして保存
- オンライン復帰時にバックグラウンドで自動同期
- UI に「未同期 n件」を表示
- サーバー側は打刻時刻を**クライアントが記録した時刻**で受け付ける必要がある
  - 現状 `routes/timecards.ts` は `getJSTTime()` でサーバー時刻を使っている。**オフライン対応には API 変更が必要**（`recorded_at` を任意パラメータとして受け付ける／改ざん対策に端末時刻とサーバー受信時刻の両方を保存）

### 優先度2: プッシュ通知（APNs）

既に `push_subscriptions` テーブルと Web Push の実装がある。iOS ではネイティブの APNs に載せ替える。

通知すべき実イベント（「汎用的な通知許可プロンプトだけ」は却下理由になる）:
- シフトが確定・公開された
- シフト申請が承認 / 却下された
- 交代依頼が届いた（`shift_swaps`）
- 退勤打刻を忘れている（時間ベース）

### 優先度3: Face ID / Touch ID ログイン

店舗の共有端末でもスタッフ個人の端末でも効く。JWT の有効期限は90日なので、再認証を生体認証に置き換えると体験が明確に良くなる。

### 優先度4: ウィジェット（今日のシフト）

ホーム画面/ロック画面に今日の出勤時間を出す。**ネイティブでしか作れない**ため、4.2 に対する反論材料として強い。

### 優先度5: カメラでQR読み取り

`qrcode.react` を使った `QrPosterPage` が既にあり、キオスク打刻の導線がある。カメラでのスキャンを追加する。

---

## 3. Guideline 3.1.1 対策：IAP の実装

**方針: IAP を実装する**（2026-08-22 決定）

### 現状

`backend/src/routes/billing.ts` が Stripe Checkout で Pro（¥980/月/店舗）を販売している。iOS アプリ内からこの決済導線を出すと 3.1.1 違反で却下される。

### 設計

```
Web（ブラウザ）        →  Stripe Checkout      → subscriptions.platform = 'stripe'
iOS アプリ             →  StoreKit 2 (IAP)     → subscriptions.platform = 'apple'
```

1. **App Store Connect でサブスクリプション商品を作成**
   - 商品ID: `com.shiftlog.app.pro.monthly`
   - 価格: ¥980/月（Apple の価格帯から選択）
   - 手数料: 15%（Small Business Program 適用時。年間100万ドル以下なら申請可能）→ 手取り ¥833
   - Stripe の場合の手数料は3.6%程度なので、**iOS経由だと1件あたり約110円/月の目減り**

2. **DB スキーマ変更**（`subscriptions` テーブル）
   ```sql
   ALTER TABLE subscriptions ADD COLUMN platform TEXT DEFAULT 'stripe';
   ALTER TABLE subscriptions ADD COLUMN apple_transaction_id TEXT;
   ALTER TABLE subscriptions ADD COLUMN apple_original_transaction_id TEXT;
   ```
   既存の migration 機構（`db.ts` の `_migrations`）に追加する。

3. **クライアント**: Capacitor の StoreKit プラグインで購入 → レシート（JWS）をサーバーに送信

4. **サーバー**: 新規 `POST /api/billing/apple/verify`
   - App Store Server API で JWS を検証
   - `subscriptions` を `plan='pro', platform='apple'` に更新

5. **サーバー**: 新規 `POST /api/billing/apple/notifications`
   - App Store Server Notifications V2 の受信口
   - 更新・解約・返金・課金失敗を受けて `subscriptions.status` を同期
   - Stripe webhook（`billing.ts:174`）と同じ役割

6. **UI 分岐**: iOS アプリからのアクセス時は Stripe の導線を隠し、IAP 導線を出す
   - Capacitor の `isNativePlatform()` で判定
   - **iOS アプリ内から「Webで契約してください」と誘導するのは 3.1.1 違反**（日本のスマホ新法により外部決済の扱いは変わりつつあるが、Apple の運用が確定するまでは安全側に倒す）

7. **解約導線**: IAP 契約者には Apple の「サブスクリプションの管理」画面へのリンクを出す（Stripe カスタマーポータルではなく）

> **注意**: これは本計画で最も重い作業。Stripe と Apple の二重管理が発生し、返金・課金失敗・プラン変更のすべてで両系統の同期を考える必要がある。

---

## 4. その他の提出要件

### プライバシーポリシー
LP（`shiftlog-lp/index.html`）内に記載があるが、**単独の公開URLが必要**。`https://tomohbr.github.io/shiftlog-lp/` が生きているか確認し、無ければ GitHub Pages で公開する。

### 審査用デモアカウント（Guideline 2.1）
ログインが必要なアプリは、審査員が使えるアカウントを提出必須。
- 管理者アカウント1つ（メール+パスワード）
- スタッフのPINログイン用の会社PIN
- データが入った状態にしておく（空だと「機能が確認できない」で却下される）

### App Privacy（プライバシーラベル）
収集項目の申告。シフトログで該当するもの:
- 連絡先情報（メールアドレス、氏名、電話番号）
- 識別子（ユーザーID）
- 使用状況データ（`audit_logs`）
- 診断
※ 位置情報は現状収集していない。**打刻時のGPS取得を追加する場合はラベルの更新が必要**。

### 特定商取引法
`TokushohoPage.tsx` が既にある。App Store の掲載情報からもリンクできるようにする。

---

## 5. 作業フェーズと目安

| フェーズ | 作業 | 目安 | 前提 |
|---|---|---|---|
| **P0** | Apple Developer Program 加入 | 即日〜数週間 | — |
| **P0** | 環境構築（Xcode 26 / Node / CocoaPods） | 半日 | — |
| **P1** | Capacitor 導入、iOS プロジェクト生成、実機起動 | 1日 | P0 |
| **P1** | ローカルアセット配信への切り替え、API接続先の設定 | 1日 | P1 |
| **P2** | オフライン打刻（API変更含む） | 3〜5日 | P1 |
| **P2** | APNs プッシュ通知 | 2〜3日 | P1 |
| **P2** | Face ID / Touch ID | 1日 | P1 |
| **P3** | IAP（StoreKit 2 + サーバー検証 + 通知受信） | 5〜8日 | P0 |
| **P3** | ウィジェット | 2〜3日 | P1 |
| **P3** | QRスキャン | 1日 | P1 |
| **P4** | アイコン・スクリーンショット・掲載情報 | 1日 | — |
| **P4** | TestFlight で内部テスト | 2日 | P1〜P3 |
| **P4** | 審査提出・リジェクト対応 | 1〜3週間 | すべて |

**最短でも1.5〜2ヶ月**、IAP とネイティブ機能をきちんと作るなら2〜3ヶ月を見ておく。初回審査で 4.2 が返ってくる前提で、反論用に「ネイティブ機能の説明とスクリーンショット」を審査メモに書く準備をしておく。

---

## 6. 最初の一歩（環境が整い次第）

```bash
cd ~/カンパニー/shiftlog/frontend

npm install @capacitor/core @capacitor/cli
npx cap init "シフトログ" com.shiftlog.app --web-dir=dist

npm install @capacitor/ios
npm run build
npx cap add ios
npx cap open ios     # Xcode が開く
```

`com.shiftlog.app` は Google Play（TWA）で使っている Package ID と揃えてある（`store-assets/twa-manifest.json`）。
