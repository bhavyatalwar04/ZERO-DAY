"""
Reinforcement Learning + DSPy User-Decision Learner.

Standalone prototype. NOT wired into the main zero-day-market app.
Goal: track every user decision, treat it as a reward signal, and let
the system slowly learn what kind of recommendations the user accepts.
"""

from __future__ import annotations

import json
import math
import random
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np

try:
    import dspy
except ImportError:
    dspy = None


# ------------------------------------------------------------
# 1. DECISION TRACKING (append-only persistent log)
# ------------------------------------------------------------

DB_PATH = Path("user_decisions.db")


@dataclass(frozen=True)
class Decision:
    decision_id: str
    timestamp: str
    context: dict[str, Any]
    action: str
    candidates: list[str]
    user_choice: str
    reward: float
    metadata: dict[str, Any] = field(default_factory=dict)


class DecisionStore:
    def __init__(self, path: Path = DB_PATH) -> None:
        self.path = path
        self._init_schema()

    def _init_schema(self) -> None:
        with sqlite3.connect(self.path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS decisions (
                    decision_id   TEXT PRIMARY KEY,
                    timestamp     TEXT NOT NULL,
                    context_json  TEXT NOT NULL,
                    action        TEXT NOT NULL,
                    candidates    TEXT NOT NULL,
                    user_choice   TEXT NOT NULL,
                    reward        REAL NOT NULL,
                    metadata_json TEXT NOT NULL
                )
                """
            )

    def record(self, d: Decision) -> None:
        with sqlite3.connect(self.path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO decisions VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    d.decision_id,
                    d.timestamp,
                    json.dumps(d.context),
                    d.action,
                    json.dumps(d.candidates),
                    d.user_choice,
                    d.reward,
                    json.dumps(d.metadata),
                ),
            )

    def all(self) -> list[Decision]:
        with sqlite3.connect(self.path) as conn:
            rows = conn.execute(
                "SELECT * FROM decisions ORDER BY timestamp"
            ).fetchall()
        return [
            Decision(
                decision_id=r[0],
                timestamp=r[1],
                context=json.loads(r[2]),
                action=r[3],
                candidates=json.loads(r[4]),
                user_choice=r[5],
                reward=r[6],
                metadata=json.loads(r[7]),
            )
            for r in rows
        ]


# ------------------------------------------------------------
# 2. REWARD SHAPING
# ------------------------------------------------------------

REJECTED = "__rejected__"
EDITED = "__edited__"


def compute_reward(suggested: str, user_choice: str, edit_distance: float = 0.0) -> float:
    """+1 accepted, +0.5 alternative, -0.5..+0.5 edited, -1 rejected."""
    if user_choice == suggested:
        return 1.0
    if user_choice == REJECTED:
        return -1.0
    if user_choice == EDITED:
        return max(-1.0, 0.5 - edit_distance)
    return 0.5


# ------------------------------------------------------------
# 3. CONTEXTUAL BANDIT  (LinUCB)
# ------------------------------------------------------------

class LinUCBBandit:
    """
    Linear Upper-Confidence-Bound contextual bandit.
    For each action a we maintain (A_a, b_a) where:
        theta_a = A_a^-1 b_a            <- estimated reward weights
        ucb_a   = theta_a . x  +  alpha * sqrt(x^T A_a^-1 x)
    Pick argmax over candidates. Higher alpha -> more exploration.
    """

    def __init__(self, n_features: int, alpha: float = 1.0) -> None:
        self.n_features = n_features
        self.alpha = alpha
        self.A: dict[str, np.ndarray] = {}
        self.b: dict[str, np.ndarray] = {}

    def _ensure(self, action: str) -> None:
        if action not in self.A:
            self.A[action] = np.eye(self.n_features)
            self.b[action] = np.zeros(self.n_features)

    def score(self, x: np.ndarray, action: str) -> float:
        self._ensure(action)
        A_inv = np.linalg.inv(self.A[action])
        theta = A_inv @ self.b[action]
        mean = float(theta @ x)
        bonus = self.alpha * math.sqrt(float(x @ A_inv @ x))
        return mean + bonus

    def select(self, x: np.ndarray, candidates: list[str]) -> str:
        return max(candidates, key=lambda a: self.score(x, a))

    def update(self, x: np.ndarray, action: str, reward: float) -> None:
        """Rebuild matrices (no in-place mutation)."""
        self._ensure(action)
        A_new = self.A[action] + np.outer(x, x)
        b_new = self.b[action] + reward * x
        self.A = {**self.A, action: A_new}
        self.b = {**self.b, action: b_new}


# ------------------------------------------------------------
# 4. CONTEXT ENCODER (hashing trick)
# ------------------------------------------------------------

def encode_context(ctx: dict[str, Any], dim: int = 16) -> np.ndarray:
    vec = np.zeros(dim)
    for k, v in ctx.items():
        idx = hash(f"{k}:{v}") % dim
        vec[idx] += 1.0
    n = np.linalg.norm(vec)
    return vec / n if n else vec


# ------------------------------------------------------------
# 5. DSPy OPTIMISATION LAYER
# ------------------------------------------------------------

if dspy is not None:

    class RecommendListing(dspy.Signature):
        """Pick the listing the user is most likely to accept."""

        context: str = dspy.InputField(desc="JSON of user/session context")
        candidates: str = dspy.InputField(desc="newline-separated listing ids")
        chosen: str = dspy.OutputField(desc="one id from candidates")
        rationale: str = dspy.OutputField(desc="short reasoning")

    class RecommenderModule(dspy.Module):
        def __init__(self) -> None:
            super().__init__()
            self.predict = dspy.ChainOfThought(RecommendListing)

        def forward(self, context: str, candidates: str):
            return self.predict(context=context, candidates=candidates)

    def build_dspy_trainset(decisions: list[Decision]) -> list:
        examples = []
        for d in decisions:
            if d.reward <= 0:
                continue
            examples.append(
                dspy.Example(
                    context=json.dumps(d.context),
                    candidates="\n".join(d.candidates),
                    chosen=d.user_choice,
                ).with_inputs("context", "candidates")
            )
        return examples

    def reward_metric(example, prediction, _trace=None) -> float:
        return 1.0 if prediction.chosen == example.chosen else 0.0

    def optimise_with_dspy(decisions: list[Decision]):
        """Compile a few-shot recommender from past user decisions."""
        from dspy.teleprompt import BootstrapFewShot

        trainset = build_dspy_trainset(decisions)
        if not trainset:
            return RecommenderModule()
        teleprompter = BootstrapFewShot(
            metric=reward_metric, max_bootstrapped_demos=4
        )
        return teleprompter.compile(RecommenderModule(), trainset=trainset)


# ------------------------------------------------------------
# 6. ORCHESTRATOR
# ------------------------------------------------------------

class UserDecisionLearner:
    def __init__(self, n_features: int = 16) -> None:
        self.store = DecisionStore()
        self.bandit = LinUCBBandit(n_features=n_features)
        self.n_features = n_features
        self._replay()

    def _replay(self) -> None:
        for d in self.store.all():
            x = encode_context(d.context, self.n_features)
            self.bandit.update(x, d.action, d.reward)

    def recommend(self, context: dict[str, Any], candidates: list[str]) -> str:
        x = encode_context(context, self.n_features)
        return self.bandit.select(x, candidates)

    def observe(
        self,
        context: dict[str, Any],
        candidates: list[str],
        suggested: str,
        user_choice: str,
        edit_distance: float = 0.0,
    ) -> Decision:
        reward = compute_reward(suggested, user_choice, edit_distance)
        x = encode_context(context, self.n_features)
        self.bandit.update(x, suggested, reward)
        d = Decision(
            decision_id=f"d-{datetime.utcnow().isoformat()}-{random.randint(0, 9999)}",
            timestamp=datetime.utcnow().isoformat(),
            context=context,
            action=suggested,
            candidates=candidates,
            user_choice=user_choice,
            reward=reward,
        )
        self.store.record(d)
        return d


# ------------------------------------------------------------
# 7. DEMO
# ------------------------------------------------------------

def _demo() -> None:
    learner = UserDecisionLearner()
    candidates = ["cve-A", "cve-B", "cve-C"]
    ctx = {"buyer_tier": "gold", "category": "rce", "price_band": "high"}

    first = learner.recommend(ctx, candidates)
    print(f"Initial pick: {first}")

    # Simulate the user consistently preferring cve-B for this context.
    for _ in range(8):
        s = learner.recommend(ctx, candidates)
        learner.observe(ctx, candidates, suggested=s, user_choice="cve-B")

    print(f"After learning: {learner.recommend(ctx, candidates)}")


if __name__ == "__main__":
    _demo()
