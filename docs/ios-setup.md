# iOS 開発環境セットアップ手順書

販売用シフトログ（`shiftlog` / https://shiftlog-production.up.railway.app ）を App Store に提出するための環境構築手順。

**このMacの現状（2026-08-22 時点で確認済み）**

| 項目 | 状態 |
|---|---|
| macOS | Darwin 25.5.0（macOS 26 系）→ Xcode 26 に対応 ✅ |
| Xcode | ❌ 未インストール（Command Line Tools のみ） |
| Node.js | ✅ **v24.19.0 LTS 導入済み**（2026-08-22、`~/.local` に展開・sudo不要） |
| Homebrew | ❌ 未インストール |
| CocoaPods | ❌ 未インストール |
| Apple Developer Program | ❌ 未加入 |

新Mac移行直後のため、ビルドに必要なものが揃っていない。以下を上から順に進める。

---

## 1. Apple Developer Program に加入する（最優先・時間がかかる）

**費用**: 年額 11,800円前後（$99）
**所要**: 個人なら即日〜2日、法人は数週間かかることがある

### 個人 or 法人の判断

| | 個人（Individual） | 法人（Organization） |
|---|---|---|
| App Store 上の販売者名 | **本人の氏名が表示される** | 法人名が表示される |
| 必要なもの | Apple Account + 支払い手段 | **D-U-N-S 番号**、登記情報、法人の電話番号 |
| 審査期間 | 即日〜2日 | 数日〜数週間 |

シフトログは店舗向けに販売する商用プロダクトなので、**法人名で出したいなら法人登録**を選ぶ。個人名が表示されて問題ないなら個人登録の方が圧倒的に早い。

> 法人を選ぶ場合、D-U-N-S 番号の取得だけで1〜2週間かかることがある。先に https://developer.apple.com/enroll/duns-lookup/ で取得済みか確認する。

### 手順

1. https://developer.apple.com/programs/enroll/ にアクセス
2. Apple Account でサインイン（2ファクタ認証が必須）
3. Individual / Organization を選択
4. 情報を入力して支払い
5. 承認メールを待つ

**注意**: 加入が完了するまで App Store Connect でアプリレコードを作成できない。ここが全体のクリティカルパスなので、他の作業と並行して真っ先に着手する。

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

## 4. CocoaPods をインストールする

Capacitor の iOS プロジェクトが依存関係の管理に使う。

```bash
# Homebrew を入れた場合（推奨・sudo 不要）
brew install cocoapods

# Homebrew を使わない場合
sudo gem install cocoapods
```

確認:

```bash
pod --version
```

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

- [ ] Apple Developer Program に加入済み（App Store Connect にログインできる）
- [ ] Xcode 26 以降がインストール済み
- [ ] `xcode-select -p` が `/Applications/Xcode.app/...` を指している
- [x] Node.js LTS が入っている（v24.19.0）
- [ ] CocoaPods が入っている
- [ ] `shiftlog` の backend / frontend が `npm run build` で通る

ここまで終わったら `ios-plan.md` に進む。
