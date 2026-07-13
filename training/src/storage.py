from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


@dataclass(frozen=True)
class ApiConfig:
    export_url: str
    secret: str

    @classmethod
    def from_env(cls) -> "ApiConfig":
        export_url = os.environ.get(
            "TRAINING_EXPORT_URL",
            "https://ouglsoft.com/dhamet/api/internal/training/export",
        ).strip()
        secret = os.environ.get("TRAINING_EXPORT_SECRET", "").strip()
        if not export_url or not secret:
            raise RuntimeError("Missing TRAINING_EXPORT_URL or TRAINING_EXPORT_SECRET")
        return cls(export_url=export_url, secret=secret)


class TrainingApiStore:
    def __init__(self, config: ApiConfig):
        self.config = config

    def _post(self, url: str, body: dict[str, Any]) -> dict[str, Any]:
        payload = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=payload,
            method="POST",
            headers={
                "authorization": f"Bearer {self.config.secret}",
                "content-type": "application/json",
                "user-agent": "dhamet-private-training/1",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                value = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:1000]
            raise RuntimeError(f"Training API HTTP {exc.code}: {detail}") from exc
        if not isinstance(value, dict) or value.get("ok") is False:
            raise RuntimeError(f"Training API rejected request: {value}")
        return value

    def load_records(self, max_games: int) -> list[dict[str, Any]]:
        maximum = max(1, int(max_games))
        records: dict[str, dict[str, Any]] = {}
        cursor: dict[str, Any] | None = None
        while len(records) < maximum:
            value = self._post(self.config.export_url, {"cursor": cursor, "limit": 50})
            rows = value.get("records", [])
            if not isinstance(rows, list):
                break
            for row in rows:
                if not isinstance(row, dict):
                    continue
                round_id = str(row.get("roundId", "")).strip()
                if round_id:
                    records[round_id] = row
                    if len(records) >= maximum:
                        break
            cursor = value.get("nextCursor") if isinstance(value.get("nextCursor"), dict) else None
            if not value.get("hasMore") or not cursor or not rows:
                break
        return list(records.values())

    def status(self, after_ended_at: int = 0) -> dict[str, Any]:
        status_url = self.config.export_url.rsplit("/", 1)[0] + "/status"
        return self._post(status_url, {"afterEndedAt": max(0, int(after_ended_at))})

    def prune(self, keep: int) -> dict[str, Any]:
        prune_url = self.config.export_url.rsplit("/", 1)[0] + "/prune"
        return self._post(prune_url, {"keep": max(500, int(keep))})

    def consume(self, round_ids: Iterable[str]) -> dict[str, Any]:
        consume_url = self.config.export_url.rsplit("/", 1)[0] + "/consume"
        clean = []
        seen = set()
        for value in round_ids:
            round_id = str(value or "").strip()
            if not round_id or round_id in seen:
                continue
            seen.add(round_id)
            clean.append(round_id)
        if not clean:
            return {"ok": True, "requested": 0, "deleted": 0}
        return self._post(consume_url, {"roundIds": clean})


class LocalModelStore:
    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        clean = str(key).replace("\\", "/").lstrip("/")
        path = (self.root / clean).resolve()
        if self.root not in path.parents and path != self.root:
            raise ValueError("Invalid model-store path")
        return path

    def list_keys(self, prefix: str) -> list[str]:
        base = self._path(prefix)
        if not base.exists():
            return []
        if base.is_file():
            return [str(base.relative_to(self.root)).replace("\\", "/")]
        return sorted(
            str(path.relative_to(self.root)).replace("\\", "/")
            for path in base.rglob("*")
            if path.is_file()
        )

    def get_bytes(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def get_json(self, key: str) -> dict[str, Any] | None:
        path = self._path(key)
        if not path.exists():
            return None
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None

    def put_bytes(self, key: str, payload: bytes, content_type: str = "application/octet-stream") -> None:
        del content_type
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)

    def put_json(self, key: str, value: dict[str, Any]) -> None:
        payload = json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8")
        self.put_bytes(key, payload, "application/json")

    def delete_keys(self, keys: Iterable[str]) -> None:
        for key in keys:
            path = self._path(key)
            if path.exists() and path.is_file():
                path.unlink()
        for directory in sorted((p for p in self.root.rglob("*") if p.is_dir()), reverse=True):
            try:
                directory.rmdir()
            except OSError:
                pass
