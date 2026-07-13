from __future__ import annotations

import argparse
import hashlib
import io
import json
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
    parser.add_argument("--force", action="store_true", help="Allow a test training run below the normal data threshold")
    parser.add_argument("--max-games", type=int, default=int(os.environ.get("TRAINING_MAX_GAMES", "20000")))
    parser.add_argument("--epochs", type=int, default=int(os.environ.get("TRAINING_EPOCHS", "4")))
    parser.add_argument("--batch-size", type=int, default=int(os.environ.get("TRAINING_BATCH_SIZE", "128")))
    parser.add_argument("--model-store", default=os.environ.get("TRAINING_MODEL_STORE", "private-model-store"))
    return parser.parse_args()


def seed_everything(seed: int = 20260713) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


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
    return max(float(np.max(np.abs(actual[0] - expected[0].numpy()))), float(np.max(np.abs(actual[1] - expected[1].numpy()))))


def accepted(metrics: dict[str, Any], previous: dict[str, Any] | None) -> bool:
    if not previous:
        return True
    old = previous.get("validation") if isinstance(previous.get("validation"), dict) else previous
    old_loss = float(old.get("loss", float("inf")))
    old_accuracy = float(old.get("policyAccuracy", 0.0))
    new = metrics["validation"]
    return new["loss"] <= old_loss * 1.02 and new["policyAccuracy"] + 0.005 >= old_accuracy


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


