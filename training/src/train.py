from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import random
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort
import torch
from torch import nn
from torch.utils.data import DataLoader

from dataset import DhametDataset, N_ACTIONS, N_CHANNELS, load_records, samples_from_record, stable_validation_round
from model import DhametPolicyValueNet
from storage import ApiConfig, LocalModelStore, TrainingApiStore


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-games", type=int, default=int(os.environ.get("TRAINING_MAX_GAMES", "5000")))
    parser.add_argument("--epochs", type=int, default=int(os.environ.get("TRAINING_EPOCHS", "1")))
    parser.add_argument("--batch-size", type=int, default=int(os.environ.get("TRAINING_BATCH_SIZE", "128")))
    parser.add_argument("--model-store", default=os.environ.get("TRAINING_MODEL_STORE", "private-model-store"))
    parser.add_argument("--receipt", required=True)
    return parser.parse_args()


def seed_everything(seed: int = 20260713) -> None:
    threads = max(1, min(4, int(os.environ.get("TRAINING_CPU_THREADS", "2") or 2)))
    torch.set_num_threads(threads)
    try:
        torch.set_num_interop_threads(1)
    except RuntimeError:
        pass
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def github_outputs(model_changed: bool, consume_ready: bool) -> None:
    output = os.environ.get("GITHUB_OUTPUT", "").strip()
    if not output:
        return
    with open(output, "a", encoding="utf-8") as handle:
        handle.write(f"model_changed={'true' if model_changed else 'false'}\n")
        handle.write(f"consume_ready={'true' if consume_ready else 'false'}\n")


def write_receipt(path: str | Path, round_ids: list[str], model_version: str | None, model_changed: bool, reason: str) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps({
        "roundIds": round_ids,
        "modelVersion": model_version,
        "modelChanged": model_changed,
        "reason": reason,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }, ensure_ascii=False, sort_keys=True, indent=2), encoding="utf-8")


def run_epoch(model, loader, optimizer=None) -> dict[str, float]:
    training = optimizer is not None
    model.train(training)
    ce = nn.CrossEntropyLoss()
    total_loss = total_policy = total_value = correct = count = 0.0
    for states, actions, values, value_weights in loader:
        logits, predictions = model(states)
        policy_loss = ce(logits, actions)
        weighted = value_weights.sum().clamp_min(1.0)
        value_loss = (((predictions - values) ** 2) * value_weights).sum() / weighted
        loss = policy_loss + value_loss
        if training:
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimizer.step()
        batch = states.shape[0]
        total_loss += float(loss.detach()) * batch
        total_policy += float(policy_loss.detach()) * batch
        total_value += float(value_loss.detach()) * batch
        correct += float((logits.argmax(1) == actions).sum())
        count += batch
    denom = max(1.0, count)
    return {
        "loss": total_loss / denom,
        "policyLoss": total_policy / denom,
        "valueMse": total_value / denom,
        "policyAccuracy": correct / denom,
        "samples": int(count),
    }


def export_onnx(model: DhametPolicyValueNet, path: Path) -> float:
    model.eval()
    sample = torch.zeros((2, N_CHANNELS, 9, 9), dtype=torch.float32)
    torch.onnx.export(
        model,
        sample,
        path,
        input_names=["state"],
        output_names=["policy", "value"],
        dynamic_axes={"state": {0: "batch"}, "policy": {0: "batch"}, "value": {0: "batch"}},
        opset_version=18,
        dynamo=False,
    )
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    with torch.no_grad():
        expected = model(sample)
    actual = session.run(None, {"state": sample.numpy()})
    return max(
        float(np.max(np.abs(actual[0] - expected[0].numpy()))),
        float(np.max(np.abs(actual[1] - expected[1].numpy()))),
    )


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _compatible_checkpoint(metrics: dict[str, Any] | None) -> bool:
    if not metrics:
        return False
    return (
        int(metrics.get("recordSchema", 0) or 0) == 4
        and int(metrics.get("stateSchema", 0) or 0) == 4
        and int(metrics.get("actionSchema", 0) or 0) == 2
        and int(metrics.get("channels", 0) or 0) == N_CHANNELS
        and int(metrics.get("actions", 0) or 0) == N_ACTIONS
    )


