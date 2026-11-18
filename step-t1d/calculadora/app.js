// The guided capture-recapture calculator: six steps that explain the method and compute it on the
// visitor's own counts.  Two lists: Chapman estimate here, in JavaScript.  Three lists: the 8 log-linear
// models fitted and averaged by the engine in worker.mjs (Pyodide).  Steps 4-5 and the fit check in
// step 6 use small maximum-likelihood fits computed here.  No data leave the browser.
import { T } from "./text.js";

const EXAMPLES = { 2: { names: ["A", "B"], counts: { "11": 105, "10": 161, "01": 153 } },
                   3: { names: ["A", "B", "C"], counts: { "111": 24, "110": 81, "101": 31, "100": 130, "011": 29, "010": 124, "001": 81 } } };
const SUBS = ["a", "b", "c", "d", "e"];
const $ = (id) => document.getElementById(id);
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } },
                set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } } };
const saved = store.get("stept1d-lang");
const S = {
  lang: saved === "en" || saved === "es" ? saved : ((navigator.language || "es").toLowerCase().startsWith("en") ? "en" : "es"),
  names: [...EXAMPLES[3].names], counts: { ...EXAMPLES[3].counts }, preset: "ex3",
  step: 1, sub: "a", showAll: false, overlap: null, msg: "", msgErr: false,
  run: { status: "idle", key: null, result: null, error: null, progress: "", frac: null },
};
let worker = null;
window.__calc = S.run;

const L = () => T[S.lang];
const fmt = (x, d = 0) => Number(x).toLocaleString(S.lang === "es" ? "es-CO" : "en", { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (x, d = 0) => fmt(100 * x, d) + " %";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- counts ----------
const K = () => S.names.length;
function patterns(k = K()) {
  const out = [];
  for (let i = (1 << k) - 1; i >= 1; i--) out.push(i.toString(2).padStart(k, "0"));
  return out;
}
// Display order used by the mockups: singles, pairs, all.
function orderedPatterns(k = K()) {
  return patterns(k).sort((a, b) => (a.split("1").length - b.split("1").length) || (a < b ? 1 : -1));
}
const c = (h) => S.counts[h] || 0;
const nObs = () => patterns().reduce((s, h) => s + c(h), 0);
const listSize = (i) => patterns().filter((h) => h[i] === "1").reduce((s, h) => s + c(h), 0);
const overlapOf = (i, j) => patterns().filter((h) => h[i] === "1" && h[j] === "1").reduce((s, h) => s + c(h), 0);
const key = () => JSON.stringify([S.names, patterns().map(c)]);
const lname = (i) => esc(S.names[i]);
const defaultNames = () => S.names.every((n, i) => n === "ABC"[i]);

// ---------- estimators ----------
function chapman(cnt) {
  const m = cnt["11"] || 0, n1 = m + (cnt["10"] || 0), n2 = m + (cnt["01"] || 0), n = n1 + n2 - m;
  if (m === 0) return { n, undefinedEstimate: true };
  const N = (n1 + 1) * (n2 + 1) / (m + 1) - 1;
  const v = (n1 + 1) * (n2 + 1) * (n1 - m) * (n2 - m) / ((m + 1) ** 2 * (m + 2));
  const f0 = N - n;
  let lo = n, hi = n;
  if (f0 > 0) {
    const C = Math.exp(1.96 * Math.sqrt(Math.log(1 + v / f0 ** 2)));
    lo = n + f0 / C; hi = n + f0 * C;
  }
  return { n, N: { median: N, lower: lo, upper: hi }, method: "chapman" };
}

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let col = 0; col < n; col++) {
    let p = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[p][col])) p = r;
    if (Math.abs(M[p][col]) < 1e-12) return null;
    [M[col], M[p]] = [M[p], M[col]];
    for (let r = 0; r < n; r++) if (r !== col) {
      const f = M[r][col] / M[col][col];
      for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

// The 8 three-list models: every subset of the pairwise interactions.  Named as the engine names them.
const PAIRS = [[0, 1], [0, 2], [1, 2]];
function pairLabel(p) { const a = S.names[p[0]], b = S.names[p[1]]; return a.length === 1 && b.length === 1 ? a + b : a + "×" + b; }
function modelSpecs() {
  const out = [];
  for (const sub of [[], [0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]]) {
    const pairs = sub.map((i) => PAIRS[i]);
    const nm = pairs.map(pairLabel).sort();
    out.push({ pairs, name: nm.length ? nm.join(" + ") : "independence" });
  }
  return out;
}
// Poisson maximum-likelihood fit of one log-linear model to the 7 observed cells (Newton-Raphson).
function fitMLE(pairs) {
  const pats = patterns(3);
  const X = pats.map((h) => { const b = [...h].map(Number); return [1, ...b, ...pairs.map(([i, j]) => b[i] * b[j])]; });
  const y = pats.map(c);
  const p = X[0].length;
  let beta = new Array(p).fill(0);
  beta[0] = Math.log(Math.max(1, y.reduce((a, v) => a + v, 0) / y.length));
  for (let it = 0; it < 200; it++) {
    const mu = X.map((r) => Math.exp(r.reduce((s, v, j) => s + v * beta[j], 0)));
    const g = new Array(p).fill(0), H = Array.from({ length: p }, () => new Array(p).fill(0));
    X.forEach((r, i) => { for (let a = 0; a < p; a++) { g[a] += r[a] * (y[i] - mu[i]); for (let b2 = 0; b2 < p; b2++) H[a][b2] += r[a] * r[b2] * mu[i]; } });
    const d = solve(H, g);
    if (!d) return null;
    let step = 1;
    const ll = (bb) => X.reduce((s, r, i) => { const eta = r.reduce((t, v, j) => t + v * bb[j], 0); return s + y[i] * eta - Math.exp(eta); }, 0);
    const base = ll(beta);
    let nb = beta.map((v, j) => v + d[j]);
    while (ll(nb) < base - 1e-9 && step > 1e-6) { step /= 2; nb = beta.map((v, j) => v + step * d[j]); }
    beta = nb;
    if (Math.max(...d.map(Math.abs)) * step < 1e-10) break;
  }
  const fitted = Object.fromEntries(pats.map((h, i) => [h, Math.exp(X[i].reduce((s, v, j) => s + v * beta[j], 0))]));
  const n0 = Math.exp(beta[0]);
  if (!Number.isFinite(n0) || n0 > 1e9) return null;
  return { fitted, n0, N: nObs() + n0 };
}

// ---------- data input ----------
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error("empty");
  const sep = lines[0].includes(";") && !lines[0].includes(",") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  return lines.map((l) => l.split(sep).map((x) => x.trim().replace(/^"|"$/g, "")));
}
function fromFrequencyCsv(text) {
  const rows = parseCsv(text), head = rows[0];
  const fi = head.findIndex((h) => /^(freq|count|n)$/i.test(h));
  if (fi < 0) throw new Error("freq");
  const lists = head.filter((_, i) => i !== fi);
  const counts = {};
  for (const r of rows.slice(1)) {
    const h = lists.map((nm) => r[head.indexOf(nm)]).join("");
    if (!/^[01]+$/.test(h)) throw new Error(r.join(","));
    const v = Number(r[fi]);
    if (!Number.isInteger(v) || v < 0) throw new Error(L().err.bad);
    if (h.includes("1")) counts[h] = (counts[h] || 0) + v;
  }
  return { lists, counts };
}
function fromIndividualCsv(text) {
  const rows = parseCsv(text), head = rows[0], body = rows.slice(1);
  const keep = head.map((_, i) => body.length > 0 && body.every((r) => r[i] === "0" || r[i] === "1"));
  const lists = head.filter((_, i) => keep[i]), ignored = head.filter((_, i) => !keep[i]);
  const counts = {};
  let zero = 0;
  for (const r of body) {
    const h = head.map((_, i) => (keep[i] ? r[i] : "")).join("");
    if (!h.includes("1")) { zero++; continue; }
    counts[h] = (counts[h] || 0) + 1;
  }
  return { lists, counts, ignored, zero, n: body.length - zero };
}
function setTable(names, counts, preset) {
  if (names.length < 2 || names.length > 3) throw new Error(L().err.lists);
  if (new Set(names).size !== names.length || names.some((n) => !n)) throw new Error(L().err.names);
  S.names = names; S.counts = { ...counts }; S.preset = preset; S.overlap = null;
}

