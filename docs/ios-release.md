# App Store 提出手順書（ここから先の作業）

コード側の実装は完了している。この手順書は、**Apple のアカウントと Xcode を用意してから提出するまで**の作業をそのまま上から実行できるようにまとめたもの。

実装済みの内容は `ios-plan.md` の状況表を参照。環境の前提は `ios-setup.md`。

---

## 0. 現在地

| | 状態 |
|---|---|
| コード（オフライン打刻・APNs・Face ID・IAP・法的ページ） | ✅ 実装済み・型チェックとビルドが通る |
| iOS プロジェクト（`frontend/ios`） | ✅ 生成済み・Info.plist と署名設定を調整済み |
| アプリアイコン（1024×1024・アルファなし） | ✅ 生成済み |
| App Store 用スクリーンショット（1320×2868） | ✅ 撮影済み（`store-assets/screenshots-ios/`） |
| Apple Developer Program | ✅ 加入済み（個人 / Team ID `A6T9273A37`） |
| Xcode | ✅ 26.6 導入済み。署名IDあり。キーチェーンは codesign を「常に許可」済み |
| Bundle ID | ✅ `com.tomohbr.shiftlog`（`com.shiftlog.app` は他チームに取られていたため変更。2026-09-07） |
| Archive / IPA | ✅ **2026-09-07 `xcodebuild archive` → `-exportArchive`（app-store-connect）まで無人で成功** |
| App Store Connect のアプリレコード | ✅ 作成済み（2026-09-07） |
| 初回ビルドのアップロード | ✅ **1.0.0 (1) をアップロード済み（2026-09-07 12:22）。処理後 TestFlight に表示される** |
| App Store Connect の設定 | ✅ 2026-09-07 完了: 1.0 メタデータ・審査用サインイン情報・App情報（カテゴリ/年齢 4+/サーバ通知URL）・App Privacy（公開済み）・サブスクリプション2商品（月額 ¥980 / 年額 ¥9,800）・ビルド 1.0.0(1) 紐付け |
| スクリーンショット（アプリ本体 / IAP審査用） | ✅ 2026-09-07 夜、ASC API（`store-assets/asc-upload.mjs`）で添付済み。7枚 COMPLETE、IAP 2商品 READY_TO_SUBMIT |
| 説明文・プロモーション文 | ✅ 5名無料・年払い版に更新済み（API） |
| ビルド 1.0.0 (2)（5名無料・年払い対応） | ✅ 2026-09-07 19:52 処理完了・バージョン 1.0 に紐付け済み |
| App内課金のサーバー設定（環境変数） | ✅ 2026-09-07 20:30 Railway CLI で `APPLE_IAP_*` 7変数を投入・再デプロイ。本番 `apple_configured: true` を確認 |
| APNs のサーバー設定（環境変数） | ❌ 未設定（APNs キーの発行・ダウンロードは本人の操作。落ちたら CLI で `APNS_*` を投入） |

Archive とエクスポートはコマンドで再現できる（付録参照）。App Store Connect のアプリ作成だけは Web 画面での操作が必要。

---

## 1. Apple Developer Program に加入する（最優先）

年額 12,980円。個人（Individual）で登録すると決定済み。写真付き身分証が必要。

https://developer.apple.com/programs/enroll/

詳細は `ios-setup.md` の「1. Apple Developer Program に加入する」を参照。**承認されるまで App Store Connect でアプリを作れず、証明書も作れない**ので、Xcode のダウンロードと並行して真っ先に着手する。

---

## 2. Xcode 26 をインストールする

