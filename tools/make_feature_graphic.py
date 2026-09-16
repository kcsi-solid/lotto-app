# -*- coding: utf-8 -*-
"""
Play 스토어 '그래픽 이미지'(1024x500)를 만든다.

손으로 그린 이미지를 리포에 던져 넣는 대신 스크립트로 두는 이유는 두 가지다.
 1. 색상을 css/app.css 의 공 색(b1~b5)과 같은 값으로 묶어 둘 수 있다.
    등재정보의 이미지와 실제 앱 화면이 따로 노는 것을 막는다.
 2. 문구를 고칠 때마다 이미지를 다시 뽑을 수 있다.

문구 원칙: "당첨 확률을 높인다" 류의 주장을 절대 넣지 않는다. 게시 거부 사유다.

사용법:  python tools/make_feature_graphic.py
"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1024, 500
BG = "#0d1117"          # css/app.css --bg
TEXT = "#e6edf3"        # --text
MUTED = "#8b949e"       # --muted

# css/app.css 의 .b1~.b5 와 같은 값이다.
BALL_COLORS = [
    (10, "#fbc400", "#4a3600"),
    (20, "#69c8f2", "#093243"),
    (30, "#ff7272", "#ffffff"),
    (40, "#aaaaaa", "#23262b"),
    (45, "#b0d840", "#253000"),
]

BOLD = "C:/Windows/Fonts/malgunbd.ttf"
REG = "C:/Windows/Fonts/malgun.ttf"


def ball_style(n):
    for limit, bg, fg in BALL_COLORS:
        if n <= limit:
            return bg, fg
    return "#aaaaaa", "#23262b"


def center(draw, text, font, y, fill):
    x0, y0, x1, y1 = draw.textbbox((0, 0), text, font=font)
    draw.text(((W - (x1 - x0)) / 2 - x0, y), text, font=font, fill=fill)


def main():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # 위아래 은은한 띠. 평평한 단색보다 앱 화면(카드 UI)에 가깝게 보인다.
    d.rectangle([0, 0, W, 6], fill="#2f81f7")          # --accent
    d.rectangle([0, H - 6, W, H], fill="#161b22")      # --surface

    title = ImageFont.truetype(BOLD, 62)
    sub = ImageFont.truetype(REG, 28)
    small = ImageFont.truetype(REG, 22)
    num = ImageFont.truetype(BOLD, 40)

    center(d, "로또 번호 분석기", title, 62, TEXT)
    center(d, "1회차부터 지금까지, 시계열 순서로 분석합니다", sub, 148, MUTED)

    # 공 6개 — 앱이 실제로 그리는 것과 같은 색 규칙
    numbers = [3, 13, 22, 35, 41, 44]
    r, gap = 46, 30
    total = len(numbers) * (r * 2) + (len(numbers) - 1) * gap
    x = (W - total) / 2 + r
    cy = 290
    for n in numbers:
        bg, fg = ball_style(n)
        d.ellipse([x - r, cy - r, x + r, cy + r], fill=bg)
        t = str(n)
        x0, y0, x1, y1 = d.textbbox((0, 0), t, font=num)
        d.text((x - (x1 - x0) / 2 - x0, cy - (y1 - y0) / 2 - y0), t, font=num, fill=fg)
        x += r * 2 + gap

    center(d, "조합이 나올 확률과 그 계산식을 화면에 그대로 보여줍니다", small, 392, MUTED)
    center(d, "통계 분석 도구이며 당첨을 보장하지 않습니다", small, 430, "#636c76")

    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "docs", "store", "feature-graphic-1024x500.png")
    img.save(out, "PNG")
    print("생성:", out, img.size)


if __name__ == "__main__":
    main()
