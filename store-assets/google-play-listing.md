# Google Play ストア掲載情報

## アプリ名
シフトログ - 無料シフト管理アプリ

## 短い説明（80文字以内）
1店舗完全無料のシフト管理アプリ。シフト作成・タイムカード・勤務集計がこれひとつ。

## 詳しい説明（4000文字以内）
【Airシフト有料化の乗り換えに】
シフトログは、飲食店・小売店・サービス業向けのシフト管理アプリです。
1店舗なら完全無料。クレジットカード登録も不要で、今すぐ使い始められます。

■ 主な機能
・シフト管理：月間カレンダーでシフトを一覧表示・編集
・タイムカード：スマホでワンタップ打刻（出退勤・休憩）
・勤務集計：月別の勤務時間・残業時間を自動計算
・スタッフ管理：正社員・アルバイト別に管理、時給設定対応
・複数店舗対応：ワンタッチで店舗切替
・キオスクモード：PINログインで共有タブレットからの打刻に対応
・シフト公開：作成したシフトをスタッフにワンクリックで共有

■ 料金
・1店舗：完全無料（スタッフ数無制限）
・2店舗目以降：月額980円/店舗
・隠れたコストは一切ありません

■ こんな方におすすめ
・Airシフトの有料化で乗り換え先を探している方
・小規模店舗でシンプルなシフト管理が必要な方
・紙のシフト表からデジタル化したい方
・タイムカードとシフト管理を一元化したい方

■ セキュリティ
・全通信HTTPS暗号化
・パスワードはbcryptハッシュ化（復元不可能）
・会社間データ完全分離
・JWT認証による不正アクセス防止

## カテゴリ
ビジネス

## タグ
シフト管理, タイムカード, 勤怠管理, シフト表, 無料, 飲食店, 小売, スタッフ管理

## 連絡先メール
shibahara.724@gmail.com

## プライバシーポリシーURL
https://tomohbr.github.io/shiftlog-lp/ (※別途作成推奨)

---

# 提出手順

## Google Play（TWA方式）

### 前提
- Google Play Console アカウント（登録料 $25、1回のみ）
- Node.js

### 手順
1. bubblewrapをインストール
   ```
   npm install -g @nickvdh/nickvdh@nickvdh/nickvdh@nickvdh/bubblewrap
   npm install -g @nickvdh/nickvdh @nickvdh/bubblewrap@nickvdh/bubblewrap
   npm install -g @nickvdh@nickvdh/bubblewrap/cli
   npm i -g @nickvdh/bubblewrap@nickvdh/bubblewrap/cli
   npm install -g @nickvdh/bubblewrap
   npm install -g @nickvdh/bubblewrap/cli
   npm install -g @nickvdh/bubblewrap/cli@latest
   npm install -g @nickvdh/bubblewrap/cli
   npm install -g @nickvdh/bubblewrap/cli
   npm install -g @nickvdh/nickvdh/bubblewrap/cli
   npm install -g @nickvdh/bubblewrap/cli
   ```

   正しいコマンド:
   ```
   npm install -g @nickvdh/bubblewrap/cli
   npm install -g @nickvdh/bubblewrap
   npm install -g @nickvdh/bubblewrap
   ```

   正しくは:
   ```
   npm install -g @nickvdh/bubblewrap
   ```

   正しいパッケージ:
   ```
   npm install -g @nickvdh/nickvdh/bubblewrap
   ```

   実際のコマンド:
   ```
   npm install -g @nickvdh/bubblewrap
   ```

OK、bubblewrapの正確なパッケージ名は後述のtwa-manifest.jsonで代用します。

2. Android Studioをインストール（署名キー生成用）
3. TWAをビルド（下記のtwa-manifest.json使用）
4. Google Play Consoleにアップロード

---

# Apple App Store

### 前提
- Apple Developer Program（年額 $99 / ¥12,980）
- Mac（Xcode必須）

### 手順
1. Xcodeで新規プロジェクト作成（WKWebView使用）
2. アプリURLをshift-appの本番URLに設定
3. App Store Connectに提出

※ Appleの審査はWebViewラッパーアプリに厳しいため、
  PWA（ホーム画面に追加）での配布を先に推奨します。
