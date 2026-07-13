from __future__ import annotations

import argparse
import json
from pathlib import Path

from storage import ApiConfig, TrainingApiStore


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--receipt", required=True)
    args = parser.parse_args()

    receipt_path = Path(args.receipt)
    if not receipt_path.exists():
        raise RuntimeError(f"Training receipt not found: {receipt_path}")
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    round_ids = receipt.get("roundIds") if isinstance(receipt, dict) else None
    if not isinstance(round_ids, list) or not round_ids:
        raise RuntimeError("Training receipt contains no round IDs")

    result = TrainingApiStore(ApiConfig.from_env()).consume(round_ids)
    print(json.dumps({
        "consumed": True,
        "requested": len(round_ids),
        "result": result,
        "modelVersion": receipt.get("modelVersion"),
    }, sort_keys=True))


if __name__ == "__main__":
    main()
