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

### 前提
- Apple Developer Program（年額$99 / 約¥15,000）
- Mac + Xcode が必須

### 方法A: PWABuilder（簡単だが審査が厳しい）
1. PWABuilderで「iOS」を選択
2. Xcodeプロジェクトがダウンロードされる
3. Macで開いてビルド＆提出
※ AppleはWebViewラッパーアプリの審査が厳しいため、却下される可能性あり

### 方法B: PWAとして配布（審査不要・推奨）
iOSユーザーには以下の手順を案内:
1. Safariで `https://shiftlog-production.up.railway.app` を開く
2. 共有ボタン（□↑）をタップ
3. 「ホーム画面に追加」をタップ
4. アプリとしてホーム画面にアイコンが追加される

→ LP・SNSでこの手順を案内するのが最も現実的

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
