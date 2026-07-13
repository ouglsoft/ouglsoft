from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from storage import ApiConfig, LocalModelStore, TrainingApiStore


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-store", required=True)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    model_store = LocalModelStore(Path(args.model_store))
    pointer = model_store.get_json("models/current.json")
    metrics = None
    if pointer and pointer.get("version"):
        metrics = model_store.get_json(f"models/{pointer['version']}/metrics.json")
    after = max(0, int((metrics or {}).get("maxEndedAt", 0) or 0))

    api = TrainingApiStore(ApiConfig.from_env())
    status = api.status(after)
    if metrics:
        threshold_met = int(status.get("newGames", 0) or 0) >= 500 or int(status.get("newSamples", 0) or 0) >= 50_000
        reason = "enough-new-data" if threshold_met else "insufficient-new-data"
    else:
        threshold_met = int(status.get("games", 0) or 0) >= 500 or int(status.get("samples", 0) or 0) >= 50_000
        reason = "enough-data" if threshold_met else "insufficient-data"
    run_training = bool(args.force or threshold_met)

    output = os.environ.get("GITHUB_OUTPUT", "").strip()
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"run_training={'true' if run_training else 'false'}\n")
            handle.write(f"reason={reason if not args.force else 'forced'}\n")
    print(json.dumps({"runTraining": run_training, "reason": "forced" if args.force else reason, "status": status}, sort_keys=True))


if __name__ == "__main__":
    main()