Mac App Store から「Xcode」を入れる（15GB以上・回線によっては数時間）。インストール後:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
xcodebuild -version
```

> **CocoaPods は不要。** Capacitor 8 は Swift Package Manager を使うため、`Podfile` は生成されない。`ios-setup.md` の「4. CocoaPods」は読み飛ばしてよい。

---

## 3. Xcode でプロジェクトを開く

```bash
cd ~/カンパニー/shiftlog/frontend
npm install
npm run build        # dist を作る（アプリはこれをバンドルして読む）
npx cap sync ios     # dist を ios/App/App/public にコピーし、プラグインを同期
npx cap open ios     # Xcode が開く
```

Xcode 側で以下を確認する。

1. **Signing & Capabilities タブ**
   - Team: 加入した Apple Developer アカウントを選択
   - Bundle Identifier: `com.tomohbr.shiftlog`（設定済み）
   - Automatically manage signing: オン
2. **Capabilities に以下が入っているか**（`App.entitlements` を先に用意してあるので、Push Notifications は自動で認識されるはず）
   - **Push Notifications** — 入っていなければ「+ Capability」から追加
   - **In-App Purchase** — 「+ Capability」から追加（entitlements ファイルには何も増えない）
3. シミュレータを選んで ⌘R で起動し、ログインまで動くことを確認する

> Web アセットを更新したら毎回 `npm run build && npx cap sync ios` が必要。これを忘れると古い画面のままビルドされる。

---

## 4. App Store Connect でアプリを作る

https://appstoreconnect.apple.com/ → マイApp → 「+」

| 項目 | 値 |
|---|---|
| プラットフォーム | iOS |
| 名前 | シフトログ - シフト管理・勤怠打刻 |
| プライマリ言語 | 日本語 |
| バンドルID | `com.tomohbr.shiftlog` |
| SKU | `shiftlog-ios-001` |

作成後、**App Store 上のアプリID（数値）** を控える。URL の `/app/` の後ろの数字。あとで `APPLE_APP_APPLE_ID` に設定する。

掲載情報（説明文・キーワード・スクリーンショット等）は `store-assets/app-store-listing.md` の内容をそのまま貼る。

---

## 5. App内課金の商品を登録する

App Store Connect → 対象アプリ → 「App内課金」→ サブスクリプション

1. サブスクリプショングループを作る（例: `シフトログ プラン`）
2. サブスクリプションを追加

| 項目 | 値 |
|---|---|
| 参照名 | シフトログ Pro（月額） | シフトログ Pro（年額） |
| 製品ID | `com.tomohbr.shiftlog.pro.monthly` | `com.tomohbr.shiftlog.pro.yearly` |
| 期間 | 1ヶ月 | 1年 |
| 価格 | ¥980 | ¥9,800 |
| 表示名 | シフトログ Pro | シフトログ Pro（年払い） |
| 説明 | 過去月の集計・CSV出力・給与ソフト連携・スタッフ数無制限が使えるプランです。 | 同左。2ヶ月分お得。 |

2商品は**同じサブスクリプショングループ**に入れる。Free プランは 1店舗・スタッフ5名まで（2026-09-07 に 30名から変更）。

3. **審査用の情報**にスクリーンショット（購入画面）と、以下のメモを入れる
   > 設定画面の「プラン」セクションから購入できます。審査用アカウントでログイン後、左メニュー「設定」→「プラン」→「Proにアップグレード」。

4. **Small Business Program に申請する**（年間売上100万ドル以下なら手数料 30% → 15%）
   https://developer.apple.com/app-store/small-business-program/
   **申請を忘れると手取りが月あたり約147円/件 減る。**

> 製品IDを変える場合は、環境変数 `APPLE_PRO_PRODUCT_ID` とフロントの `frontend/src/native/iap.ts` の `PRO_PRODUCT_ID` の両方を合わせること。

---

## 6. サーバー側の環境変数を設定する（Railway）

Railway のプロジェクト `shiftlog` → Variables に追加する。**未設定でも Web は今までどおり動く**（プッシュ通知と App内課金だけが無効になる）。

### 6-1. App内課金の検証（App Store Server API）

App Store Connect → ユーザーとアクセス → 「統合」→ App Store Connect API →
**「App内課金」キー**を作成し、`.p8` をダウンロード（**再ダウンロード不可**）。

| 変数 | 値 |
|---|---|
| `APPLE_IAP_KEY_ID` | 作成したキーの Key ID |
| `APPLE_IAP_ISSUER_ID` | 同じ画面に表示される Issuer ID（UUID） |
| `APPLE_IAP_PRIVATE_KEY` | `.p8` の中身をそのまま貼る（改行は `\n` にエスケープしてもよい） |
| `APPLE_APP_APPLE_ID` | 手順4で控えたアプリID（数値） |
| `APPLE_BUNDLE_ID` | `com.tomohbr.shiftlog`（既定値と同じなので省略可） |
| `APPLE_PRO_PRODUCT_ID` | `com.tomohbr.shiftlog.pro.monthly`（同上） |
| `APPLE_PRO_YEARLY_PRODUCT_ID` | `com.tomohbr.shiftlog.pro.yearly`（同上） |

### 6-2. App Store Server Notifications V2

App Store Connect → 対象アプリ → 「App情報」→ App Store Server Notifications

| 項目 | 値 |
|---|---|
| バージョン | **V2** |
| 本番URL | `https://shiftlog-production.up.railway.app/api/billing/apple/notifications` |
| Sandbox URL | 同上 |