// ---------- shared pieces ----------
function venn(k = K()) {
  const t = (x, y, h, cls = "") => `<text x="${x}" y="${y}" font-size="16" text-anchor="middle" class="${cls}" data-v="${h}">${fmt(c(h))}</text>`;
  const circ = (x, y, r, col, op) => `<circle cx="${x}" cy="${y}" r="${r}" style="fill:${col};fill-opacity:${op};stroke:${col};stroke-width:2"></circle>`;
  const lab = (x, y, i) => `<text class="cl" x="${x}" y="${y}" font-size="15" text-anchor="middle">${lname(i)}</text>`;
  const aria = esc(L().vennAria(S.names, orderedPatterns().map((h) => [h, c(h)])));
  if (k === 2) {
    return `<svg viewBox="0 0 320 240" role="img" aria-label="${aria}">${circ(120, 110, 85, "var(--chart-cat-1)", .15)}${circ(200, 110, 85, "var(--accent-quiet)", .15)}` +
      `${lab(70, 22, 0)}${lab(250, 22, 1)}${t(85, 115, "10")}${t(235, 115, "01")}${t(160, 115, "11")}` +
      `<text x="10" y="228" font-size="15">00 = ?</text></svg>`;
  }
  return `<svg viewBox="0 0 320 272" role="img" aria-label="${aria}">${circ(120, 100, 80, "var(--chart-cat-1)", .15)}${circ(200, 100, 80, "var(--accent-quiet)", .15)}${circ(160, 170, 80, "var(--text)", .07)}` +
    `${lab(48, 24, 0)}${lab(272, 24, 1)}${lab(258, 250, 2)}` +
    `${t(85, 85, "100")}${t(235, 85, "010")}${t(160, 225, "001")}${t(160, 70, "110")}${t(112, 160, "101")}${t(208, 160, "011")}${t(160, 132, "111")}` +
    `<text x="10" y="262" font-size="15">000 = ?</text></svg>`;
}
function pager(prev, next, nextLabel, extra = "") {
  const P = L();
  return `<div class="pager">${prev ? `<a class="btn" href="#step-${prev}">← ${P.steps[prev - 1]}</a>` : ""}` +
    `<div class="end">${extra}${next ? `<a class="btn primary" href="#step-${next}" ${next === 6 ? 'data-autorun="1"' : ""}>${nextLabel} →</a>` : ""}</div></div>`;
}
function intro(n, kicker, title, lede) {
  return `<div class="intro"><p class="kicker">${L().stepOf(n)} · ${kicker}</p><h2 id="h${n}s" tabindex="-1">${title}</h2>${lede ? `<p class="lede">${lede}</p>` : ""}</div>`;
}
const listDesc = (i) => (defaultNames() && K() === 3 ? L().lists[i].short : L().listGeneric(S.names[i]));

