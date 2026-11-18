"""The calculator's three-list engine: the 8 log-linear models of crc-engine, model-averaged.

Wraps the Phase 6 spike's engine (``laplace_is.fit_model``: MAP, Laplace, Pareto-smoothed importance
sampling) for any three-list frequency table without strata.  Runs unchanged natively and in Pyodide.
Input CSV columns: three 0/1 list columns (any names) and ``freq``.
"""

from __future__ import annotations

import io
import json
import time

import numpy as np
import pandas as pd

import laplace_is
import spike_common as sc


def load_table(csv_text: str):
    from crc_engine.tables import CaptureTable

    df = pd.read_csv(io.StringIO(csv_text))
    lists = tuple(c for c in df.columns if c != "freq")
    if len(lists) != 3:
        raise ValueError(f"expected 3 list columns and freq, got {list(df.columns)}")
    df = df[df[list(lists)].sum(axis=1) > 0]
    return CaptureTable.from_frequencies(df, lists, count="freq"), lists


def run(csv_text: str, settings: dict | None = None, log=print) -> dict:
    from crc_engine.bma import model_prior
    from crc_engine.modelspace import model_space

    s = {**laplace_is.DEFAULTS, **(settings or {})}
    t_all = time.perf_counter()
    table, lists = load_table(csv_text)
    specs = model_space(lists)
    prior = model_prior(specs)
    seeds = np.random.SeedSequence(s["seed"]).spawn(len(specs))
    fits, Ns, ws, names = [], [], [], []
    for i, (spec, ss) in enumerate(zip(specs, seeds)):
        pairs = sorted("".join(p) if all(len(x) == 1 for x in p) else "×".join(p) for p in spec.pairs)
        names.append("independence" if not pairs else " + ".join(pairs))
        log(json.dumps({"model": i + 1, "of": len(specs), "name": names[-1]}))
        s_prop, s_pois = ss.spawn(2)
        summary, N, w = laplace_is.fit_model(table, spec, settings=s, rng_proposal=np.random.default_rng(s_prop),
                                             rng_poisson=np.random.default_rng(s_pois), log=lambda m: None)
        fits.append(summary)
        Ns.append(N)
        ws.append(w)
    W = sc.bma_weights([f["importance_log_ml"] for f in fits], prior)
    vals = np.concatenate(Ns)
    wts = np.concatenate([W[m] * ws[m] for m in range(len(specs))])
    n = int(table.n_observed)
    return {"lists": list(lists), "n_observed": n, "bma_N": sc.n_summary(vals, wts),
            "models": [{"name": names[m], "weight": float(W[m]), "khat": fits[m]["khat"], "N": fits[m]["N"],
                        "ess_psis": fits[m]["ess_psis"]} for m in range(len(specs))],
            "draws": int(s["draws"]), "seconds": time.perf_counter() - t_all}


def run_json(csv_text: str, settings_json: str = "{}", log=print) -> str:
    return json.dumps(run(csv_text, json.loads(settings_json), log=log))