設定後、同じ画面の「テスト通知を送信」を押し、Railway のログに `[apple-iap] TEST 通知を受信` が出れば疎通OK。

### 6-3. プッシュ通知（APNs）

Apple Developer → Certificates, Identifiers & Profiles → Keys → 「+」→
**Apple Push Notifications service (APNs)** を有効にしてキーを作成し、`.p8` をダウンロード。

| 変数 | 値 |
|---|---|
| `APNS_TEAM_ID` | Apple Developer の Team ID（10文字） |
| `APNS_KEY_ID` | 作成した APNs キーの Key ID |
| `APNS_PRIVATE_KEY` | `.p8` の中身 |
| `APNS_BUNDLE_ID` | `com.tomohbr.shiftlog`（省略可） |
| `APNS_ENVIRONMENT` | `production`（既定）。**Xcode から実機に直接入れたビルドで試すときだけ `sandbox`** |

> TestFlight と App Store 配信のビルドは `production` 側。Xcode から直挿ししたビルドだけが `sandbox`。ここを間違えると通知が届かない。

### 6-4. CORS

`ALLOWED_ORIGIN` を設定している場合でも、`capacitor://localhost` は常に許可されるようコード側で担保済み。追加設定は不要。

---

## 7. 審査用アカウントを用意する

```bash
cd ~/カンパニー/shiftlog/backend
API_BASE=https://shiftlog-production.up.railway.app node scripts/create-review-account.js
```

管理者アカウント・会社PIN・スタッフ4名・シフト・過去1週間の打刻データまで一式を作り、
**App Store Connect の「App Review に関する情報」にそのまま貼れる文面**を出力する。

出力されたパスワードは再表示できないので必ず控える。審査が終わったらアプリ内の「アカウントの削除」から消せる。

---

## 8. App Privacy（プライバシーラベル）を申告する

App Store Connect → 対象アプリ → App のプライバシー

| データ種別 | 収集 | 用途 | 個人と紐づくか | トラッキング |
|---|---|---|---|---|
| メールアドレス | ✅ | アプリの機能 | 紐づく | なし |
| 氏名 | ✅ | アプリの機能 | 紐づく | なし |
| 電話番号 | ✅ | アプリの機能 | 紐づく | なし |
| ユーザーID | ✅ | アプリの機能 | 紐づく | なし |
| 購入履歴 | ✅ | アプリの機能 | 紐づく | なし |
| その他の使用状況データ（操作ログ） | ✅ | アプリの機能 | 紐づく | なし |
| 位置情報 | ❌ | — | — | — |

- 広告・第三者トラッキングは無し → **ATT の実装は不要**
- プライバシーポリシーURL: `https://shiftlog-production.up.railway.app/legal/privacy`
- 利用規約(EULA)URL: `https://shiftlog-production.up.railway.app/legal/terms`
- サポートURL: `https://shiftlog-production.up.railway.app/help`

> 打刻時のGPS取得を後から足す場合は、このラベルの更新が必須。

---

## 9. TestFlight で実機確認する

Xcode → Product → Archive → Distribute App → App Store Connect → Upload

アップロード後、App Store Connect の TestFlight タブに現れるまで数分〜1時間。内部テスターに自分を追加して実機に入れる。

**実機で必ず確認すること**（審査メモに書いた内容が本当に動くか）:

- [ ] ログインできる（メール＋パスワード / 会社PIN の両方）
- [ ] 打刻できる（出勤 → 休憩開始 → 休憩終了 → 退勤）
- [ ] **機内モードにして打刻 → 「端末に記録しました」と出る**
- [ ] **機内モードを解除 → 自動で同期され、打刻時刻が“打った時刻”で記録されている**
- [ ] 通知の許可ダイアログが出る（初回ログイン後）
- [ ] シフトを公開し直すとプッシュ通知が届く
- [ ] 設定 →「通知」→ テスト通知が届く
- [ ] 設定 →「セキュリティ」→ アプリロックを有効化 → バックグラウンドから戻すと Face ID を要求される
- [ ] ログイン画面に「Face IDでログイン」が出て、実際にログインできる
- [ ] 設定 →「プラン」→ Proにアップグレード → **Sandbox** で購入でき、Proになる
- [ ] 「購入を復元」でも Pro に戻る
- [ ] **アプリ内のどこにも Stripe / 外部決済への導線が無い**
- [ ] 設定 →「アカウントの削除」で削除でき、ログアウトされる
- [ ] プライバシーポリシー・利用規約のリンクが開く