// ---------- steps ----------
function step1() {
  const P = L().s1;
  const cards = [0, 1, 2].map((i) => { const d = L().lists[i]; return `<div class="card"><p class="t">${L().listWord} ${"ABC"[i]} · ${d.short}</p><p class="prose">${d.long}</p><p class="src">${d.example}</p></div>`; }).join("");
  return intro(1, P.kicker, P.title, P.lede) + `<div class="cards">${cards}</div>` +
    `<div class="wash"><svg width="320" height="220" viewBox="0 0 320 220" role="img" aria-label="${esc(P.svgAria)}" style="max-width:100%;height:auto">
<circle cx="120" cy="90" r="70" style="fill:var(--chart-cat-1);fill-opacity:.18;stroke:var(--chart-cat-1);stroke-width:2"></circle>
<circle cx="200" cy="90" r="70" style="fill:var(--accent-quiet);fill-opacity:.18;stroke:var(--accent-quiet);stroke-width:2"></circle>
<circle cx="160" cy="150" r="60" style="fill:var(--text);fill-opacity:.08;stroke:var(--text);stroke-width:2"></circle>
<g style="fill:var(--text);font-family:var(--font-display);font-weight:700" font-size="16"><text x="80" y="60">A</text><text x="232" y="60">B</text><text x="156" y="196">C</text></g>
<g style="fill:none;stroke:var(--text)" stroke-dasharray="2 2"><circle cx="20" cy="200" r="5"></circle><circle cx="40" cy="185" r="5"></circle><circle cx="295" cy="195" r="5"></circle><circle cx="300" cy="20" r="5"></circle><circle cx="20" cy="25" r="5"></circle></g></svg>
<div><p class="t">${P.dotTitle}</p><p class="prose">${P.dot1}</p><p class="prose">${P.dot2}</p></div></div>` +
    `<details class="more"><summary>${P.nameQ}</summary><p class="prose">${P.nameA}</p></details>` +
    pager(0, 2, P.next);
}

function step2() {
  const P = L().s2;
  const i = SUBS.indexOf(S.sub);
  const tabs = SUBS.map((s, j) => `<li><button type="button" data-sub="${s}" ${s === S.sub ? 'aria-current="step"' : ""}>${P.subs[j]}</button></li>`).join("");
  const D = P.d[S.sub];
  const prev = i > 0 ? `<a class="btn" href="#step-2${SUBS[i - 1]}">← ${P.subs[i - 1]}</a>` : `<a class="btn" href="#step-1">← ${L().steps[0]}</a>`;
  const next = i < 4 ? `<a class="btn primary" href="#step-2${SUBS[i + 1]}">${P.subs[i + 1]} →</a>` : `<a class="btn primary" href="#step-3">${P.next} →</a>`;
  return intro(2, P.kicker, P.title, P.lede) +
    `<div class="panel"><nav aria-label="${esc(P.subNav)}"><ol class="substeps">${tabs}</ol></nav>` +
    `<h3 id="sub2" tabindex="-1">${P.subs[i]}</h3>${D}` +
    `<div class="pager">${prev}<div class="end">${next}</div></div></div>`;
}

