"""Train/export the compact convolutional comparison model."""
from __future__ import annotations
import json, random, runpy
from pathlib import Path
import argparse
import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

ROOT = Path(__file__).resolve().parents[1]
helpers = runpy.run_path(str(Path(__file__).with_name("train-digit-model.py")))
render, fonts = helpers["render"], helpers["FONTS"]
seed = helpers["SEED"]
random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)

class DigitCNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 12, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(12, 24, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
        )
        self.classifier = nn.Sequential(nn.Flatten(), nn.Linear(24 * 4 * 4, 48),
                                        nn.ReLU(), nn.Linear(48, 9))
    def forward(self, x):
        return self.classifier(self.features(x))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cells', type=Path, nargs='*', default=[])
    parser.add_argument('--exclude', action='append', default=[])
    args = parser.parse_args()
    rng = random.Random(seed)
    samples = [(render(d, rng), d - 1) for d in range(1, 10) for _ in range(700)]
    rng.shuffle(samples)
    x = torch.tensor(np.stack([s[0] for s in samples])).reshape(-1, 1, 16, 16)
    y = torch.tensor([s[1] for s in samples], dtype=torch.long)
    split = int(len(x) * .9)
    real = {}
    for path in args.cells:
        payload = json.loads(path.read_text(encoding='utf-8'))
        for sample in payload['samples']:
            if sample['fixture'] not in args.exclude:
                real[(sample['fixture'], sample['cell'])] = sample
    train_x, train_y = x[:split], y[:split]
    if real:
        rx = np.stack([sample['feature'] for sample in real.values()] * 12).astype(np.float32)
        ry = np.array([sample['digit'] - 1 for sample in real.values()] * 12)
        train_x = torch.cat([train_x, torch.tensor(rx).reshape(-1, 1, 16, 16)])
        train_y = torch.cat([train_y, torch.tensor(ry, dtype=torch.long)])
    train = DataLoader(TensorDataset(train_x, train_y), batch_size=128, shuffle=True)
    model = DigitCNN()
    optimizer = torch.optim.Adam(model.parameters(), lr=.002)
    loss_fn = nn.CrossEntropyLoss()
    for _ in range(18):
        model.train()
        for xb, yb in train:
            optimizer.zero_grad(); loss = loss_fn(model(xb), yb); loss.backward(); optimizer.step()
    model.eval()
    with torch.no_grad(): accuracy = float((model(x[split:]).argmax(1) == y[split:]).float().mean())
    out = ROOT / "models" / "sudoku-digits-cnn.onnx"
    torch.onnx.export(model, torch.zeros(1, 1, 16, 16), out, input_names=["input"],
                      output_names=["logits"], dynamic_axes={"input": {0: "batch"},
                      "logits": {0: "batch"}}, opset_version=18, dynamo=False)
    model_version = 2 if real else 1
    meta = {"version": model_version, "classes": list(range(1, 10)), "input": [1, 16, 16],
            "normalization": "bbox-12x14-v1", "validationAccuracy": accuracy,
            "fonts": len(fonts), "realSamples": len(real), "excludedFixtures": args.exclude,
            "bytes": out.stat().st_size}
    out.with_suffix(".json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    with torch.no_grad(): zero_logits = model(torch.zeros(1, 1, 16, 16))[0].tolist()
    weights = {"version": 1, **meta, "format": "cnn-js-v1",
               "verification": {"input": "zeros", "logits": zero_logits}, "tensors": {}}
    for name, tensor in model.state_dict().items():
        weights["tensors"][name] = {"shape": list(tensor.shape),
                                    "data": tensor.detach().cpu().numpy().round(7).reshape(-1).tolist()}
    js_out = ROOT / "models" / "sudoku-digits-cnn-js.json"
    js_out.write_text(json.dumps(weights, separators=(",", ":")), encoding="utf-8")
    meta["jsBytes"] = js_out.stat().st_size
    print(json.dumps(meta))

if __name__ == "__main__": main()
