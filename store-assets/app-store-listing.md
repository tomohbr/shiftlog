# App Store 掲載情報（日本語）

App Store Connect に入力する内容。文字数はすべて上限内に収めてある（[Apple の上限: 名称30 / サブタイトル30 / キーワード100 / プロモーション170 / 説明4,000](https://www.applaunchflow.com/blog/app-store-metadata-character-limits-2026)）。

---

## 基本情報

| 項目 | 値 |
|---|---|
| Bundle ID | `com.tomohbr.shiftlog`（Google Play の Package ID と統一） |
| SKU | `shiftlog-ios-001` |
| プライマリカテゴリ | ビジネス |
| セカンダリカテゴリ | 仕事効率化 |
| 対応言語 | 日本語（プライマリ） |
| 年齢制限 | 4+ |
| 価格 | 無料（App内課金あり） |
| 販売者名 | **芝原 朋弥**（個人登録のため本名が App Store 上に表示される） |
| 特定商取引法 | `TokushohoPage.tsx`（住所・電話番号は請求開示方式） |

---

## アプリ名（30文字以内 / 現在18文字）

```
シフトログ - シフト管理・勤怠打刻
```

## サブタイトル（30文字以内 / 現在20文字）

```
1店舗無料。シフト作成から給与集計まで
```

## キーワード（100文字以内 / 現在70文字）

アプリ名・サブタイトルに含まれる語は Apple が自動で索引するため、重複させず別語を並べている。

```
シフト表,タイムカード,打刻,出退勤,勤務表,アルバイト,パート,飲食店,美容室,サロン,店舗管理,スタッフ管理,人件費,労務,勤怠システム
```

## プロモーションテキスト（170文字以内 / 現在101文字）

審査なしで随時変更できる枠。キャンペーンや新機能の告知に使う。

```
シフト作成、スタッフへの共有、出退勤の打刻、勤務時間の集計までをひとつのアプリで。1店舗・スタッフ30名までは無料。まずは30日間のPro無料トライアルからお試しください。
```

## 説明（4,000文字以内）

```
シフトログは、飲食店・美容室・小売店など小規模店舗のための、シフト管理と勤怠打刻のアプリです。
紙のシフト表、LINEでのやりとり、エクセルでの集計をひとつにまとめられます。

■ 1店舗・スタッフ30名まで無料
クレジットカードの登録なしで始められます。まずは無料のまま、実際のシフト作成と打刻を試してください。

■ シフト作成が速い
・月次カレンダーと横断テーブル、2つの表示を切り替えて編集
・よく使うパターンをテンプレートとして保存
・前月のシフトをコピーして調整するだけ
・スタッフの希望をもとに自動でシフト案を作成

■ スタッフの希望を集められる
・スタッフはアプリから希望シフトを提出
・提出期間を設定して締切を管理
・確定したシフトを公開すると、スタッフ全員がすぐ確認できます

■ 出退勤の打刻
・スタッフ個人の端末から打刻
・店舗のタブレットを共有端末にして、会社PIN＋名前タップで打刻（キオスクモード）
・QRコードを掲示して読み取り打刻
・打刻の修正履歴も記録されるので、あとから確認できます

■ 集計と給与計算
・勤務時間を自動集計
・時給を設定して給与を自動計算
・CSV出力で給与ソフトへの取り込みも簡単
・売上を入力すれば人件費率も確認できます

■ 交代・欠勤の連絡もアプリで
・急な欠勤の報告と、代わりに入れるスタッフの募集
・スタッフ同士のシフト交代依頼と承認

■ カレンダー連携
自分のシフトを Apple カレンダーや Google カレンダーに自動同期できます。

■ 複数店舗にも対応
店舗ごとにシフトとスタッフを管理できます。管理者は店舗を横断して確認できます。

──────────

【料金】
・Free: 1店舗・スタッフ30名まで無料
・Pro: 月額980円（1店舗あたり）。店舗数の追加、Pro機能が使えます
・新規登録から30日間はPro機能を無料でお試しいただけます

サブスクリプションは購入後、Apple ID の設定画面からいつでも解約できます。
期間終了の24時間前までに解約しない場合、自動的に更新されます。

【対象となる業種】
飲食店、カフェ、居酒屋、美容室、ネイルサロン、整体院、小売店、コンビニ、
アパレル、学習塾など、シフト制で運営されているすべての店舗

【お問い合わせ】
アプリ内のフィードバック機能、または shibahara.724@gmail.com までご連絡ください。
```

---

## URL

| 項目 | URL | 状態 |
|---|---|---|
| プライバシーポリシー | https://shiftlog-production.up.railway.app/legal/privacy | ✅ **作成済み**（未ログインで開ける単独ページ） |
| 利用規約（EULA） | https://shiftlog-production.up.railway.app/legal/terms | ✅ **作成済み** |
| 特定商取引法に基づく表記 | https://shiftlog-production.up.railway.app/legal/tokusho | ✅ 既存 |
| サポートURL | https://shiftlog-production.up.railway.app/help | 要確認（`/help` は現状ログインが必要。未ログインで開けないなら、サポートURLはLPかプライバシーポリシーのページを指定する） |
| マーケティングURL | https://tomohbr.github.io/shiftlog-lp/ | 要確認（公開されているか。任意項目なので、生きていなければ空欄でよい） |

いずれも Railway 上の React アプリが直接返すページで、未ログインで到達できる。
App内課金の購入画面からも、プライバシーポリシーと利用規約へのリンクを出している（Apple の要件）。

---

## App内課金（サブスクリプション）

| 項目 | 値 |
|---|---|
| 参照名 | シフトログ Pro（月額） |
| 商品ID | `com.tomohbr.shiftlog.pro.monthly` |
| 期間 | 1ヶ月 |
| 価格 | ¥980 |
| 表示名 | シフトログ Pro |
| 説明 | 店舗数の追加とPro機能が使えるプランです。 |

※ Small Business Program（年間売上100万ドル以下）に申請すると手数料が30%→15%になる。**申請は忘れずに行うこと。**

### 実装状況（2026-08-23）

| | |
|---|---|
| 購入 | StoreKit 2（`@squareetlabs/capacitor-subscriptions`）。設定 →「プラン」から購入 |
| サーバー検証 | 端末は transactionId のみ送信。サーバーが App Store Server API で取引を引き、Apple 署名を検証してから Pro を付与する |
| 更新・解約・返金の同期 | App Store Server Notifications V2 を `/api/billing/apple/notifications` で受信 |
| 購入の復元 | 設定 →「プラン」→「購入を復元」（Apple の必須要件） |
| 解約導線 | App Store の「サブスクリプションの管理」を開く |
| Stripe の扱い | **iOS アプリ内では Stripe の導線を一切表示しない**。Webで契約済みの会社には、アプリ内では「Webから契約中」と表示するだけ |
| 二重利用の防止 | 同じ Apple 契約（originalTransactionId）を複数の会社に紐づけられないようDBで一意制約 |

必要な環境変数と App Store Connect 側の設定は `docs/ios-release.md` の手順5・6を参照。

---

## App Privacy（プライバシーラベル）

App Store Connect で申告する収集データ。

| データ種別 | 収集 | 用途 | 個人と紐づくか |
|---|---|---|---|
| メールアドレス | ✅ | アプリ機能 | 紐づく |
| 氏名 | ✅ | アプリ機能 | 紐づく |
| 電話番号 | ✅ | アプリ機能 | 紐づく |
| ユーザーID | ✅ | アプリ機能 | 紐づく |
| 使用状況データ（操作ログ） | ✅ | アプリ機能 | 紐づく |
| 購入履歴 | ✅ | アプリ機能 | 紐づく |
| 位置情報 | ❌ | — | — |
| トラッキング | ❌ | — | — |

- サードパーティ広告なし、トラッキングなし → **ATT（App Tracking Transparency）の実装は不要**
- **打刻時のGPS取得を後から追加する場合は、このラベルの更新が必須**

---

## 審査用デモアカウント（Guideline 2.1・必須）

ログインが必要なアプリは、審査員が使えるアカウントの提出が必須。**空のアカウントを渡すと「機能を確認できない」で却下される**ため、シフト・スタッフ・打刻データを入れた状態で用意する。

**生成スクリプトを用意してある。** 提出前に一度実行するだけでよい。

```bash
cd ~/カンパニー/shiftlog/backend
API_BASE=https://shiftlog-production.up.railway.app node scripts/create-review-account.js
```

管理者アカウント・会社PIN・スタッフ4名・今月のシフト（公開済み）・過去1週間ぶんの打刻データ
（1日4打刻 × 4名 × 5営業日）まで一式を作り、**App Store Connect の「App Review に関する情報」に
そのまま貼れる文面**を出力する。ネイティブ機能の確認手順（機内モードでの打刻など）も文面に含まれている。

パスワードは実行のたびにランダム生成され再表示できないので、出力を必ず控えること。
審査が終わったらアプリ内の「アカウントの削除」から消せる。

---

## スクリーンショット

### 必要なサイズ

- **iPhone 6.9インチ: 必須**（1320×2868 / 1290×2796 / 1260×2736 のいずれか、縦向き）
- iPad 13インチ: iPad 対応にする場合のみ必須
- 1〜10枚

### 現状

✅ **撮影済み**。`store-assets/screenshots-ios/` に 1320×2868 で7枚（審査用デモデータ入り）。

`store-assets/screenshots/` にある旧7枚は 1080×2338（Google Play 向け）で、App Store には使えない。混同しないこと。

### 撮り直しの方法

```bash
cd ~/カンパニー/shiftlog/store-assets
npm install puppeteer                     # 初回のみ
npx puppeteer browsers install chrome     # 初回のみ
SHIFTLOG_URL=https://shiftlog-production.up.railway.app \
SHIFTLOG_EMAIL=<審査用アカウント> SHIFTLOG_PASSWORD=<パスワード> \
node take-screenshots-ios.js
```

viewport 440×956 × deviceScaleFactor 3 = **1320×2868** で出力される。
データの入っていないアカウントで撮ると空の画面になるので、必ず審査用アカウントで撮る。

### 掲載する画面と訴求文（案）

| # | 画面 | キャプション |
|---|---|---|
| 1 | ダッシュボード | 今日のシフトと出勤状況がひと目で |
| 2 | シフト編集 | ドラッグ＆タップでシフト作成 |
| 3 | 打刻 | ワンタップで出退勤。オフラインでも打刻できる |
| 4 | シフト希望提出 | スタッフの希望をアプリで集約 |
| 5 | 集計・給与 | 勤務時間と給与を自動計算、CSV出力も |
| 6 | スタッフ管理 | 1店舗・30名まで無料 |

---

## Guideline 4.2 への反論メモ（リジェクト時に貼る）

初回審査で「Webサイトのラッパーではないか」と返ってくる前提で用意しておく。
Resolution Center への返信は英語で書く。以下は要点。

> ShiftLog is not a wrapper around our website. The WebView loads **assets bundled inside the app**;
> it never navigates to a remote URL. The following features are implemented with native iOS APIs
> and are not available in our web version:
>
> **1. Offline time clock (the core reason this app exists).**
> Restaurant kitchens, back rooms and basement stores frequently have no signal. Staff can clock in
> and out while completely offline: the punch is stored on device and synced automatically when
> connectivity returns. Crucially, the record keeps **the time the punch was actually made**, not the
> time it reached our server — payroll would otherwise be wrong.
> *To reproduce:* enable Airplane Mode → open the time clock screen → tap 出勤 (Clock in). You will see
> "端末に記録しました" (saved on device). Disable Airplane Mode → the punch syncs automatically and the
> recorded time matches when you tapped, not when the network returned.
>
> **2. Push notifications via APNs.** Staff are notified when a schedule is published, when someone
> asks them to swap a shift, when a coworker calls in sick and a replacement is needed, and when the
> availability collection period opens. These are real events, not generic marketing pushes.
>
> **3. Face ID / Touch ID.** Settings → セキュリティ enables an app lock that requires biometric
> authentication when the app returns from the background, protecting wage and contact data on a lost
> device. Biometric quick login is also available on the sign-in screen.
>
> **4. StoreKit 2 in-app purchase**, verified server-side through the App Store Server API.
>
> A demo account with data is provided in the App Review Information section, along with step-by-step
> instructions for each of the above.

スクリーンショット（機内モードでの打刻 → 同期後の一覧）を添付すると通りやすい。

---

## 提出前チェックリスト

- [ ] Apple Developer Program に加入済み
- [ ] Xcode 26 をインストールし `xcode-select` を切り替えた
- [ ] App Store Connect でアプリレコード作成済み
- [x] アカウント削除機能が動作する（Guideline 5.1.1(v)）— 検証スクリプトでパス済み
- [x] ネイティブ機能が実装済み（Guideline 4.2）— オフライン打刻・APNs・Face ID
- [x] IAP が実装済み・iOS で Stripe 導線が非表示（Guideline 3.1.1）
- [x] プライバシーポリシーが単独URLで公開されている（`/legal/privacy`）
- [x] 利用規約（EULA）が単独URLで公開されている（`/legal/terms`）
- [x] アプリアイコン 1024×1024（アルファなし）を用意した
- [x] スクリーンショットを 6.9インチ サイズで撮り直した
- [ ] App Store Connect で App内課金の商品（`com.tomohbr.shiftlog.pro.monthly`）を登録した
- [ ] Railway に APNs / App内課金の環境変数を設定した
- [ ] App Store Server Notifications V2 のURLを登録し、テスト通知が届いた
- [ ] 審査用デモアカウントを本番で作成し、認証情報を控えた
- [ ] App Privacy ラベルを申告した
- [ ] Small Business Program に申請した
- [ ] TestFlight で実機確認した（`docs/ios-release.md` の手順9のチェックリスト）

詳しい手順は **`docs/ios-release.md`** を参照。