def main() -> None:
    args = parse_args()
    seed_everything()
    api_store = TrainingApiStore(ApiConfig.from_env())
    store = LocalModelStore(args.model_store)
    records = load_records(api_store, args.max_games)
    try:
        maintenance = api_store.prune(args.max_games)
        print(json.dumps({"trainingQueueMaintenance": maintenance}, sort_keys=True))
    except Exception as exc:
        print(json.dumps({"warning": "training-queue-prune-failed", "detail": str(exc)[:240]}))
    train_samples = []
    validation_samples = []
    usable_round_ids: list[str] = []
    usable_records: list[tuple[dict[str, Any], int, int]] = []
    for record in records:
        samples = samples_from_record(record)
        if not samples:
            continue
        round_id = str(record.get("roundId", "")).strip()
        if not round_id:
            continue
        usable_round_ids.append(round_id)
        ended_at = max(0, int(record.get("endedAt", 0) or 0))
        usable_records.append((record, ended_at, len(samples)))
        target = validation_samples if stable_validation_round(round_id) else train_samples
        target.extend(samples)

    usable_games = len(usable_round_ids)
    total_samples = len(train_samples) + len(validation_samples)
    dataset_fingerprint = sha256("\n".join(sorted(usable_round_ids)).encode("utf-8"))

    current_pointer = store.get_json("models/current.json")
    current_metrics = None
    current_version = None
    if current_pointer and current_pointer.get("version"):
        current_version = str(current_pointer["version"])
        current_metrics = store.get_json(f"models/{current_version}/metrics.json")

    if current_metrics and current_metrics.get("datasetFingerprint") == dataset_fingerprint:
        print(json.dumps({
            "trained": False,
            "reason": "no-new-data",
            "games": usable_games,
            "samples": total_samples,
        }, sort_keys=True))
        return

    previous_max_ended_at = int((current_metrics or {}).get("maxEndedAt", 0) or 0)
    if current_metrics and previous_max_ended_at > 0:
        new_round_ids = {
            str(record.get("roundId", ""))
            for record, ended_at, _ in usable_records
            if ended_at > previous_max_ended_at
        }
        new_games = len(new_round_ids)
        new_samples = sum(sample_count for _, ended_at, sample_count in usable_records if ended_at > previous_max_ended_at)
    else:
        new_games = usable_games
        new_samples = total_samples
    max_ended_at = max((ended_at for _, ended_at, _ in usable_records), default=0)
    initial_threshold_met = usable_games >= 500 or total_samples >= 50_000
    update_threshold_met = new_games >= 500 or new_samples >= 50_000
    threshold_met = initial_threshold_met if not current_metrics else update_threshold_met
    promotion_eligible = threshold_met and not args.force

    if not threshold_met and not args.force:
        print(json.dumps({
            "trained": False,
            "reason": "insufficient-new-data" if current_metrics else "insufficient-data",
            "games": usable_games,
            "samples": total_samples,
            "newGames": new_games,
            "newSamples": new_samples,
        }, sort_keys=True))
        return
    if len(train_samples) < 64 or len(validation_samples) < 16:
        raise RuntimeError(f"Insufficient train/validation split: {len(train_samples)}/{len(validation_samples)}")

    train_loader = DataLoader(DhametDataset(train_samples), batch_size=args.batch_size, shuffle=True, num_workers=0)
    validation_loader = DataLoader(DhametDataset(validation_samples), batch_size=args.batch_size, shuffle=False, num_workers=0)
    model = DhametPolicyValueNet()
    base_version = None
    if current_version and _compatible_checkpoint(current_metrics):
        try:
            checkpoint_bytes = store.get_bytes(f"models/{current_version}/checkpoint.pt")
            checkpoint = torch.load(io.BytesIO(checkpoint_bytes), map_location="cpu", weights_only=False)
            state_dict = checkpoint.get("model") if isinstance(checkpoint, dict) else None
            if isinstance(state_dict, dict):
                model.load_state_dict(state_dict, strict=True)
                base_version = current_version
        except Exception as exc:
            print(json.dumps({"warning": "checkpoint-not-reused", "version": current_version, "detail": str(exc)[:240]}))

    baseline_validation = run_epoch(model, validation_loader) if base_version else None
    optimizer = torch.optim.AdamW(model.parameters(), lr=8e-4, weight_decay=1e-4)
    history = []
    for epoch in range(max(1, args.epochs)):
        train_metrics = run_epoch(model, train_loader, optimizer)
        validation_metrics = run_epoch(model, validation_loader)
        history.append({"epoch": epoch + 1, "train": train_metrics, "validation": validation_metrics})
        print(json.dumps(history[-1], sort_keys=True))

    generated = datetime.now(timezone.utc)
    version = generated.strftime("model-%Y%m%dT%H%M%SZ")
    metrics: dict[str, Any] = {
        "version": version,
        "generatedAt": generated.isoformat(),
        "games": usable_games,
        "samples": total_samples,
        "newGames": new_games,
        "newSamples": new_samples,
        "trainSamples": len(train_samples),
        "validationSamples": len(validation_samples),
        "datasetFingerprint": dataset_fingerprint,
        "maxEndedAt": max_ended_at,
        "baseVersion": base_version,
        "baselineValidation": baseline_validation,
        "promotionEligible": promotion_eligible,
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
        torch.save({"model": model.state_dict(), "metrics": metrics}, checkpoint_path)
        parity = export_onnx(model, onnx_path)
        metrics["onnxMaxAbsError"] = parity
        comparison = {"validation": baseline_validation} if baseline_validation else current_metrics
        metrics["accepted"] = promotion_eligible and parity <= 1e-4 and accepted(metrics, comparison)
        if not metrics["accepted"]:
            print(json.dumps({"trained": True, "promoted": False, "metrics": metrics}, sort_keys=True))
            return

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
            store.put_json("models/previous.json", {"version": previous_version, "replacedAt": metrics["generatedAt"]})
        store.put_json("models/current.json", {"version": version, "promotedAt": metrics["generatedAt"], "manifest": prefix + "manifest.json"})

        keep = {version}
        if previous_version:
            keep.add(previous_version)
        obsolete = []
        for key in store.list_keys("models/"):
            parts = key.split("/")
            if len(parts) >= 3 and parts[1].startswith("model-") and parts[1] not in keep:
                obsolete.append(key)
        store.delete_keys(obsolete)
        print(json.dumps({"trained": True, "promoted": True, "version": version, "deletedObjects": len(obsolete), "metrics": metrics}, sort_keys=True))


if __name__ == "__main__":
    main()