def _finite_metrics(value: dict[str, Any]) -> bool:
    for key in ("loss", "policyLoss", "valueMse", "policyAccuracy"):
        number = float(value.get(key, float("nan")))
        if not math.isfinite(number):
            return False
    return True


def _fallback_split(samples):
    rows = list(samples)
    if not rows:
        return [], []
    if len(rows) == 1:
        return rows, rows
    validation_count = max(1, min(len(rows) // 5, 256))
    validation = rows[:validation_count]
    training = rows[validation_count:]
    if not training:
        training = rows[:-1]
        validation = rows[-1:]
    return training, validation


def main() -> None:
    args = parse_args()
    seed_everything()
    api_store = TrainingApiStore(ApiConfig.from_env())
    store = LocalModelStore(args.model_store)

    current_pointer = store.get_json("models/current.json")
    current_metrics = None
    current_version = None
    if current_pointer and current_pointer.get("version"):
        current_version = str(current_pointer["version"])
        current_metrics = store.get_json(f"models/{current_version}/metrics.json")

    records = load_records(api_store, args.max_games)
    record_map: dict[str, dict[str, Any]] = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        round_id = str(record.get("roundId", "")).strip()
        if round_id:
            record_map[round_id] = record
    if not record_map:
        github_outputs(False, False)
        print(json.dumps({"trained": False, "reason": "no-saved-records"}, sort_keys=True))
        return

    already_processed = {
        str(value).strip()
        for value in ((current_metrics or {}).get("processedRoundIds") or [])
        if str(value).strip()
    }
    pending_cleanup = sorted(round_id for round_id in record_map if round_id in already_processed)
    new_records = [record for round_id, record in record_map.items() if round_id not in already_processed]

    if not new_records:
        write_receipt(args.receipt, pending_cleanup, current_version, False, "previously-trained-pending-deletion")
        github_outputs(False, bool(pending_cleanup))
        print(json.dumps({
            "trained": False,
            "reason": "previously-trained-pending-deletion",
            "records": len(pending_cleanup),
        }, sort_keys=True))
        return

    train_samples = []
    validation_samples = []
    batch_round_ids: list[str] = []
    batch_sample_count = 0
    for record in new_records:
        round_id = str(record.get("roundId", "")).strip()
        samples = samples_from_record(record)
        batch_round_ids.append(round_id)
        batch_sample_count += len(samples)
        target = validation_samples if stable_validation_round(round_id) else train_samples
        target.extend(samples)

    all_samples = train_samples + validation_samples
    consume_round_ids = sorted(set(pending_cleanup + batch_round_ids))
    if not all_samples:
        write_receipt(args.receipt, consume_round_ids, current_version, False, "records-contained-no-usable-samples")
        github_outputs(False, True)
        print(json.dumps({
            "trained": False,
            "reason": "records-contained-no-usable-samples",
            "records": len(batch_round_ids),
        }, sort_keys=True))
        return

    if not train_samples or not validation_samples:
        train_samples, validation_samples = _fallback_split(all_samples)

    train_loader = DataLoader(
        DhametDataset(train_samples),
        batch_size=max(1, args.batch_size),
        shuffle=True,
        num_workers=0,
    )
    validation_loader = DataLoader(
        DhametDataset(validation_samples),
        batch_size=max(1, args.batch_size),
        shuffle=False,
        num_workers=0,
    )

    model = DhametPolicyValueNet()
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-4, weight_decay=1e-4)
    base_version = None
    if current_version and _compatible_checkpoint(current_metrics):
        try:
            checkpoint_bytes = store.get_bytes(f"models/{current_version}/checkpoint.pt")
            checkpoint = torch.load(io.BytesIO(checkpoint_bytes), map_location="cpu", weights_only=False)
            state_dict = checkpoint.get("model") if isinstance(checkpoint, dict) else None
            if isinstance(state_dict, dict):
                model.load_state_dict(state_dict, strict=True)
                base_version = current_version
            optimizer_state = checkpoint.get("optimizer") if isinstance(checkpoint, dict) else None
            if isinstance(optimizer_state, dict):
                optimizer.load_state_dict(optimizer_state)
                for group in optimizer.param_groups:
                    group["lr"] = 2e-4
        except Exception as exc:
            print(json.dumps({
                "warning": "checkpoint-not-reused",
                "version": current_version,
                "detail": str(exc)[:240],
            }))

    baseline_validation = run_epoch(model, validation_loader) if base_version else None
    history = []
    for epoch in range(max(1, args.epochs)):
        train_metrics = run_epoch(model, train_loader, optimizer)
        validation_metrics = run_epoch(model, validation_loader)
        if not _finite_metrics(train_metrics) or not _finite_metrics(validation_metrics):
            raise RuntimeError("Training produced non-finite metrics")
        history.append({"epoch": epoch + 1, "train": train_metrics, "validation": validation_metrics})
        print(json.dumps(history[-1], sort_keys=True))

    generated = datetime.now(timezone.utc)
    version = generated.strftime("model-%Y%m%dT%H%M%SZ")
    dataset_fingerprint = sha256("\n".join(sorted(batch_round_ids)).encode("utf-8"))
    metrics: dict[str, Any] = {
        "version": version,
        "generatedAt": generated.isoformat(),
        "batchGames": len(batch_round_ids),
        "batchSamples": batch_sample_count,
        "trainSamples": len(train_samples),
        "validationSamples": len(validation_samples),
        "datasetFingerprint": dataset_fingerprint,
        "processedRoundIds": consume_round_ids,
        "baseVersion": base_version,
        "baselineValidation": baseline_validation,
        "validation": history[-1]["validation"],
        "history": history,
        "recordSchema": 4,
        "stateSchema": 4,
        "actionSchema": 2,
        "channels": N_CHANNELS,
        "actions": N_ACTIONS,
    }

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        checkpoint_path = tmp_path / "checkpoint.pt"
        onnx_path = tmp_path / "model.onnx"
        torch.save({
            "model": model.state_dict(),
            "optimizer": optimizer.state_dict(),
            "metrics": metrics,
        }, checkpoint_path)
        parity = export_onnx(model, onnx_path)
        metrics["onnxMaxAbsError"] = parity
        if not math.isfinite(parity) or parity > 1e-4:
            raise RuntimeError(f"ONNX parity check failed: {parity}")

        checkpoint = checkpoint_path.read_bytes()
        onnx_model = onnx_path.read_bytes()
        metrics_bytes = json.dumps(metrics, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8")
        manifest = {
            "version": version,
            "generatedAt": metrics["generatedAt"],
            "recordSchema": 4,
            "stateSchema": 4,
            "actionSchema": 2,
            "requiresLegalActionMask": True,
            "files": {
                "model.onnx": sha256(onnx_model),
                "checkpoint.pt": sha256(checkpoint),
                "metrics.json": sha256(metrics_bytes),
            },
        }
        prefix = f"models/{version}/"
        store.put_bytes(prefix + "model.onnx", onnx_model, "application/octet-stream")
        store.put_bytes(prefix + "checkpoint.pt", checkpoint, "application/octet-stream")
        store.put_bytes(prefix + "metrics.json", metrics_bytes, "application/json")
        store.put_json(prefix + "manifest.json", manifest)

        previous_version = current_version
        if previous_version:
            store.put_json("models/previous.json", {
                "version": previous_version,
                "replacedAt": metrics["generatedAt"],
            })
        store.put_json("models/current.json", {
            "version": version,
            "promotedAt": metrics["generatedAt"],
            "manifest": prefix + "manifest.json",
        })

        keep = {version}
        if previous_version:
            keep.add(previous_version)
        obsolete = []
        for key in store.list_keys("models/"):
            parts = key.split("/")
            if len(parts) >= 3 and parts[1].startswith("model-") and parts[1] not in keep:
                obsolete.append(key)
        store.delete_keys(obsolete)

    write_receipt(args.receipt, consume_round_ids, version, True, "training-completed")
    github_outputs(True, True)
    print(json.dumps({
        "trained": True,
        "promoted": True,
        "version": version,
        "consumableRecords": len(consume_round_ids),
        "deletedModelFiles": len(obsolete),
        "metrics": metrics,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