function step3() {
  const P = L().s3;
  const rows = orderedPatterns().map((h) => `<tr><td class="pat">${h}</td><td>${P.plain(h, S.names)}</td>` +
    `<td class="num"><label><span class="lbl">${P.short(h, S.names)}</span><input type="number" min="0" step="1" inputmode="numeric" data-h="${h}" value="${c(h)}" aria-label="${esc(P.inputAria(h, S.names))}"></label></td></tr>`).join("");
  const zero = "0".repeat(K());
  const presets = [["ex3", P.ex3], ["ex2", P.ex2], ["paste", P.paste]]
    .map(([id, lab]) => `<button type="button" class="btn" data-preset="${id}" aria-pressed="${S.preset === id}">${lab}</button>`).join("");
  return intro(3, P.kicker, P.title, P.lede(K())) +
    `<div class="row" role="group" aria-label="${esc(P.start)}"><span>${P.start}</span>${presets}</div>` +
    `<div id="pasteBox" class="panel" ${S.preset === "paste" ? "" : "hidden"}>` +
    `<label for="paste"><b>${P.pasteTitle}</b></label><p class="muted">${P.pasteHelp}</p><textarea id="paste" spellcheck="false"></textarea>` +
    `<div class="row"><button type="button" class="btn" id="usePaste">${P.usePaste}</button></div>` +
    `<label for="file"><b>${P.uploadTitle}</b></label><p class="muted">${P.uploadHelp}</p><input type="file" id="file" accept=".csv,text/csv"></div>` +
    `<p id="inputMsg" class="muted" aria-live="polite">${S.msgErr ? `<span class="err">${esc(S.msg)}</span>` : esc(S.msg)}</p>` +
    `<div class="split"><div class="panel scroll counts"><table><thead><tr><th>${P.pattern}</th><th>${P.words}</th><th class="num">${P.people}</th></tr></thead>` +
    `<tbody>${rows}<tr><td class="pat">${zero}</td><td><strong>${P.none}</strong></td><td class="num">?</td></tr>` +
    `<tr><td></td><td>${P.known}</td><td class="num" id="known">${fmt(nObs())}</td></tr></tbody></table></div>` +
    `<div class="vis" id="venn">${venn()}<div class="info"><p class="t">${P.readTitle}</p><p class="prose">${P.read}</p></div></div></div>` +
    pager(2, 4, P.next);
}

function step4() {
  const P = L().s4;
  const sizes = [0, 1].map(listSize), m = overlapOf(0, 1);
  const terms = (i) => orderedPatterns().filter((h) => h[i] === "1").map(c).map((v) => fmt(v)).join(" + ");
  const both = orderedPatterns().filter((h) => h[0] === "1" && h[1] === "1").map((h) => fmt(c(h))).join(" + ");
  const [A, B] = [lname(0), lname(1)];
  let body;
  if (m === 0 || sizes[1] === 0) body = `<div class="note"><p class="t">${P.zeroT}</p><p class="prose">${P.zero}</p></div>`;
  else {
    const share = m / sizes[1], N = sizes[0] * sizes[1] / m, ch = chapman({ "11": m, "10": sizes[0] - m, "01": sizes[1] - m });
    const max = Math.max(1, Math.min(sizes[0], sizes[1]));
    const ov = Math.min(Math.max(1, S.overlap ?? m), max);
    body = `<div class="moves">
<div class="panel"><p class="kicker">${P.m1}</p><p class="big">${A} = ${fmt(sizes[0])}</p><p class="small">${terms(0)} ${P.m1a(A)}</p><p class="big">${B} = ${fmt(sizes[1])}</p><p class="small">${terms(1)}</p></div>
<div class="panel"><p class="kicker">${P.m2}</p><p class="big">${P.and(A, B)} = ${fmt(m)}</p><p class="small">${both}</p><p class="prose">${P.m2a(B, fmt(sizes[1]), fmt(m), A, pct(share))}</p></div>
<div class="panel"><p class="kicker">${P.m3}</p><p class="prose">${P.m3a(A, pct(share), fmt(sizes[0]), fmt(share, 2))}</p><p class="big" id="lpN">N ≈ ${fmt(N)}</p><p class="small">${fmt(sizes[0])} × ${fmt(sizes[1])} ÷ ${fmt(m)} = ${fmt(N, 1)}</p></div></div>
<div class="wash"><div><p class="t">${P.tryT}</p><p class="prose">${P.try}</p></div>
<div><label for="ov"><b>${P.and(A, B)}</b></label><input id="ov" type="range" min="1" max="${max}" value="${ov}" aria-valuetext="${esc(readout(ov, sizes))}"><p class="mono" id="ovOut" aria-live="polite">${readout(ov, sizes)}</p>
${ov !== m ? `<button type="button" class="btn" id="ovReset">${P.reset(fmt(m))}</button>` : ""}</div></div>
<p class="muted">${P.chapman(fmt(ch.N.median))}</p>`;
  }
  const catchT = K() === 3 ? P.catch3 : P.catch2;
  return intro(4, P.kicker, K() === 3 ? P.title(A, B) : P.title2(A, B), K() === 3 ? P.lede(lname(2)) : P.lede2) + body +
    `<div class="note"><p class="t">${P.catchT}</p><p class="prose">${P.catchBody(A, B)} ${catchT}</p></div>` +
    pager(3, 5, K() === 3 ? P.next : P.next2);
}
function readout(ov, sizes) {
  const N = sizes[0] * sizes[1] / ov, miss = N - (sizes[0] + sizes[1] - ov);
  return L().s4.readout(fmt(ov), fmt(N), fmt(Math.max(0, miss)));
}

