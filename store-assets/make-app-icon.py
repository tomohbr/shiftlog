#!/usr/bin/env python3
"""App Store 用アプリアイコン（1024x1024・アルファなし）を生成する。

Apple はアルファチャンネル付きのアイコンを受け付けない（提出時に弾かれる）ため、
必ず RGB でフラット化して書き出す。角丸は iOS 側でマスクされるので四角のまま。

  python3 make-app-icon.py

出力:
  frontend/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png  (1024, RGB)
  frontend/public/icons/icon-512.png / icon-192.png  (PWA 用・こちらはアルファ可)
"""
import os
from PIL import Image, ImageDraw

SS = 4              # スーパーサンプリング倍率
S = 1024 * SS
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TOP = (37, 99, 235)      # #2563EB ブランドブルー
BOTTOM = (29, 64, 175)   # #1D40AF
WHITE = (255, 255, 255)

# 背景: 縦方向グラデーション。バッジの「抜き」に使い回すので別イメージとして持つ
bg = Image.new('RGB', (S, S), TOP)
bd = ImageDraw.Draw(bg)
for y in range(S):
    t = y / (S - 1)
    bd.line([(0, y), (S, y)], fill=(
        round(TOP[0] + (BOTTOM[0] - TOP[0]) * t),
        round(TOP[1] + (BOTTOM[1] - TOP[1]) * t),
        round(TOP[2] + (BOTTOM[2] - TOP[2]) * t),
    ))

img = bg.copy()
d = ImageDraw.Draw(img)

cx = cy = S / 2

# 時計の文字盤（白い円）。iOS が角を丸くマスクするので、要素は中央 80% に収める
r = S * 0.290
d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)
inner = r * 0.86

# 12/3/6/9 の目盛り
tick_w = S * 0.018
for dx, dy in ((0, -1), (1, 0), (0, 1), (-1, 0)):
    x0 = cx + dx * inner * 0.78
    y0 = cy + dy * inner * 0.78
    x1 = cx + dx * inner * 0.93
    y1 = cy + dy * inner * 0.93
    d.line([(x0, y0), (x1, y1)], fill=TOP, width=round(tick_w))

# 針（9:00 の位置 = 長針上・短針左。時刻が読み取れる形にする）
hand_w = S * 0.030
d.line([(cx, cy), (cx, cy - inner * 0.66)], fill=TOP, width=round(hand_w))          # 長針
d.line([(cx, cy), (cx - inner * 0.46, cy)], fill=TOP, width=round(hand_w * 1.15))   # 短針
d.ellipse([cx - hand_w, cy - hand_w, cx + hand_w, cy + hand_w], fill=TOP)           # 中心

# 打刻済みを示すチェックバッジ（右下）
# 文字盤と地続きに見えないよう、まず背景グラデーションで一回り大きく抜いてから白を置く
ck = S * 0.150
bx, by = cx + r * 0.76, cy + r * 0.76
gap = ck * 1.20
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).ellipse([bx - gap, by - gap, bx + gap, by + gap], fill=255)
img.paste(bg, (0, 0), mask)

d.ellipse([bx - ck, by - ck, bx + ck, by + ck], fill=WHITE)
cw = S * 0.034
d.line([(bx - ck * 0.44, by - ck * 0.02), (bx - ck * 0.10, by + ck * 0.34)], fill=TOP, width=round(cw))
d.line([(bx - ck * 0.10, by + ck * 0.34), (bx + ck * 0.46, by - ck * 0.36)], fill=TOP, width=round(cw))

icon = img.resize((1024, 1024), Image.LANCZOS).convert('RGB')  # アルファを持たせない

out = os.path.join(ROOT, 'frontend/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')
icon.save(out, 'PNG')
print('wrote', out, icon.size, icon.mode)

for size in (512, 192):
    p = os.path.join(ROOT, f'frontend/public/icons/icon-{size}.png')
    icon.resize((size, size), Image.LANCZOS).save(p, 'PNG')
    print('wrote', p)
