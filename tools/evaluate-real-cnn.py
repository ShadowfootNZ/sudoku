"""Fixture-grouped CNN validation using exported normalized real cells."""
from __future__ import annotations
import argparse, json, random, runpy
from pathlib import Path
import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

ROOT = Path(__file__).resolve().parents[1]
cnn_helpers = runpy.run_path(str(Path(__file__).with_name("train-digit-cnn.py")))
mlp_helpers = runpy.run_path(str(Path(__file__).with_name("train-digit-model.py")))
DigitCNN, render, seed = cnn_helpers["DigitCNN"], mlp_helpers["render"], mlp_helpers["SEED"]

def train_model(x, y):
    torch.manual_seed(seed)
    model = DigitCNN()
    loader = DataLoader(TensorDataset(x, y), batch_size=128, shuffle=True)
    optimizer = torch.optim.Adam(model.parameters(), lr=.002)
    loss_fn = nn.CrossEntropyLoss()
    for _ in range(16):
        model.train()
        for xb, yb in loader:
            optimizer.zero_grad(); loss = loss_fn(model(xb), yb); loss.backward(); optimizer.step()
    return model.eval()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("cells", type=Path, nargs="+")
    args = parser.parse_args()
    merged = {}
    for path in args.cells:
        data = json.loads(path.read_text(encoding="utf-8"))
        for sample in data["samples"]:
            merged[(sample["fixture"], sample["cell"])] = sample
    samples = list(merged.values())
    rng = random.Random(seed)
    synthetic = [(render(d, rng), d - 1) for d in range(1, 10) for _ in range(420)]
    sx = np.stack([x for x, _ in synthetic]); sy = np.array([y for _, y in synthetic])
    fixtures = sorted({sample["fixture"] for sample in samples})
    results = []
    for held_out in fixtures:
        training = [s for s in samples if s["fixture"] != held_out]
        testing = [s for s in samples if s["fixture"] == held_out]
        # Repeat the small real set so it materially influences training without using holdout data.
        rx = np.stack([s["feature"] for s in training] * 12).astype(np.float32)
        ry = np.array([s["digit"] - 1 for s in training] * 12)
        x = torch.tensor(np.concatenate([sx, rx])).reshape(-1, 1, 16, 16)
        y = torch.tensor(np.concatenate([sy, ry]), dtype=torch.long)
        model = train_model(x, y)
        tx = torch.tensor(np.stack([s["feature"] for s in testing]).astype(np.float32)).reshape(-1,1,16,16)
        ty = torch.tensor([s["digit"] - 1 for s in testing])
        with torch.no_grad(): pred = model(tx).argmax(1)
        correct = int((pred == ty).sum())
        results.append({"fixture": held_out, "correct": correct, "total": len(testing),
                        "accuracy": correct / len(testing)})
    total = sum(r["total"] for r in results); correct = sum(r["correct"] for r in results)
    report = {"version": 1, "method": "leave-one-fixture-out-synthetic-plus-real",
              "correct": correct, "total": total, "accuracy": correct / total, "results": results}
    print(json.dumps(report, indent=2))

if __name__ == "__main__": main()
