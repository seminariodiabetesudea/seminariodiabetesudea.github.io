"""The browser engine of the Phase 6 spike: MAP, Laplace, then Pareto-smoothed importance sampling.

For each model of ``spike_common.specs`` (the study's own PyMC model, ``crc_engine.models.build_model``):

1. **MAP** with ``pm.find_MAP``.
2. **Laplace** on the model's unconstrained value space: the log density *with* its Jacobian is evaluated
   by PyMC's own vectorised log density (``crc_engine.marginal.batched_log_density``, compiled once and
   needed for step 3 anyway) on a central-difference stencil around the point (1 + 2d + 2d(d-1) points in one
   call), which gives its gradient and Hessian H.  A few Newton steps move from the MAP to the mode of that
   density (``find_MAP`` maximises it without the Jacobian, the same thing for these all-Normal models).
   The covariance is H^-1, and the Laplace marginal likelihood is
   log p(y) ~ log p(y, mode) + d/2 log(2 pi) - 1/2 log det(-H).
   ``hessian="exact"`` uses PyTensor's symbolic Hessian instead (one more compiled function per model,
   about 3 s each in Pyodide); the native check ``check_hessian`` compares the two.
3. **Importance sampling** from the Laplace fit: a multivariate t (``df`` degrees of freedom, scale matrix
   ``scale``^2 H^-1; ``proposal="normal"`` gives the Gaussian instead), the log density evaluated in one
   vectorised call per batch, Pareto-smoothed weights (``crc_engine.marginal.psis_log_mean_weight``; Vehtari
   et al. 2024).  The PSIS estimate is the model's log marginal likelihood; k-hat is its diagnostic.
4. **N**: for each proposal draw, the hidden means exp(X_hidden theta) of the strata; the sum of the strata's
   independent Poisson hidden counts is one Poisson draw with the summed mean, so N = n + Poisson(sum of the
   hidden means), weighted by the smoothed importance weights.

The BMA weights come from the importance-sampling marginal likelihoods with the uniform model prior
(``crc_engine.bma.model_prior``); the BMA N is the weighted mixture of every model's weighted draws.

The defaults are the pipeline's importance-sampling settings (``crc_engine.bma.BMA_SETTINGS``: 200 000
draws, t with 5 degrees of freedom, scale 1.2), with the Laplace mode and covariance in place of the NUTS
draws' mean and covariance.  The same code runs natively and in Pyodide; ``configure_pytensor`` selects
PyTensor's pure-Python backend (no C compiler and no numba in a browser).
"""

from __future__ import annotations

import json
import math
import time

import numpy as np

import spike_common as sc

DEFAULTS = {"draws": 200_000, "df": 5.0, "scale": 1.2, "batch": 20_000, "proposal": "t", "newton_steps": 10,
            "seed": 20261104, "pytensor_mode": "FAST_COMPILE", "hessian": "fd", "check_hessian": False}
#: Central-difference step: eps ** (1/4) times max(1, |x_i|), the usual choice for second differences.
FD_STEP = float(np.finfo(float).eps) ** 0.25


def configure_pytensor(mode: str = DEFAULTS["pytensor_mode"]) -> dict:
    """PyTensor's Python backend: no C++ compiler, no numba.

    ``FAST_COMPILE`` (Python VM, no C thunks, the light rewrite set) keeps elementwise operations as single
    NumPy calls; the default rewrites would fuse them into ``Composite`` ops, which the Python backend runs
    element by element through ``np.frompyfunc``.  ``"VM_NOFUSION"`` is the full ``fast_run`` rewrite set on
    the Python VM, without fusion.  ``traceback__limit = 0`` stops PyTensor from recording, for every graph
    node it creates, the user's stack with its source lines (only error messages use them); reading those
    lines through ``linecache`` costs seconds per model in Pyodide, more when the modules are sourceless .pyc.
    """
    import pytensor

    pytensor.config.traceback__limit = 0

    if mode == "VM_NOFUSION":
        from pytensor.compile.mode import Mode
        from pytensor.link.vm import VMLinker

        pytensor.config.mode = Mode(VMLinker(use_cloop=False, c_thunks=False), "fast_run").excluding("fusion")
    else:
        pytensor.config.mode = mode
    return {"mode": str(mode), "cxx": pytensor.config.cxx, "linker": str(pytensor.config.linker),
            "traceback__limit": int(pytensor.config.traceback__limit)}