function liveModels() {
  return modelSpecs().map((s) => ({ ...s, fit: fitMLE(s.pairs) }));
}
function engineFor(k) { return S.run.key === key() && S.run.result && S.run.result.models ? S.run.result.models.find((m) => m.name === k) : null; }
function modelTitle(pairs) {
  const P = L().s5;
  if (!pairs.length) return P.noLinks;
  if (pairs.length === 3) return P.allLinks;
  return P.linked(pairs.map(([i, j]) => `${lname(i)}–${lname(j)}`));
}

function step5() {
  const P = L().s5;
  if (K() === 2) {
    return intro(5, P.kicker, P.title2, P.lede2) + `<div class="info"><p class="prose">${P.two}</p></div>` +
      pager(4, 6, P.next2);
  }
  const rows = PAIRS.map(([i, j]) => {
    const a = listSize(i), b = listSize(j), m = overlapOf(i, j);
    return { i, j, a, b, m, N: m > 0 ? a * b / m : null };
  });
  const Ns = rows.map((r) => r.N).filter((x) => x != null);
  let verdict = P.cantJudge;
  if (Ns.length === 3) {
    const spread = Math.max(...Ns) / Math.min(...Ns);
    if (spread < 1.15) verdict = P.agree;
    else {
      const med = [...Ns].sort((x, y) => x - y)[1];
      const odd = rows.reduce((o, r) => (Math.abs(Math.log(r.N / med)) > Math.abs(Math.log(o.N / med)) ? r : o));
      verdict = P.disagree(`${lname(odd.i)}–${lname(odd.j)}`);
    }
  }
  const table = rows.map((r) => `<tr><td>${P.and(lname(r.i), lname(r.j))}</td><td class="num">${fmt(r.a)} × ${fmt(r.b)}</td><td class="num">${fmt(r.m)}</td><td class="num" data-pairN="${r.i}${r.j}">${r.N == null ? "—" : fmt(r.N)}</td></tr>`).join("");
  const models = liveModels();
  const card = (md) => {
    const e = engineFor(md.name);
    return `<div class="card"><p class="t">${modelTitle(md.pairs)}</p><p class="prose">${md.pairs.length ? P.linkDesc(md.pairs.map(([i, j]) => [lname(i), lname(j)])) : P.indepDesc}</p>` +
      `<p class="small">${P.totalLbl} <b data-model="${esc(md.name)}">${md.fit ? fmt(md.fit.N) : "—"}</b> · ${P.weightLbl} <b>${e ? pct(e.weight) : P.weightLater}</b></p></div>`;
  };
  const shown = S.showAll ? models : models.slice(0, 3);
  return intro(5, P.kicker, P.title, P.lede) +
    `<div class="panel scroll"><table><thead><tr><th>${P.pair}</th><th class="num">${P.sizes}</th><th class="num">${P.overlap}</th><th class="num">${P.total}</th></tr></thead><tbody>${table}</tbody></table></div>` +
    `<p class="prose" id="pairVerdict">${verdict} ${P.pairsWaste}</p>` +
    `<div class="panel"><h3>${P.modelT}</h3><p class="prose">${P.model}</p><div class="models" id="modelCards">${shown.map(card).join("")}` +
    (S.showAll ? "" : `<div class="card"><p class="t">${P.more}</p><p class="prose">${P.moreDesc(lname(1), lname(2))}</p><button type="button" class="btn" id="showAll" aria-expanded="false">${P.showAll}</button></div>`) +
    `</div><p class="muted">${P.liveNote}</p></div>` +
    `<div class="info"><p class="t">${P.avgT}</p><p class="prose">${P.avg}</p>` +
    `<details class="more"><summary>${P.statT}</summary><p class="prose mono" style="white-space:normal">${P.stat}</p><p class="prose">${P.stat2}</p></details></div>` +
    pager(4, 6, P.next);
}

function predicted(r) {
  const fits = Object.fromEntries(liveModels().map((m) => [m.name, m.fit]));
  const out = {};
  for (const h of patterns()) {
    let s = 0, w = 0;
    for (const m of r.models) if (fits[m.name]) { s += m.weight * fits[m.name].fitted[h]; w += m.weight; }
    out[h] = w > 0 ? s / w : null;
  }
  return out;
}

