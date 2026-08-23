# iOS 開発環境セットアップ手順書

販売用シフトログ（`shiftlog` / https://shiftlog-production.up.railway.app ）を App Store に提出するための環境構築手順。

**このMacの現状（2026-08-22 時点で確認済み）**

| 項目 | 状態 |
|---|---|
| macOS | Darwin 25.5.0（macOS 26 系）→ Xcode 26 に対応 ✅ |
| Xcode | ❌ 未インストール（Command Line Tools のみ） |
| Node.js | ✅ **v24.19.0 LTS 導入済み**（2026-08-22、`~/.local` に展開・sudo不要） |
| Homebrew | ❌ 未インストール（**不要**） |
| CocoaPods | ❌ 未インストール（**不要**。Capacitor 8 は Swift Package Manager を使う） |
| Apple Developer Program | ❌ 未加入（**個人で登録する**と決定） |

新Mac移行直後のため、ビルドに必要なものが揃っていない。以下を上から順に進める。

---

## 1. Apple Developer Program に加入する（最優先・クリティカルパス）

**2026-08-22 決定: 個人（Individual）で登録する。**

**費用**: 年額 12,980円（税込・日本価格。$99相当）
**所要**: 最短即日、通常1〜2日

### 準備するもの

- Apple Account（**2ファクタ認証の有効化が必須**）
- クレジットカード
- **写真付きの公的身分証明書** — 運転免許証、マイナンバーカード、パスポートのいずれか

### 手順

1. https://developer.apple.com/programs/enroll/ にアクセス
2. Apple Account でサインイン
3. **Individual / Sole Proprietor** を選択
4. 氏名・住所などを入力（**身分証明書の記載と完全に一致させる**。ズレると差し戻される）
5. 身分証明書の写真をアップロード（[Identity verification](https://developer.apple.com/help/account/membership/identity-verification/)）
6. 年会費を支払う
7. 承認メールを待つ → App Store Connect にログインできるようになる

### 個人登録で認識しておくこと

- **App Store の販売者名として本人の氏名が公開される。** 屋号やサービス名ではなく「芝原 朋弥」が表示される。これが困る場合は法人登録が必要（D-U-N-S 番号の取得で1〜2週間かかる）
- 後から個人→法人へ移行する場合、**アプリを新しいアカウントへ移管する手続きが必要**になる。将来法人化する予定があるなら、この時点で法人登録を選んでおく方が手間が少ない
- 特定商取引法の表記は既に `TokushohoPage.tsx` があり、運営責任者「芝原 朋弥」・住所と電話番号は請求開示方式で運用している。個人登録と整合している

**注意**: 加入が完了するまで App Store Connect でアプリレコードを作成できず、証明書もプロビジョニングプロファイルも作れない。Xcode のインストールと並行して、真っ先に着手する。

---

## 2. Xcode 26 をインストールする

**2026年4月28日以降、App Store Connect へのアップロードは Xcode 26 以降 + iOS 26 SDK でのビルドが必須**（[Apple: SDK minimum requirements](https://www.developer.apple.com/news/upcoming-requirements/)）。古い Xcode ではそもそも提出できない。

### 手順

1. Mac App Store で「Xcode」を検索してインストール
   - **約15GB以上、回線によっては数時間かかる**。夜のうちに始めておくのが無難
2. 初回起動して追加コンポーネントのインストールを完了させる
3. コマンドラインツールの向き先を Xcode 本体に切り替える

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
```

4. 確認

```bash
xcodebuild -version          # Xcode 26.x と表示されればOK
xcrun --sdk iphoneos --show-sdk-version   # 26.x
```

> 現状は `/Library/Developer/CommandLineTools` を向いているため、Xcode を入れただけでは `xcodebuild` が使えない。上の `xcode-select -s` を必ず実行する。

### iOS シミュレータ

Xcode の Settings → Components から iOS 26 のシミュレータを追加しておく。実機がなくても動作確認できる。

---

## 3. Node.js をインストールする

**2026-08-22 に導入済み（v24.19.0 LTS / Krypton）。この節はやり直す場合の参考。**

公式tarballを `~/.local` に展開し、`~/.local/bin` にシンボリックリンクを張る方式で入れてある（sudo不要、Homebrew不要）。

```bash
VER=v24.19.0
curl -fsSL -O https://nodejs.org/dist/${VER}/node-${VER}-darwin-arm64.tar.gz
curl -fsSL -O https://nodejs.org/dist/${VER}/SHASUMS256.txt
shasum -a 256 -c <(grep " node-${VER}-darwin-arm64.tar.gz$" SHASUMS256.txt)   # 検証
tar -xzf node-${VER}-darwin-arm64.tar.gz -C ~/.local
for b in node npm npx corepack; do
  ln -sf ~/.local/node-${VER}-darwin-arm64/bin/$b ~/.local/bin/$b
done
```

`~/.local/bin` は既に PATH に入っているため、追加の設定は不要。

### 別の方法A: 公式インストーラ

https://nodejs.org/ から **LTS 版の macOS Installer (.pkg)** をダウンロードして実行。

### 別の方法B: Homebrew 経由（他のツールも入れるなら）

```bash
# Homebrew 本体
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# PATH を通す（Apple Silicon の場合）
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"

brew install node
```

### 確認

```bash
node -v    # v20.x 以上
npm -v
```

---

## 4. CocoaPods は不要

**2026-08-23 追記: この節の作業は不要になった。**

Capacitor 8 の iOS プロジェクトは **Swift Package Manager** で依存を解決する
（`frontend/ios/App/CapApp-SPM/Package.swift`）。`Podfile` は生成されず、
`pod install` も走らない。Homebrew も CocoaPods も入れる必要はない。

Xcode がプロジェクトを開いたときに、Swift Package の解決が自動で行われる（初回のみ数分かかる）。

---

## 5. 既存プロジェクトのビルドが通ることを確認する

iOS 化の前に、まず現状のWebアプリがこのMacでビルドできることを確認する。

```bash
cd ~/カンパニー/shiftlog

# バックエンド
cd backend && npm install && npm run build && cd ..

# フロントエンド
cd frontend && npm install && npm run build && cd ..
```

**2026-08-22 実施済み**: backend / frontend とも `tsc --noEmit` および `npm run build` が通ることを確認。あわせてアカウント削除処理のランタイム検証も実施済み（全30項目パス）。

```bash
cd backend
rm -f /tmp/shiftlog-test.db*
DB_PATH=/tmp/shiftlog-test.db node scripts/verify-account-deletion.js
```

---

## 6. セットアップ完了チェックリスト

```bash
# すべて値が返ればOK
xcodebuild -version
xcrun --sdk iphoneos --show-sdk-version
node -v
npm -v
pod --version
```

- [ ] Apple Developer Program に加入済み（個人 / App Store Connect にログインできる）
- [ ] Xcode 26 以降がインストール済み
- [ ] `xcode-select -p` が `/Applications/Xcode.app/...` を指している
- [x] Node.js LTS が入っている（v24.19.0）
- [x] ~~CocoaPods~~ → 不要（Swift Package Manager）
- [x] `shiftlog` の backend / frontend が `npm run build` で通る（2026-08-23 確認）

確認用（`pod --version` は不要）:

```bash
xcodebuild -version
xcrun --sdk iphoneos --show-sdk-version
node -v
npm -v
```

ここまで終わったら **`ios-release.md`** に進む。実装はすべて完了しているので、
`ios-plan.md` は設計の記録として読めばよい。