def _flat_layout(model):
    from crc_engine.marginal import _value_layout

    layout = _value_layout(model)
    sizes = [int(np.prod(s)) for _, _, s in layout]
    return layout, sizes, np.cumsum([0] + sizes)


def _flat_point(point: dict, layout) -> np.ndarray:
    return np.concatenate([np.ravel(np.asarray(point[v], float)) for _, v, _ in layout])


def _value_replacements(model, X, layout, cuts, batched: bool):
    out = {}
    for i, rv in enumerate(model.free_RVs):
        shape = tuple(layout[i][2])
        if batched:
            out[model.rvs_to_values[rv]] = X[:, cuts[i]:cuts[i + 1]].reshape((X.shape[0],) + shape)
        else:
            out[model.rvs_to_values[rv]] = X[cuts[i]:cuts[i + 1]].reshape(shape)
    return out


def compile_local(model):
    """Exact log p, gradient and Hessian on the flat unconstrained vector, with the Jacobian (one function)."""
    import pytensor
    import pytensor.tensor as pt
    from pytensor.gradient import grad, jacobian
    from pytensor.graph.replace import graph_replace

    layout, _, cuts = _flat_layout(model)
    x = pt.vector("x", dtype="float64")
    lp = graph_replace(model.logp(jacobian=True), _value_replacements(model, x, layout, cuts, False), strict=False)
    g = grad(lp, x)
    H = jacobian(g, x, vectorize=True)
    return pytensor.function([x], [lp, g, H])