> Sandbox での課金テストには、App Store Connect →「ユーザーとアクセス」→「Sandbox」で作ったテスターの Apple ID が必要。実機の「設定」→「App Store」→「サンドボックスアカウント」でサインインする。

---

## 10. 提出する

App Store Connect → バージョン情報 →

1. スクリーンショット（`store-assets/screenshots-ios/` の 1320×2868）をアップロード
2. 説明・キーワード・プロモーションテキストを `store-assets/app-store-listing.md` から貼る
3. **App Review に関する情報** に、手順7で出力された文面を貼る
4. ビルドを選択
5. 「審査へ提出」

### Guideline 4.2 で返ってきた場合

初回はここが返ってくる前提で構えておく。返信テンプレートは `store-assets/app-store-listing.md` の「4.2 への反論メモ」を使う。要点は次の3つ。

1. WebView が読むのは**アプリにバンドルしたローカルアセット**で、リモートURLを開いているのではない
2. **オフライン打刻**は Web では実現できない。圏外で打刻でき、復帰後に“打った時刻”のまま同期される
3. APNs・Face ID によるアプリロック・StoreKit 2 の App内課金を、ネイティブAPIで実装している

再現手順（機内モードで打刻 → 解除して同期）を、スクリーンショット付きで書くと通りやすい。

---

## 11. リリース後

- [ ] Small Business Program の申請が通っているか確認する
- [ ] App Store Server Notifications が届いているか Railway のログで確認する（初回更新は1ヶ月後）
- [ ] 審査用アカウントを削除する
- [ ] `store-assets/app-store-listing.md` の販売者名表示（本名）が想定どおりか確認する

---

## 付録: よく使うコマンド

```bash
# App Store Connect API（スクショ添付・状態確認）。キーは ~/.config/shiftlog/ に置く（git 外）
ASC_KEY_ID=9X344AQPQ2 ASC_ISSUER_ID=3221befc-dfe8-4328-ab63-592870403e07 \
ASC_KEY_PATH=~/.config/shiftlog/AuthKey_9X344AQPQ2.p8 node store-assets/asc-upload.mjs status   # app / iap も可

# App Store 用の Archive → IPA（Bash ツールのサンドボックス外で実行すること。キーチェーンに届かない）
cd ~/カンパニー/shiftlog/frontend && npm run build && npx cap sync ios && cd ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Release -sdk iphoneos \
  -destination 'generic/platform=iOS' -archivePath /tmp/shiftlog.xcarchive \
  -derivedDataPath /tmp/shiftlog-dd-archive -allowProvisioningUpdates archive
xcodebuild -exportArchive -archivePath /tmp/shiftlog.xcarchive \
  -exportOptionsPlist ../ExportOptions.plist -exportPath /tmp/shiftlog-export -allowProvisioningUpdates
# App Store Connect にアプリレコードを作った後は、ExportOptions.plist の destination を upload にすれば
# エクスポートと同時にアップロードされる（Xcode にサインイン済みの Apple ID を使う）

# Web を更新して iOS に反映する（変更のたびに必要）
cd ~/カンパニー/shiftlog/frontend && npm run build && npx cap sync ios

# Xcode を開く
npx cap open ios

# アプリアイコンを作り直す
python3 ~/カンパニー/shiftlog/store-assets/make-app-icon.py

# スクリーンショットを撮り直す（審査用アカウントの認証情報を渡す）
cd ~/カンパニー/shiftlog/store-assets
SHIFTLOG_EMAIL=xxx SHIFTLOG_PASSWORD=yyy node take-screenshots-ios.js

# オフライン打刻の回帰テスト
cd ~/カンパニー/shiftlog/backend && npm run build && node scripts/verify-offline-punch.js

# アカウント削除の回帰テスト
cd ~/カンパニー/shiftlog/backend && DB_PATH=/tmp/shiftlog-test.db node scripts/verify-account-deletion.js
```
