# 流入計測

フロントのビルド環境に `VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX` を設定してビルドする。未設定・空文字ならGA4スクリプトは読み込まれず、DBへの流入保存と短縮URLは利用できる。

GA4は[Google公式のgtag.js初期化方式](https://developers.google.com/tag-platform/gtagjs)で読み込む。依存追加は不要。実際のGA4受信は、測定IDを設定した環境でTag Assistantなどから確認する。

初回訪問のUTM、着地パス、リファラーを `shiftlog_attribution` に保存する。sessionStorage / localStorageとも初回から30日で失効する。途中で別のUTMリンクを踏んでも初回流入を維持し、UTMなしの初回訪問は `direct` になる。過去の会社で流入が未記録の場合、管理APIは `unknown` として集計する。

配布URLは `/r/note-cost` など。定義は `backend/src/data/tracking-links.ts` にあり、未定義コードは `/` に戻す。GETとHEADをともに1アクセスとして記録し、ボットは除外しない。IPはExpressが取得したIPのSHA-256先頭16文字で保存する（プロキシ配下では接続元がプロキシのIPになる場合がある）。

## イベント

すべてのイベントに `campaign_source`, `campaign_medium`, `campaign_name`, `campaign_content`, `landing_path`, `referrer` を付ける。

| イベント | タイミング・追加パラメータ |
|---|---|
| campaign_landing | UTM付き着地。同一セッション・URLで1回 |
| cta_click | LPの登録・ログイン導線。label / location |
| register_start | 登録画面への切り替え |
| register_complete | 登録APIの成功 |
| checkout_click | 決済開始。platform: stripe / apple |
| pro_upgrade_success | checkout=successへの到達、またはIAP検証でPro確認。platform: stripe / apple。復元はrestored: true |

GA4イベントはブラウザから送るため、通信遮断や再訪問などでDBの件数と一致するとは限らない。`checkout=success` のイベント自体は入金確認ではなく、復元イベントも新規購入とは区別する。登録数と現在のPro契約数の確定集計には、保存済みの会社流入元と、決済検証で更新されるsubscriptionsを使う。

```sql
-- 登録した会社数と、現在有効なPro会社数（無料トライアルは含めない）。
SELECT COALESCE(NULLIF(c.acq_source, ''), 'unknown') AS source,
       COUNT(*) AS registrations,
       SUM(CASE WHEN s.plan = 'pro' AND s.status = 'active' THEN 1 ELSE 0 END) AS active_pro
FROM companies c
LEFT JOIN subscriptions s ON s.company_id = c.id
GROUP BY COALESCE(NULLIF(c.acq_source, ''), 'unknown');
```

この集計は現在の契約状態を表す。過去に一度でもアップグレードした会社数や入金履歴の集計は含まない。

## 管理API

すべてsuper_adminの認証が必要。

- `GET /api/admin/users`: 各companyに `acq_source`。
- `GET /api/admin/companies`: `acq_source`。会社一覧の名前横にも表示する。
- `GET /api/admin/activation-funnel`: `bySource: { note: { total: 1, withTimecard: 1 } }` を追加。打刻が複数あっても会社を1件として数える。
- `GET /api/admin/tracking-clicks`: `{ clicks: [{ code: 'note-cost', total: 12, last7d: 3 }, ...] }`。直近7日は現在時刻からの7日間。未クリックの定義済みコードも0件で返す。

## 検証

`node frontend/scripts/test-attribution.cjs` で保存拒否・期限切れ・GA4未設定・イベントの重複防止を検証できる。

一時DBで `DB_PATH=/tmp/shiftlog-tracking.db PORT=3992 node backend/dist/index.js` を起動し、`curl -I http://127.0.0.1:3992/r/note-cost` で302とUTMを確認する。メール送信せず試す場合は `BREVO_API_KEY= SMTP_USER= SMTP_PASS=` を起動時に指定する。
