# 在庫期間用のLINEメニュー画像: 「希望を出す」の枠（上の段のまん中）を「締め・在庫」に差し替える
# 使い方: python make_stock_menu.py richmenu.png richmenu-stock.png（Pillow とヒラギノ角ゴが要る。Mac で実行）
from PIL import Image, ImageDraw, ImageFont
import sys
src, dst = sys.argv[1], sys.argv[2]
S = 4  # 拡大して描いて縮める（角を滑らかに）
im = Image.open(src).convert('RGB')
d = ImageDraw.Draw(im)
d.rectangle((840, 0, 1660, 835), fill=(255, 255, 255))  # 区切り線(縦831-835, 横841-845)は残す

# アイコン: 茶色の角丸＋白い段ボール箱
ic = Image.new('RGBA', (250 * S, 250 * S), (0, 0, 0, 0))
g = ImageDraw.Draw(ic)
g.rounded_rectangle((0, 0, 250 * S - 1, 250 * S - 1), radius=62 * S, fill=(180, 83, 9))
W = (255, 255, 255)
lw = 13 * S
def P(*pts): return [(x * S, y * S) for x, y in pts]
# 箱の本体と開いたふた
g.line(P((62, 108), (125, 82), (188, 108)), fill=W, width=lw, joint='curve')
g.polygon(P((62, 108), (125, 134), (188, 108), (188, 178), (125, 204), (62, 178)), outline=W, width=lw)
g.line(P((125, 134), (125, 204)), fill=W, width=lw)
# 数えのチェック
g.line(P((80, 152), (96, 168), (112, 146)), fill=W, width=10 * S, joint='curve')
ic = ic.resize((250, 250), Image.LANCZOS)
im.paste(ic, (1125, 115), ic)

F = '/System/Library/Fonts/ヒラギノ角ゴシック W%d.ttc'
cx = 1250
def center(text, font, top, color):
    b = font.getbbox(text)
    d.text((cx - (b[0] + b[2]) / 2, top - b[1]), text, font=font, fill=color)
center('締め・在庫', ImageFont.truetype(F % 8, 90), 477, (34, 34, 34))
center('閉店のとき', ImageFont.truetype(F % 4, 57), 614, (134, 142, 150))
im.save(dst, optimize=True)