function step6() {
  const P = L().s6;
  const r = S.run.key === key() ? S.run.result : null;
  let body = "";
  const running = S.run.status === "running";
  const runRow = `<div class="row"><button type="button" class="btn primary" id="run" ${running ? "disabled" : ""}>${r ? P.rerun : P.run}</button>` +
    `<button type="button" class="btn" id="cancel" ${running ? "" : "hidden"}>${P.cancel}</button></div>` +
    `<div id="progressBox" ${running ? "" : "hidden"}><progress id="prog" max="100" ${S.run.frac == null ? "" : `value="${100 * S.run.frac}"`}></progress><p id="progMsg" class="muted" aria-live="polite">${esc(S.run.progress)}</p></div>` +
    (S.run.status === "error" ? `<p class="err">${esc(S.run.error)}</p>` : "") +
    (S.run.status === "cancelled" ? `<p class="muted">${P.cancelled}</p>` : "") +
    (S.run.result && S.run.key !== key() && !running ? `<p class="muted">${P.stale}</p>` : "");
  if (!r) {
    body = `<div class="panel"><p class="prose">${K() === 3 ? P.before3 : P.before2}</p>${runRow}<p class="muted">${P.privacy}</p></div>`;
    return intro(6, P.kicker, P.title, "") + body + pager(5, 0, "");
  }
  if (r.undefinedEstimate) {
    return intro(6, P.kicker, P.title, "") + `<div class="note"><p class="prose">${P.noOverlap}</p></div>` + runRow + pager(5, 0, "");
  }
  const n = r.n, { median: N, lower, upper } = r.N, M = N - n;
  const comp = [...Array(K()).keys()].map((i) => `<div class="bar"><span>${lname(i)} · ${fmt(listSize(i))} ${P.of} ${fmt(N)}</span><div class="track"><div class="fill" style="width:${Math.min(100, 100 * listSize(i) / N)}%"></div></div><span class="val">${pct(listSize(i) / N)}</span></div>`).join("");
  let modelsBox, fitBox;
  if (r.models) {
    const maxW = Math.max(...r.models.map((m) => m.weight));
    const sorted = [...r.models].sort((a, b) => b.weight - a.weight);
    const specs = Object.fromEntries(modelSpecs().map((s) => [s.name, s.pairs]));
    modelsBox = `<div class="bars">${sorted.map((m) => `<div class="bar"><span>${specs[m.name] ? modelTitle(specs[m.name]) : esc(m.name)}</span><div class="track"><div class="fill" style="width:${100 * m.weight / maxW}%"></div></div><span class="val">${pct(m.weight)}</span></div>`).join("")}</div>` +
      `<details class="more"><summary>${P.modelDetail}</summary><div class="scroll"><table><thead><tr><th>${P.model}</th><th class="num">${P.weight}</th><th class="num">${P.total} (95 %)</th><th class="num">${P.khat}</th></tr></thead><tbody>` +
      sorted.map((m) => `<tr><td>${specs[m.name] ? modelTitle(specs[m.name]) : esc(m.name)}</td><td class="num">${pct(m.weight, 1)}</td><td class="num">${fmt(m.N.median)} (${fmt(m.N.lower)}–${fmt(m.N.upper)})</td><td class="num">${fmt(m.khat, 2)} ${m.khat < 0.5 ? `<span class="tag good">${P.kGood}</span>` : m.khat <= 0.7 ? `<span class="tag">${P.kOk}</span>` : `<span class="tag warn">${P.kBad}</span>`}</td></tr>`).join("") +
      `</tbody></table></div><p class="muted">${P.kExplain}</p><p class="muted">${P.method(r.draws)}</p></details>`;
    const pr = predicted(r);
    const res = orderedPatterns().map((h) => ({ h, o: c(h), e: pr[h], z: pr[h] ? (c(h) - pr[h]) / Math.sqrt(pr[h]) : 0 }));
    const worst = res.reduce((a, b) => (Math.abs(b.z) > Math.abs(a.z) ? b : a));
    r.fit = res;
    fitBox = `<div class="scroll"><table><thead><tr><th>${P.pattern}</th><th class="num">${P.obs}</th><th class="num">${P.pred}</th><th></th></tr></thead><tbody>` +
      res.map((x) => `<tr><td class="pat">${x.h}</td><td class="num">${fmt(x.o)}</td><td class="num">${x.e == null ? "—" : fmt(x.e, 1)}</td><td>${Math.abs(x.z) > 2 ? `<span class="tag warn">${P.check}</span>` : ""}</td></tr>`).join("") +
      `</tbody></table></div><p class="prose"><b>${Math.abs(worst.z) > 2 ? P.fitBad(worst.h) : P.fitGood}</b></p><p class="muted">${P.fitNote}</p>`;
  } else {
    modelsBox = `<p class="prose">${P.twoModels}</p><p class="muted">${P.twoMethod}</p>`;
    fitBox = `<p class="prose">${P.twoFit}</p>`;
  }
  const assume = P.assume.map(([b, t2]) => `<li><strong>${b}</strong> ${t2}</li>`).join("");
  body = `<div class="hero-num"><div class="answer"><p class="l">${P.totalBig}</p><p class="v" id="resN">${fmt(N)}</p><p class="l" id="resCI">${P.ci(fmt(lower), fmt(upper))}</p></div>` +
    `<div class="panel"><div class="stack" role="img" aria-label="${esc(P.stackAria(fmt(n), fmt(M)))}"><div class="k" style="flex:${n}">${P.known(fmt(n))}</div><div class="m" style="flex:${Math.max(M, 0.02 * n)}">${P.missed(fmt(M))}</div></div>` +
    `<p class="prose">${P.summary(fmt(n), fmt(M), pct(n / N), K(), fmt(lower - n), fmt(upper - n))}</p></div></div>` +
    (K() === 2 ? `<div class="note"><p class="prose">${P.twoWarn}</p></div>` : "") +
    `<div class="grid3"><div class="panel"><h3>${P.compT}</h3><div class="bars">${comp}</div><p class="muted">${P.compNote}</p></div>` +
    `<div class="panel"><h3>${P.weightsT}</h3>${modelsBox}</div><div class="panel"><h3>${P.fitT}</h3>${fitBox}</div></div>` +
    `<div class="note"><p class="t">${P.assumeT}</p><ul class="prose" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">${assume}</ul></div>` +
    runRow +
    `<div class="pager"><a class="btn" href="#step-3">← ${P.change}</a><div class="end"><button type="button" class="btn primary" id="csv">${P.csv}</button><a class="btn" href="../resultados/">${P.real} →</a></div></div>`;
  return intro(6, P.kicker, P.title, "") + body;
}

