"""Train a tiny synthetic-font digit classifier with only Pillow + NumPy.

Output is a browser-loadable two-layer MLP JSON model. This is a size/accuracy candidate; the
fixture corpus remains evaluation-only and is never used for training.
"""
from __future__ import annotations
import json, math, random
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "models" / "sudoku-digits-mlp.json"
FONT_DIR = Path("C:/Windows/Fonts")
FONT_NAMES = [
    "arial.ttf", "arialbd.ttf", "calibri.ttf", "calibrib.ttf", "cambria.ttc",
    "consola.ttf", "consolab.ttf", "cour.ttf", "courbd.ttf", "georgia.ttf",
    "georgiab.ttf", "segoeui.ttf", "segoeuib.ttf", "tahoma.ttf", "times.ttf",
    "timesbd.ttf", "trebuc.ttf", "verdana.ttf", "verdanab.ttf",
]
FONTS = [FONT_DIR / name for name in FONT_NAMES if (FONT_DIR / name).exists()]
SEED = 20260711

def render(digit: int, rng: random.Random) -> np.ndarray:
    canvas = Image.new("L", (32, 32), 255)
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype(str(rng.choice(FONTS)), rng.randint(20, 29))
    box = draw.textbbox((0, 0), str(digit), font=font, stroke_width=0)
    w, h = box[2] - box[0], box[3] - box[1]
    x = (32 - w) / 2 - box[0] + rng.uniform(-3, 3)
    y = (32 - h) / 2 - box[1] + rng.uniform(-3, 3)
    draw.text((x, y), str(digit), font=font, fill=rng.randint(0, 65),
              stroke_width=rng.choice([0, 0, 1]), stroke_fill=0)
    if rng.random() < .45:
        canvas = canvas.rotate(rng.uniform(-7, 7), resample=Image.Resampling.BILINEAR,
                               fillcolor=255)
    if rng.random() < .25:
        canvas = canvas.filter(ImageFilter.GaussianBlur(rng.uniform(.2, .65)))
    small = canvas.resize((16, 16), Image.Resampling.LANCZOS)
    return (255 - np.asarray(small, dtype=np.float32)).reshape(-1) / 255

def softmax(z):
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)

def main():
    if not FONTS:
        raise SystemExit("No configured fonts found")
    rng = random.Random(SEED)
    np.random.seed(SEED)
    samples = [(render(d, rng), d - 1) for d in range(1, 10) for _ in range(420)]
    rng.shuffle(samples)
    x = np.stack([item[0] for item in samples])
    y = np.array([item[1] for item in samples])
    split = int(len(x) * .9)
    xt, xv, yt, yv = x[:split], x[split:], y[:split], y[split:]
    hidden = 48
    w1 = np.random.randn(256, hidden).astype(np.float32) * math.sqrt(2 / 256)
    b1 = np.zeros(hidden, np.float32)
    w2 = np.random.randn(hidden, 9).astype(np.float32) * math.sqrt(2 / hidden)
    b2 = np.zeros(9, np.float32)
    lr, batch = .035, 96
    for epoch in range(55):
        order = np.random.permutation(len(xt))
        for start in range(0, len(xt), batch):
            ids = order[start:start + batch]
            xb, yb = xt[ids], yt[ids]
            hpre = xb @ w1 + b1
            h = np.maximum(hpre, 0)
            p = softmax(h @ w2 + b2)
            p[np.arange(len(ids)), yb] -= 1
            p /= len(ids)
            dw2, db2 = h.T @ p, p.sum(axis=0)
            dh = p @ w2.T
            dh[hpre <= 0] = 0
            dw1, db1 = xb.T @ dh, dh.sum(axis=0)
            w1 -= lr * dw1; b1 -= lr * db1
            w2 -= lr * dw2; b2 -= lr * db2
        lr *= .97
    pred = np.argmax(np.maximum(xv @ w1 + b1, 0) @ w2 + b2, axis=1)
    accuracy = float(np.mean(pred == yv))
    OUT.parent.mkdir(exist_ok=True)
    payload = {"version": 1, "input": [1, 16, 16], "classes": list(range(1, 10)),
               "validationAccuracy": accuracy, "fonts": len(FONTS),
               "w1": w1.round(6).tolist(), "b1": b1.round(6).tolist(),
               "w2": w2.round(6).tolist(), "b2": b2.round(6).tolist()}
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"output": str(OUT), "bytes": OUT.stat().st_size,
                      "validationAccuracy": accuracy, "fonts": len(FONTS)}))

if __name__ == "__main__":
    main()
