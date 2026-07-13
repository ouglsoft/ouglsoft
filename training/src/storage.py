from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Iterable

import boto3


@dataclass(frozen=True)
class R2Config:
    endpoint_url: str
    access_key_id: str
    secret_access_key: str
    bucket: str

    @classmethod
    def from_env(cls) -> "R2Config":
        values = {
            "endpoint_url": os.environ.get("R2_ENDPOINT_URL", "").strip(),
            "access_key_id": os.environ.get("R2_ACCESS_KEY_ID", "").strip(),
            "secret_access_key": os.environ.get("R2_SECRET_ACCESS_KEY", "").strip(),
            "bucket": os.environ.get("R2_BUCKET", "dhamet-training-private").strip(),
        }
        missing = [name for name, value in values.items() if not value]
        if missing:
            raise RuntimeError("Missing R2 settings: " + ", ".join(missing))
        return cls(**values)


class R2Store:
    def __init__(self, config: R2Config):
        self.config = config
        self.client = boto3.client(
            "s3",
            endpoint_url=config.endpoint_url,
            aws_access_key_id=config.access_key_id,
            aws_secret_access_key=config.secret_access_key,
            region_name="auto",
        )

    def list_keys(self, prefix: str, limit: int | None = None) -> list[str]:
        keys: list[str] = []
        token: str | None = None
        while True:
            args: dict[str, Any] = {"Bucket": self.config.bucket, "Prefix": prefix, "MaxKeys": 1000}
            if token:
                args["ContinuationToken"] = token
            response = self.client.list_objects_v2(**args)
            for item in response.get("Contents", []):
                key = str(item.get("Key", ""))
                if key:
                    keys.append(key)
                    if limit and len(keys) >= limit:
                        return keys
            if not response.get("IsTruncated"):
                return keys
            token = response.get("NextContinuationToken")
            if not token:
                return keys

    def get_bytes(self, key: str) -> bytes:
        response = self.client.get_object(Bucket=self.config.bucket, Key=key)
        return response["Body"].read()

    def get_json(self, key: str) -> dict[str, Any] | None:
        try:
            return json.loads(self.get_bytes(key).decode("utf-8"))
        except self.client.exceptions.NoSuchKey:
            return None
        except Exception as exc:
            code = getattr(exc, "response", {}).get("Error", {}).get("Code")
            if code in {"NoSuchKey", "404", "NotFound"}:
                return None
            raise

    def put_bytes(self, key: str, payload: bytes, content_type: str) -> None:
        self.client.put_object(Bucket=self.config.bucket, Key=key, Body=payload, ContentType=content_type)

    def put_json(self, key: str, value: dict[str, Any]) -> None:
        payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        self.put_bytes(key, payload, "application/json")

    def delete_keys(self, keys: Iterable[str]) -> None:
        batch: list[dict[str, str]] = []
        for key in keys:
            batch.append({"Key": key})
            if len(batch) == 1000:
                self.client.delete_objects(Bucket=self.config.bucket, Delete={"Objects": batch, "Quiet": True})
                batch = []
        if batch:
            self.client.delete_objects(Bucket=self.config.bucket, Delete={"Objects": batch, "Quiet": True})