// ---------- engine ----------
function startRun() {
  const k = key();
  S.run.error = null;
  if (K() === 2) {
    Object.assign(S.run, { status: "done", key: k, result: chapman(S.counts) });
    render();
    return;
  }
  const n = nObs();
  if (n === 0) { Object.assign(S.run, { status: "error", error: L().err.empty }); render(); return; }
  const csv = [S.names.join(",") + ",freq", ...patterns().filter((h) => c(h) > 0).map((h) => [...h, c(h)].join(","))].join("\n");
  Object.assign(S.run, { status: "running", progress: L().s6.stage.load, frac: null });
  render();
  if (!worker) worker = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
  const prog = (msg, frac) => {
    S.run.progress = msg; S.run.frac = frac;
    if ($("progMsg")) { $("progMsg").textContent = msg; if (frac == null) $("prog").removeAttribute("value"); else $("prog").value = 100 * frac; }
  };
  const specs = Object.fromEntries(modelSpecs().map((s) => [s.name, s.pairs]));
  worker.onmessage = ({ data: m }) => {
    const P = L().s6;
    if (m.type === "stage") prog(P.stage[m.stage], null);
    if (m.type === "model") prog(P.fitting(m.model, m.of, specs[m.name] ? modelTitle(specs[m.name]).replace(/<[^>]+>/g, "") : m.name), (m.model - 1) / m.of);
    if (m.type === "done") {
      Object.assign(S.run, { status: "done", key: k, result: { n, N: m.result.bma_N, models: m.result.models, draws: m.result.draws, method: "bma", seconds: m.result.seconds } });
      render();
    }
    if (m.type === "error") { Object.assign(S.run, { status: "error", error: m.error }); render(); }
  };
  worker.onerror = (e) => { Object.assign(S.run, { status: "error", error: String(e.message || e) }); render(); };
  worker.postMessage({ type: "run", csv });
}
function cancelRun() {
  if (worker) worker.terminate();
  worker = null;
  S.run.status = "cancelled";
  render();
}
function downloadCsv() {
  const r = S.run.result;
  if (!r || r.undefinedEstimate) return;
  const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = [["section", "item", "value", "lower_95", "upper_95"]];
  rows.push(["input", "lists", S.names.join(" "), "", ""]);
  for (const h of orderedPatterns()) rows.push(["input", `pattern_${h}`, c(h), "", ""]);
  rows.push(["estimate", "method", r.method === "bma" ? "bayesian_model_averaging_8_loglinear_models" : "chapman_two_lists", "", ""]);
  rows.push(["estimate", "observed", r.n, "", ""]);
  rows.push(["estimate", "total_N", r.N.median.toFixed(1), r.N.lower.toFixed(1), r.N.upper.toFixed(1)]);
  rows.push(["estimate", "missed_by_all_lists", (r.N.median - r.n).toFixed(1), (r.N.lower - r.n).toFixed(1), (r.N.upper - r.n).toFixed(1)]);
  rows.push(["estimate", "completeness_all_lists", (r.n / r.N.median).toFixed(4), (r.n / r.N.upper).toFixed(4), (r.n / r.N.lower).toFixed(4)]);
  S.names.forEach((nm, i) => rows.push(["completeness", nm, (listSize(i) / r.N.median).toFixed(4), (listSize(i) / r.N.upper).toFixed(4), (listSize(i) / r.N.lower).toFixed(4)]));
  for (const m of r.models || []) {
    rows.push(["model_total_N", m.name, m.N.median.toFixed(1), m.N.lower.toFixed(1), m.N.upper.toFixed(1)]);
    rows.push(["model_weight", m.name, m.weight.toFixed(4), "", ""]);
    rows.push(["model_pareto_k", m.name, m.khat.toFixed(3), "", ""]);
  }
  for (const x of r.fit || []) rows.push(["fit_predicted", `pattern_${x.h}`, x.e == null ? "" : x.e.toFixed(2), "", ""]);
  const blob = new Blob([rows.map((r2) => r2.map(q).join(",")).join("\n") + "\n"], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "step-t1d-capture-recapture.csv";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- routing and rendering ----------
const RENDER = { 1: step1, 2: step2, 3: step3, 4: step4, 5: step5, 6: step6 };
function renderStepper() {
  $("stepper").innerHTML = L().steps.map((s, i) => {
    const n = i + 1, cur = n === S.step;
    return `<li><a href="#step-${n}" ${cur ? 'aria-current="step"' : ""} class="${n < S.step ? "done" : ""}">${n < S.step ? "✓ " : ""}${n} · ${s}</a></li>`;
  }).join("");
}
function render(focus) {
  renderStepper();
  for (let n = 1; n <= 6; n++) {
    const sec = $(`s${n}`);
    sec.hidden = n !== S.step;
    sec.innerHTML = n === S.step ? RENDER[n]() : "";
  }
  if (focus) {
    const h = $(focus);
    if (h) h.focus({ preventScroll: true });
  }
}
function applyLang() {
  const P = L();
  document.documentElement.lang = S.lang;
  for (const el of document.querySelectorAll("[data-t]")) el.textContent = P[el.dataset.t];
  for (const b of document.querySelectorAll(".lang button")) b.setAttribute("aria-current", String(b.dataset.lang === S.lang));
  $("stepperNav").setAttribute("aria-label", P.stepsNav);
  document.title = P.title + " · STEP-T1D";
  if (window.__logos) {
    $("logoLight").innerHTML = window.__logos[S.lang === "es" ? "reverse_es" : "reverse"];
    $("logoDark").innerHTML = window.__logos[S.lang === "es" ? "primary_es" : "primary"];
  }
  render();
}
function route(focus = true) {
  const m = /^#step-([1-6])([a-e])?$/.exec(location.hash);
  const step = m ? Number(m[1]) : 1;
  const changed = step !== S.step;
  S.step = step;
  if (step === 2 && m && m[2]) S.sub = m[2];
  render(focus ? (step === 2 && m && m[2] && !changed ? "sub2" : `h${step}s`) : null);
  if (focus && changed) window.scrollTo(0, 0);
}

// ---------- events (delegated) ----------
document.addEventListener("click", (ev) => {
  const t = ev.target.closest("button, a");
  if (!t) return;
  if (t.matches(".lang button")) { S.lang = t.dataset.lang; store.set("stept1d-lang", S.lang); applyLang(); return; }
  if (t.dataset.sub) { location.hash = `#step-2${t.dataset.sub}`; return; }
  if (t.dataset.autorun && !(S.run.key === key() && S.run.result) && S.run.status !== "running") setTimeout(startRun, 0);
  if (t.dataset.preset) {
    const p = t.dataset.preset;
    S.msg = ""; S.msgErr = false;
    if (p === "paste") S.preset = "paste";
    else { const e = EXAMPLES[p === "ex2" ? 2 : 3]; setTable([...e.names], e.counts, p); }
    render();
    if (p === "paste" && $("paste")) $("paste").focus();
    return;
  }
  if (t.id === "usePaste") {
    try { const { lists, counts } = fromFrequencyCsv($("paste").value); setTable(lists, counts, "paste"); S.msg = L().loaded(nObs(), K()); S.msgErr = false; }
    catch (e) { S.msg = L().err.parse + e.message; S.msgErr = true; }
    render("inputMsg");
    return;
  }
  if (t.id === "ovReset") { S.overlap = null; render("ov"); return; }
  if (t.id === "showAll") { S.showAll = true; render("modelCards"); return; }
  if (t.id === "run") { startRun(); return; }
  if (t.id === "cancel") { cancelRun(); return; }
  if (t.id === "csv") downloadCsv();
});
document.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t.dataset && t.dataset.h) {
    const v = t.value.trim() === "" ? 0 : Number(t.value);
    const ok = Number.isInteger(v) && v >= 0;
    t.setAttribute("aria-invalid", String(!ok));
    if (ok) S.counts[t.dataset.h] = v;
    S.overlap = null;
    if (S.preset !== "paste") S.preset = "custom";
    for (const b of document.querySelectorAll("[data-preset]")) b.setAttribute("aria-pressed", String(b.dataset.preset === S.preset));
    $("known").textContent = fmt(nObs());
    $("venn").querySelector("svg").outerHTML = venn();
    $("inputMsg").innerHTML = ok ? "" : `<span class="err">${esc(L().err.bad)}</span>`;
  }
  if (t.id === "ov") {
    S.overlap = Number(t.value);
    const sizes = [0, 1].map(listSize);
    $("ovOut").textContent = readout(S.overlap, sizes);
    t.setAttribute("aria-valuetext", readout(S.overlap, sizes));
  }
});
document.addEventListener("change", async (ev) => {
  if (ev.target.id !== "file") return;
  const f = ev.target.files[0];
  if (!f) return;
  try {
    const r = fromIndividualCsv(await f.text());
    setTable(r.lists, r.counts, "paste");
    S.msg = L().loaded(r.n, r.lists.length) + (r.ignored.length ? L().ignored(r.ignored.join(", ")) : "") + (r.zero ? L().zeroRows(r.zero) : "");
    S.msgErr = false;
  } catch (e) { S.msg = L().err.parse + e.message; S.msgErr = true; }
  render("inputMsg");
});
window.addEventListener("hashchange", () => route(true));
fetch("./logos.json").then((r) => r.json()).then((l) => { window.__logos = l; applyLang(); }).catch(() => {});
S.step = 0;
document.documentElement.lang = S.lang;
applyLang();
route(false);
