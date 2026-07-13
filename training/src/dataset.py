from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import dataclass
from typing import Any, Iterable

import numpy as np
import torch
from torch.utils.data import Dataset

BOARD_N = 9
N_CELLS = BOARD_N * BOARD_N
ACTION_END_CHAIN = N_CELLS * N_CELLS
ACTION_SOUFLA_REMOVE = ACTION_END_CHAIN + 1
ACTION_SOUFLA_FORCE = ACTION_END_CHAIN + 2
N_ACTIONS = ACTION_END_CHAIN + 3
N_CHANNELS = 28


@dataclass(frozen=True)
class Sample:
    state: np.ndarray
    action: int
    value: float
    value_weight: float
    round_id: str


def _board_from_compact(encoded: str) -> np.ndarray | None:
    try:
        raw = base64.b64decode(encoded)
        board = np.frombuffer(raw, dtype=np.int8)
        if board.size != N_CELLS:
            return None
        return board.reshape(BOARD_N, BOARD_N).copy()
    except Exception:
        return None


def _board_from_state(state: dict[str, Any]) -> np.ndarray | None:
    board = state.get("b")
    if isinstance(board, str):
        return _board_from_compact(board)
    if isinstance(board, list):
        arr = np.asarray(board, dtype=np.int8)
        if arr.shape == (BOARD_N, BOARD_N):
            return arr
    snapshot = state.get("snapshot") if isinstance(state.get("snapshot"), dict) else state
    arr = np.asarray(snapshot.get("board", []), dtype=np.int8)
    return arr if arr.shape == (BOARD_N, BOARD_N) else None


def _fill_piece_planes(target: np.ndarray, offset: int, board: np.ndarray) -> None:
    target[offset + 0] = board == 1
    target[offset + 1] = board == 2
    target[offset + 2] = board == -1
    target[offset + 3] = board == -2


def _soufla_state(snapshot: dict[str, Any]) -> dict[str, Any] | None:
    value = snapshot.get("sp", snapshot.get("soufla"))
    return value if isinstance(value, dict) else None


def _turn_start_board(soufla: dict[str, Any]) -> np.ndarray | None:
    compact = soufla.get("turnStartBoard")
    if isinstance(compact, str):
        return _board_from_compact(compact)
    turn_start = soufla.get("turnStartSnapshot")
    if isinstance(turn_start, dict):
        return _board_from_state(turn_start)
    return None


