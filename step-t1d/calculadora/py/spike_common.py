"""Shared pieces of the Phase 6 spike: the table, the 8 models, BMA weights and mixture quantiles.

Runs unchanged natively and in Pyodide.  The models are crc-engine's own: ``model_space`` for three lists
without covariates gives the 8 dependence structures, each with a saturated count part (one count intercept
per stratum), fitted with the unstratified builder ``crc_engine.models.build_model`` and ``PHASE3_PROPOSED``.
"""

from __future__ import annotations

import io
import time
from contextlib import contextmanager
from typing import Sequence

import numpy as np
import pandas as pd

LISTS = ("A", "B", "C")
STRATA = ("sex", "age_band")
LEVELS = {"sex": ("F", "M"), "age_band": ("0-4", "5-9", "10-14")}


def load_table(csv_text: str):
    """The synthetic frequency table as a ``crc_engine.tables.CaptureTable``."""
    from crc_engine.tables import CaptureTable

    df = pd.read_csv(io.StringIO(csv_text), dtype={"sex": str, "age_band": str})
    return CaptureTable.from_frequencies(df, LISTS, count="freq", strata=STRATA, levels=LEVELS)


def specs():
    """The 8 dependence structures for three lists (no list x covariate terms), saturated count part."""
    from crc_engine.modelspace import model_space

    return model_space(LISTS)


def bma_weights(log_ml: Sequence[float], prior: Sequence[float]) -> np.ndarray:
    """Posterior model probabilities from log marginal likelihoods and prior model probabilities."""
    a = np.asarray(log_ml, float) + np.log(np.asarray(prior, float))
    a = a - np.max(a)
    w = np.exp(a)
    return w / w.sum()


def weighted_quantiles(values: np.ndarray, weights: np.ndarray, qs: Sequence[float]) -> np.ndarray:
    """Quantiles of a weighted empirical distribution: the smallest value whose cumulative weight reaches q
    (the inverse-CDF convention of ``crc_engine.validation.recovery.mixture_quantiles``)."""
    v = np.asarray(values, float).ravel()
    w = np.asarray(weights, float).ravel()
    order = np.argsort(v, kind="stable")
    v, cw = v[order], np.cumsum(w[order])
    cw /= cw[-1]
    idx = np.searchsorted(cw, np.asarray(qs, float) - 1e-12, side="left")
    return v[np.minimum(idx, len(v) - 1)]


def n_summary(values: np.ndarray, weights: np.ndarray | None = None) -> dict:
    """Median, 95% equal-tailed interval and mean of N."""
    v = np.asarray(values, float).ravel()
    w = np.full(v.size, 1.0 / v.size) if weights is None else np.asarray(weights, float).ravel()
    lo, med, hi = weighted_quantiles(v, w, [0.025, 0.5, 0.975])
    return {"median": float(med), "lower": float(lo), "upper": float(hi), "mean": float(np.sum(w * v) / np.sum(w))}


class Clock:
    """Named wall-clock timings, in seconds."""

    def __init__(self):
        self.seconds: dict[str, float] = {}

    @contextmanager
    def __call__(self, name: str):
        t0 = time.perf_counter()
        try:
            yield
        finally:
            self.seconds[name] = self.seconds.get(name, 0.0) + time.perf_counter() - t0
