# App Review 返信（Guideline 2.1 Information Needed / 2026-09-08 差し戻し）

差し戻し内容: 新規デベロッパーアカウントのため、1〜7 の追加情報と**実機の画面録画**を求められた。
返信は App Store Connect の提出詳細ページ「App Reviewに返信」から、下の英文＋録画ファイルを添付して送る。
同じ内容を App Review Information の Notes にも入れる（API で反映済み）。

## 画面録画の撮り方（本人がやること・iPhone）

1. iPhone に TestFlight アプリを入れ、b.tomo.17@icloud.com でサインイン → 「シフトログ」ビルド 1.0.0 (3) をインストール
2. コントロールセンターの「画面収録」を開始してから、以下の順に操作する（5〜8分でよい。声は不要）
   1. ホーム画面からアプリを起動する（録画はここから始まっていること）
   2. 「新規登録」で会社を作る（メール・パスワード・会社名。捨てアドレスでよい）
   3. 店舗を1つ作る → スタッフを1人登録する → シフトを1件入れて公開する
   4. 設定 → プラン →「Proにアップグレード」を押す。**プラン説明（月額 ¥980 / 年払い ¥9,800・自動更新・利用規約とプライバシーポリシーのリンク）が画面に映るように2秒止める** → StoreKit の購入シートが出たら「キャンセル」でよい（Sandbox で購入まで進めるならなお良い）
   5. 設定の一番下の「利用規約」「プライバシーポリシー」を1回ずつ開く
   6. ログアウト → 「スタッフログイン」で会社PIN → 名前タップ → 打刻画面で「出勤」→「退勤」
   7. 機内モードにして打刻 →「端末に記録しました」→ 機内モードを解除 →「未同期だった打刻を送信しました」（オフライン打刻の証明）
   8. オーナーで再ログイン → 設定 → 一番下「アカウントの削除」→ 確認して削除まで実行する（最後まで）
3. 録画を止め、動画を Mac に AirDrop する（`~/Downloads` に入れば私が返信に添付する）

## 返信本文（英語）

Thank you for reviewing ShiftLog. Please find the requested information below. A screen recording captured on a physical iPhone (iOS 26) is attached, and the same information has been added to the App Review Notes.

1. Screen recording (attached)
The recording starts from launching the app and shows: account registration (owner) → creating a store, registering staff, creating and publishing a shift → the Pro subscription screen (Settings > Plan) showing the subscription title, length, price, and the links to the Terms of Use (EULA) and Privacy Policy, followed by the StoreKit purchase sheet → staff PIN login and clock-in/out → offline clock-in in Airplane Mode and automatic sync after reconnecting → account deletion from Settings. The app has no public user-generated content: shifts, requests and notes are visible only inside the user's own company (a closed group of the owner and their staff), so there is no public feed that would require reporting/blocking mechanisms.

2. Purpose and target audience
ShiftLog is a shift-scheduling and time-clock app for small restaurants and retail shops in Japan (typically 1–3 stores, 5–30 part-time staff). Owners/managers build and publish monthly shifts, collect staff availability, and see worked hours and labor cost; staff view their shifts and clock in/out on their own phone. The problem it solves: small shops still manage shifts on paper or chat apps, and clock-in records are lost when the shop has no signal (kitchens, basements). ShiftLog records punches offline on the device and syncs them later with the original timestamp.

3. Setup and access
Demo credentials are in the App Review Information section (owner account: appreview+20260907@shiftlog.app; company PIN 9899 for staff login; staff PINs listed in the notes). No sample files are needed. Owner login: tap "オーナー・店長ログイン" (Owner/Manager login) on the start screen. Staff login: tap "スタッフログイン", enter company PIN 9899, then tap a name. Main features are in the left menu: シフト管理 (Shifts), 勤怠 (Timecards), 集計 (Reports), スタッフ (Staff), 設定 (Settings).

4. External services used
- Our own backend API hosted on Railway (Node.js/Express, SQLite) — all app data.
- Apple Push Notification service (APNs) — shift published / swap request notifications.
- Apple StoreKit 2 and App Store Server API — in-app subscriptions and receipt verification; App Store Server Notifications V2 for renewals/cancellations.
- Brevo — transactional email (registration confirmation, password reset, feedback notifications to the developer).
- No third-party authentication provider, no analytics SDK in the iOS build, no AI services, no advertising. Stripe is used only on the web version; the iOS app contains no external purchase links.

5. Regional differences
None. The app is offered in Japanese and functions identically in all regions. Prices are set through App Store Connect pricing.

6. Regulated industry / third-party material
Not applicable. ShiftLog is a general business productivity tool and contains no protected third-party material.

7. In-App Purchase overview
Two auto-renewable subscriptions in one group ("シフトログ Pro"): monthly ¥980 and yearly ¥9,800. Pro unlocks past-month reports, CSV export, payroll-software export, and unlimited staff (Free plan: 1 store, up to 5 staff; clock-in, shifts, and current-month totals stay free). Navigation: log in as owner → 設定 (Settings) → プラン (Plan) → "Proにアップグレード" (monthly) or "年払い" (yearly). A "購入を復元" (Restore Purchases) button and links to the Terms of Use and Privacy Policy are on the same screen.

Please let us know if anything else is needed.