def encode_state(state: dict[str, Any], actor: int) -> np.ndarray | None:
    board = _board_from_state(state)
    if board is None or actor not in (-1, 1):
        return None
    snapshot = state.get("snapshot") if isinstance(state.get("snapshot"), dict) else state
    x = np.zeros((N_CHANNELS, BOARD_N, BOARD_N), dtype=np.float32)
    _fill_piece_planes(x, 0, board)
    x[4].fill(1.0 if actor == 1 else 0.0)
    x[5].fill(1.0 if actor == -1 else 0.0)
    in_chain = bool(snapshot.get("ic", snapshot.get("inChain", False)))
    x[6].fill(1.0 if in_chain else 0.0)
    chain_pos = int(snapshot.get("cp", snapshot.get("chainPos", -1)) or -1)
    if 0 <= chain_pos < N_CELLS:
        x[7, chain_pos // BOARD_N, chain_pos % BOARD_N] = 1.0
    forced = bool(snapshot.get("fe", snapshot.get("forcedEnabled", False)))
    x[8].fill(1.0 if forced else 0.0)
    forced_ply = max(0, int(snapshot.get("fp", snapshot.get("forcedPly", snapshot.get("openingPly", 0))) or 0))
    x[9].fill(min(1.0, forced_ply / 10.0))
    move_count = max(0, int(snapshot.get("m", snapshot.get("moveCount", 0)) or 0))
    x[10].fill(min(1.0, move_count / 120.0))
    deferred = snapshot.get("dp", snapshot.get("deferredPromotions", []))
    if isinstance(deferred, list):
        for item in deferred[:16]:
            if not isinstance(item, dict):
                continue
            idx = int(item.get("idx", -1) or -1)
            side = int(item.get("side", 0) or 0)
            if 0 <= idx < N_CELLS and side in (-1, 1):
                x[11 if side == 1 else 12, idx // BOARD_N, idx % BOARD_N] = 1.0

    soufla = _soufla_state(snapshot)
    if soufla:
        x[13].fill(1.0)
        if soufla.get("decisionRequired", True):
            x[14].fill(1.0)

    starter = int(snapshot.get("fs", snapshot.get("openingStarter", 0)) or 0)
    if starter == 1:
        x[15].fill(1.0)
    elif starter == -1:
        x[16].fill(1.0)

    if soufla:
        offenders = soufla.get("offenders", [])
        if isinstance(offenders, list):
            for idx in offenders[:16]:
                idx = int(idx)
                if 0 <= idx < N_CELLS:
                    x[17, idx // BOARD_N, idx % BOARD_N] = 1.0
        started_from = int(soufla.get("startedFrom", soufla.get("ctxStartedFrom", -1)) or -1)
        if 0 <= started_from < N_CELLS:
            x[18, started_from // BOARD_N, started_from % BOARD_N] = 1.0
        offender_side = int(soufla.get("offenderSide", 0) or 0)
        if offender_side == 1:
            x[19].fill(1.0)
        elif offender_side == -1:
            x[20].fill(1.0)
        longest = max(0, int(soufla.get("longestGlobal", 0) or 0))
        captures_done = max(0, int(soufla.get("capturesDone", 0) or 0))
        x[21].fill(min(1.0, longest / 12.0))
        x[22].fill(min(1.0, captures_done / 12.0))
        turn_start = _turn_start_board(soufla)
        if turn_start is not None:
            _fill_piece_planes(x, 23, turn_start)

    x[27].fill(1.0)
    return x


def _target_value(result: dict[str, Any], actor: int) -> tuple[float, float]:
    winner = int(result.get("winner", 0) or 0)
    if winner not in (-1, 0, 1):
        return 0.0, 0.0
    counts = result.get("countsAsResult", True) is not False
    if not counts:
        return 0.0, 0.0
    value = 0.0 if winner == 0 else (1.0 if winner == actor else -1.0)
    adjudicated = bool(result.get("adjudicated")) or str(result.get("terminalType", "")) == "administrative_position"
    return value, 0.5 if adjudicated else 1.0


def samples_from_pvc(record: dict[str, Any]) -> list[Sample]:
    result = record.get("result") if isinstance(record.get("result"), dict) else {}
    round_id = str(record.get("roundId", ""))
    out: list[Sample] = []
    for row in record.get("samples", []):
        if not isinstance(row, dict):
            continue
        action = int(row.get("a", -1) or -1)
        actor = int(row.get("actor", 0) or 0)
        if not 0 <= action < N_ACTIONS or actor not in (-1, 1):
            continue
        state = encode_state(row.get("s") if isinstance(row.get("s"), dict) else {}, actor)
        if state is None:
            continue
        value, weight = _target_value(result, actor)
        out.append(Sample(state, action, value, weight, round_id))
    return out


def samples_from_pvp(record: dict[str, Any]) -> list[Sample]:
    result = record.get("result") if isinstance(record.get("result"), dict) else {}
    round_id = str(record.get("roundId", ""))
    states = record.get("states") if isinstance(record.get("states"), dict) else {}
    out: list[Sample] = []
    for key in sorted(states, key=lambda value: int(value) if str(value).isdigit() else 10**9):
        if not str(key).isdigit() or int(key) <= 0:
            continue
        payload = states.get(key)
        if not isinstance(payload, dict):
            continue
        snapshot = payload.get("snapshot") if isinstance(payload.get("snapshot"), dict) else {}
        next_player = int(snapshot.get("player", 0) or 0)
        actor = -next_player if next_player in (-1, 1) else 0
        from_idx = snapshot.get("lastMoveFrom", snapshot.get("lastMovedFrom"))
        path = snapshot.get("lastMovePath")
        if actor not in (-1, 1) or from_idx is None or not isinstance(path, list) or not path:
            continue
        try:
            from_idx = int(from_idx)
            to_idx = int(path[-1])
        except (TypeError, ValueError):
            continue
        action = from_idx * N_CELLS + to_idx
        if not 0 <= action < ACTION_END_CHAIN:
            continue
        # The state stored at ply N is after the move. Use the previous state as
        # the policy input; it contains the exact authoritative position.
        previous = states.get(str(int(key) - 1))
        if not isinstance(previous, dict):
            continue
        state = encode_state(previous, actor)
        if state is None:
            continue
        value, weight = _target_value(result, actor)
        out.append(Sample(state, action, value, weight, round_id))
    return out


def samples_from_record(record: dict[str, Any]) -> list[Sample]:
    if int(record.get("recordSchema", 0) or 0) != 4 or int(record.get("actionSchema", 0) or 0) != 2:
        return []
    mode = str(record.get("mode", ""))
    return samples_from_pvc(record) if mode == "pvc" else samples_from_pvp(record)


def stable_validation_round(round_id: str, percentage: int = 15) -> bool:
    digest = hashlib.sha256(round_id.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") % 100 < percentage


class DhametDataset(Dataset[tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]]):
    def __init__(self, samples: Iterable[Sample]):
        self.samples = list(samples)

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int):
        row = self.samples[index]
        return (
            torch.from_numpy(row.state),
            torch.tensor(row.action, dtype=torch.long),
            torch.tensor(row.value, dtype=torch.float32),
            torch.tensor(row.value_weight, dtype=torch.float32),
        )


def _raw_key_sort_value(key: str) -> tuple[str, str]:
    # raw/<mode>/YYYY/MM/DD/<round>.json: sorting by the date components keeps
    # the training window on the newest records without downloading every old
    # object. The full key provides a deterministic order inside one day.
    parts = str(key).split("/")
    date = "".join(parts[2:5]) if len(parts) >= 6 else "00000000"
    return date, str(key)


def load_records(store, max_games: int) -> list[dict[str, Any]]:
    keys = store.list_keys("raw/")
    keys.sort(key=_raw_key_sort_value, reverse=True)
    selected = keys[:max(1, int(max_games))]
    records: dict[str, dict[str, Any]] = {}
    for key in selected:
        try:
            value = json.loads(store.get_bytes(key).decode("utf-8"))
        except Exception:
            continue
        if not isinstance(value, dict):
            continue
        round_id = str(value.get("roundId", "")).strip()
        if round_id:
            records[round_id] = value
    return list(records.values())