def fd_derivatives(f, x: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
    """log p, gradient and Hessian at ``x`` by central differences, from one call of the batched ``f``."""
    d = x.size
    h = FD_STEP * np.maximum(1.0, np.abs(x))
    E = np.diag(h)
    pairs = [(i, j) for i in range(d) for j in range(i + 1, d)]
    signs = ((1, 1), (1, -1), (-1, 1), (-1, -1))
    P = np.vstack([x[None, :], x + E, x - E] + [x + si * E[i] + sj * E[j] for i, j in pairs for si, sj in signs]
                  if pairs else [x[None, :], x + E, x - E])
    v = np.asarray(f(P), float)
    f0, fp, fm = float(v[0]), v[1:1 + d], v[1 + d:1 + 2 * d]
    g = (fp - fm) / (2 * h)
    H = np.diag((fp - 2 * f0 + fm) / h ** 2)
    if pairs:
        q = v[1 + 2 * d:].reshape(len(pairs), 4)
        for k, (i, j) in enumerate(pairs):
            H[i, j] = H[j, i] = (q[k, 0] - q[k, 1] - q[k, 2] + q[k, 3]) / (4 * h[i] * h[j])
    return f0, g, H


def compile_batched_theta(model, layout, cuts):
    """The model's ``theta`` (stacked coefficients) for a batch of flat unconstrained vectors, shape (B, P)."""
    import pytensor
    import pytensor.tensor as pt
    from pytensor.graph.replace import vectorize_graph

    X = pt.matrix("X", dtype="float64")
    theta = model.replace_rvs_by_values([model["theta"]])[0]
    out = vectorize_graph(theta, replace=_value_replacements(model, X, layout, cuts, True))
    return pytensor.function([X], out)


def laplace(f, x: np.ndarray, settings: dict, local=None) -> dict:
    """Newton steps to the mode of log p (with the Jacobian), then the Laplace fit there."""
    derivs = (lambda z: tuple(np.asarray(a, float) for a in local(z))) if local is not None else \
        (lambda z: fd_derivatives(f, z))
    steps = 0
    for steps in range(1, settings["newton_steps"] + 1):
        lp, g, H = derivs(x)
        step = np.linalg.solve(-H, g)
        ts = 0.5 ** np.arange(8)                                   # backtracking, evaluated in one call
        vals = np.asarray(f(x + ts[:, None] * step[None, :]), float)
        ok = np.flatnonzero(np.isfinite(vals) & (vals >= float(lp) - 1e-9))
        if ok.size == 0:
            break
        t = ts[ok[0]]
        x = x + t * step
        if np.max(np.abs(t * step)) < 1e-8:
            break
    lp, g, H = derivs(x)
    prec = -0.5 * (H + H.T)
    cov = np.linalg.inv(prec)
    chol = np.linalg.cholesky(0.5 * (cov + cov.T))                 # raises if the point is not a maximum
    log_det_prec = -2.0 * float(np.log(np.diag(chol)).sum())
    d = x.size
    return {"mode": x, "log_density": float(lp), "grad": g, "cov": cov, "chol": chol, "newton_steps": steps,
            "log_ml": float(lp + 0.5 * d * math.log(2 * math.pi) - 0.5 * log_det_prec)}


def fit_model(table, spec, *, settings: dict, rng_proposal: np.random.Generator, rng_poisson: np.random.Generator,
              log=print) -> tuple[dict, np.ndarray, np.ndarray]:
    """Fit one model; returns (summary, N per proposal draw, normalised smoothed weights)."""
    import pymc as pm
    from arviz_stats.base import array_stats
    from scipy.special import gammaln

    from crc_engine.marginal import batched_log_density, psis_log_mean_weight
    from crc_engine.models import build_model
    from crc_engine.priors import PHASE3_PROPOSED

    clock = sc.Clock()
    with clock("build"):
        model, design = build_model(table, spec, PHASE3_PROPOSED)
    layout, _, cuts = _flat_layout(model)
    with clock("map"):
        point = pm.find_MAP(model=model, progressbar=False, seed=0)
    x_map = _flat_point(point, layout)
    d = x_map.size
    with clock("compile_density"):
        f = batched_log_density(model)
    local = None
    if settings["hessian"] == "exact" or settings["check_hessian"]:
        with clock("compile_exact_hessian"):
            local = compile_local(model)
    with clock("laplace"):
        lap = laplace(f, x_map, settings, local if settings["hessian"] == "exact" else None)
    check = None
    if settings["check_hessian"]:
        other = laplace(f, x_map, settings, None if settings["hessian"] == "exact" else local)
        rel = np.abs(other["cov"] - lap["cov"]) / np.sqrt(np.outer(np.diag(lap["cov"]), np.diag(lap["cov"])))
        check = {"max_abs_cov_diff_in_sd_units": float(rel.max()),
                 "laplace_log_ml_diff": float(other["log_ml"] - lap["log_ml"]),
                 "max_abs_mode_diff": float(np.max(np.abs(other["mode"] - lap["mode"])))}
    # theta, the stacked coefficients: the flat vector itself when the model has no transforms and the MAP
    # point's theta equals its flat values (build_model's all-Normal blocks); otherwise compiled from PyMC.
    identity = all(model.rvs_to_transforms.get(rv) is None for rv in model.free_RVs) and \
        np.shape(point.get("theta", ())) == x_map.shape and np.allclose(point["theta"], x_map, rtol=0, atol=1e-12)
    if identity:
        theta_fn = lambda X: X  # noqa: E731
    else:
        with clock("compile_theta"):
            theta_fn = compile_batched_theta(model, layout, cuts)
    x, chol = lap["mode"], lap["chol"]
    draws, batch, df, scale = settings["draws"], settings["batch"], settings["df"], settings["scale"]
    L = chol * scale
    log_det_L = float(np.log(np.diag(L)).sum())
    if settings["proposal"] == "t":
        const = gammaln((df + d) / 2) - gammaln(df / 2) - 0.5 * d * math.log(df * math.pi) - log_det_L
    elif settings["proposal"] == "normal":
        const = -0.5 * d * math.log(2 * math.pi) - log_det_L
    else:
        raise ValueError("proposal must be 't' or 'normal'")
    lw = np.empty(draws)
    N = np.empty(draws)
    Xh = design.X_hidden
    n_obs = int(table.n_observed)
    t_density = t_proposal = t_N = 0.0
    with clock("importance"):
        for start in range(0, draws, batch):
            m = min(batch, draws - start)
            t0 = time.perf_counter()
            z = rng_proposal.standard_normal((m, d))
            if settings["proposal"] == "t":
                u = df / rng_proposal.chisquare(df, m)
                xs = x + (z @ L.T) * np.sqrt(u)[:, None]
                log_g = const - 0.5 * (df + d) * np.log1p((z ** 2).sum(axis=1) * u / df)
            else:
                xs = x + z @ L.T
                log_g = const - 0.5 * (z ** 2).sum(axis=1)
            t1 = time.perf_counter()
            lq = f(xs)
            t2 = time.perf_counter()
            lw[start:start + m] = np.where(np.isfinite(lq), lq, -np.inf) - log_g
            hidden_total = np.exp(np.asarray(theta_fn(xs), float) @ Xh.T).sum(axis=1)
            N[start:start + m] = n_obs + rng_poisson.poisson(hidden_total)
            t3 = time.perf_counter()
            t_proposal += t1 - t0
            t_density += t2 - t1
            t_N += t3 - t2
        finite = np.isfinite(lw)
        log_ml, khat = psis_log_mean_weight(lw)
        smoothed, _ = array_stats.psislw(-lw[finite], r_eff=1)
        w = np.zeros(draws)
        w[finite] = np.exp(np.asarray(smoothed, float))
        w /= w.sum()
        top = float(lw[finite].max())
        raw = np.where(finite, np.exp(lw - top), 0.0)
        log_ml_raw = top + float(np.log(raw.mean()))
        ess_raw = float(raw.sum() ** 2 / (raw ** 2).sum())
        ess_psis = float(1.0 / (w ** 2).sum())
    seconds = dict(clock.seconds)
    seconds.update({"importance_proposal": t_proposal, "importance_density": t_density, "importance_N": t_N})
    summary = {"model": spec.name, "dim": int(d), "n_params": int(design.n_params),
               "log_density_at_mode": lap["log_density"], "laplace_log_ml": lap["log_ml"],
               "importance_log_ml": float(log_ml), "importance_log_ml_raw": log_ml_raw, "khat": float(khat),
               "ess_raw": ess_raw, "ess_psis": ess_psis, "n_nonfinite": int((~finite).sum()),
               "newton_steps": int(lap["newton_steps"]), "max_abs_grad_at_mode": float(np.max(np.abs(lap["grad"]))),
               "max_abs_mode_minus_map": float(np.max(np.abs(x - x_map))), "theta_identity": bool(identity),
               "hessian_check": check, "N": sc.n_summary(N, w), "seconds": seconds}
    log(f"{spec.name:10s} IS {log_ml:.4f} Laplace {lap['log_ml']:.4f} k {khat:.3f} "
        f"N med {summary['N']['median']:.0f} {sum(clock.seconds.values()):.1f}s")
    return summary, N, w


def run_bma(csv_text: str, settings: dict | None = None, log=print) -> dict:
    """All 8 models and their BMA; returns plain data (JSON-ready)."""
    from crc_engine.bma import model_prior

    s = {**DEFAULTS, **(settings or {})}
    t_all = time.perf_counter()
    table = sc.load_table(csv_text)
    S = sc.specs()
    prior = model_prior(S)
    seeds = np.random.SeedSequence(s["seed"]).spawn(len(S))
    fits, Ns, ws = [], [], []
    for spec, ss in zip(S, seeds):
        s_prop, s_pois = ss.spawn(2)
        summary, N, w = fit_model(table, spec, settings=s, rng_proposal=np.random.default_rng(s_prop),
                                  rng_poisson=np.random.default_rng(s_pois), log=log)
        fits.append(summary)
        Ns.append(N)
        ws.append(w)
    W = sc.bma_weights([f["importance_log_ml"] for f in fits], prior)
    W_laplace = sc.bma_weights([f["laplace_log_ml"] for f in fits], prior)
    vals = np.concatenate(Ns)
    wts = np.concatenate([W[m] * ws[m] for m in range(len(S))])
    bma = sc.n_summary(vals, wts)
    total = time.perf_counter() - t_all
    phases = {}
    for f in fits:
        for k, v in f["seconds"].items():
            phases[k] = phases.get(k, 0.0) + v
    return {"settings": s, "models": [f["model"] for f in fits], "prior_weights": prior.tolist(),
            "weights": W.tolist(), "weights_laplace": W_laplace.tolist(), "bma_N": bma, "fits": fits,
            "n_observed": int(table.n_observed), "max_khat": float(max(f["khat"] for f in fits)),
            "seconds_total": total, "seconds_by_phase": phases}


def run_bma_json(csv_text: str, settings_json: str = "{}") -> str:
    """``run_bma`` with JSON in and out, for the Web Worker."""
    return json.dumps(run_bma(csv_text, json.loads(settings_json)))
