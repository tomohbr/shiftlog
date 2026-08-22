# ストア提出ガイド

## Google Play（最も簡単な方法: PWABuilder）

### 必要なもの
- Google Play Consoleアカウント（$25 一回のみ）
  → https://play.google.com/console/ で登録

### 手順（10分で完了）

1. **PWABuilderにアクセス**
   → https://www.pwabuilder.com

2. **URLを入力**
   ```
   https://shiftlog-production.up.railway.app
   ```

3. **「Start」→ スコアが表示される**
   - PWA対応済みなのでパスするはず

4. **「Package for stores」→「Android」を選択**
   - Package IDに `com.shiftlog.app` を入力
   - App nameに `シフトログ` を入力
   - 「Generate」でAPK/AABがダウンロードされる

5. **Google Play Consoleにログイン**
   → https://play.google.com/console/

6. **「アプリを作成」**
   - アプリ名: `シフトログ - 無料シフト管理アプリ`
   - デフォルト言語: 日本語
   - アプリまたはゲーム: アプリ
   - 無料または有料: 無料

7. **ストアの掲載情報を入力**
   → google-play-listing.md の内容をコピペ

8. **APK/AABをアップロード**
   - 「リリース」→「本番」→「新しいリリースを作成」
   - PWABuilderで生成したファイルをアップロード

9. **審査に提出**
   - 通常1〜3日で審査完了

### 必要な画像素材
- **アイコン**: 512x512 PNG → `frontend/public/icons/icon-512.png` を使用
- **フィーチャーグラフィック**: 1024x500 PNG → 別途作成が必要
- **スクリーンショット**: 最低2枚（推奨 1080x1920）→ ブラウザでアプリを開いてスクリーンショット撮影

---

## Apple App Store

**2026-08-22 方針変更: App Store に正式に出す。**（以前は「PWA配布で十分」としていたが、アプリとして販売する方針に切り替え）

手順は分量が多いため、専用ドキュメントに分けてある。

| ドキュメント | 内容 |
|---|---|
| [`../docs/ios-setup.md`](../docs/ios-setup.md) | Apple Developer Program 登録、Xcode 26 / Node / CocoaPods の導入 |
| [`../docs/ios-plan.md`](../docs/ios-plan.md) | Capacitor 導入と、審査を通すためのネイティブ機能・IAP の実装計画 |
| [`app-store-listing.md`](app-store-listing.md) | アプリ名・説明文・キーワード・プライバシーラベル・スクリーンショット |

### 押さえておくべき点

- **PWABuilder で iOS パッケージを作って出すだけでは通らない。** Guideline 4.2（最低限の機能）でWebラッパーは却下される。オフライン打刻・プッシュ通知・Face ID などネイティブ機能の実装が前提。
- **Xcode 26 以降が必須**（2026年4月28日以降の提出分）。
- **アカウント削除機能が必須**（Guideline 5.1.1(v)）→ 2026-08-22 実装済み。
- **アプリ内の課金は IAP が必要**（Guideline 3.1.1）。Stripe 決済のままでは却下される。

### iOS ユーザーへの当面の案内（App Store 公開までの暫定）

1. Safari で `https://shiftlog-production.up.railway.app` を開く
2. 共有ボタン（□↑）をタップ
3. 「ホーム画面に追加」をタップ

---

## 掲載情報

### アプリ名
シフトログ - 無料シフト管理アプリ

### 短い説明（80文字以内）
1店舗完全無料のシフト管理アプリ。シフト作成・タイムカード・勤務集計がこれひとつ。

### カテゴリ
ビジネス

### 連絡先メール
shibahara.724@gmail.com

### プライバシーポリシーURL
https://tomohbr.github.io/shiftlog-lp/ （※ 別途プライバシーポリシーページ作成推奨）

### 本番URL
https://shiftlog-production.up.railway.app
