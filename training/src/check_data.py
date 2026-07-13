from __future__ import annotations

import json
import os

from storage import ApiConfig, TrainingApiStore


def main() -> None:
    api = TrainingApiStore(ApiConfig.from_env())
    status = api.status(0)
    games = max(0, int(status.get("games", 0) or 0))
    samples = max(0, int(status.get("samples", 0) or 0))
    run_training = games > 0
    reason = "saved-records-found" if run_training else "no-saved-records"

    output = os.environ.get("GITHUB_OUTPUT", "").strip()
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"run_training={'true' if run_training else 'false'}\n")
            handle.write(f"reason={reason}\n")
    print(json.dumps({
        "runTraining": run_training,
        "reason": reason,
        "games": games,
        "samples": samples,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
