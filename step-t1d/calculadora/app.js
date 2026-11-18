// The calculator page: input table, two-list Chapman estimate (here, in JavaScript), three-list model
// averaging (worker.mjs, Pyodide).  No data leaves the browser: nothing is sent anywhere.
const T = {
  en: {
    eyebrow: "STEP-T1D · tools", title: "Capture-recapture calculator",
    lead: "Estimate how many people a set of overlapping lists missed. Everything runs in this browser; your data never leave this device.",
    badge: "Preliminary v0", inputTitle: "1. Your lists", nLists: "Number of lists",
    ex2: "Synthetic example, 2 lists", ex3: "Synthetic example, 3 lists",
    fourFive: "Four or five lists are not supported in this version.",
    history: "Seen on", count: "People", inList: "in", notIn: "not in",
    pasteTitle: "Paste a frequency table (CSV)",
    pasteHelp: "One column per list (0/1), then a column named freq. Example: A,B,C,freq then 1,1,1,24 …",
    usePaste: "Use pasted table", uploadTitle: "Upload one row per person (CSV)",
    uploadHelp: "A header row, then one row per person with a 0/1 column per list. Other columns are ignored. The file is read here and never uploaded.",
    run: "Estimate", cancel: "Cancel",
    privacy: "Privacy: the page fetches only its own files. Your table is processed in this browser tab and is not stored or sent.",
    resultsTitle: "2. Results", total: "Estimated total", hidden: "Not on any list", completeness: "Completeness of the lists",
    observed: "Observed", ci: "95% interval",
    stage: { load: "Loading the statistics engine (first time: about 40 MB, may take a minute)…", install: "Installing packages…",
             import: "Starting the engine…", fit: "Fitting models…" },
    fitting: (i, n, name) => `Fitting model ${i} of ${n} (${name})…`, cancelled: "Cancelled.",
    twoWarn: "With two lists the independence of the lists cannot be tested. If people on one list are more (or less) likely to be on the other, this estimate is biased, and the interval does not show it.",
    twoMethod: "Method: Chapman estimator, log-normal 95% interval (Chao), bounded below by the number observed.",
    noOverlap: "No one is on both lists: the two-list estimate is not defined.",
    threeMethod: (d) => `Method: the 8 log-linear models for three lists (every combination of pairwise dependences), each fitted by Laplace approximation and importance sampling (${d.toLocaleString("en")} draws), averaged by their marginal likelihood with equal prior weight.`,
    modelsTitle: "Models", model: "Model (pairwise dependences)", weight: "Weight", khat: "Pareto k", reliab: "Diagnostic",
    kGood: "reliable", kOk: "acceptable", kBad: "unreliable",
    kExplain: "Pareto k checks the importance-sampling step of each model: below 0.5 the result is reliable, 0.5–0.7 acceptable, above 0.7 that model's numbers should not be trusted.",
    indep: "independence",
    err: { empty: "Enter at least one count.", lists: "Use 2 or 3 lists (4–5 are not supported in v0).", parse: "Could not read the table: ", bad: "Counts must be whole numbers of zero or more." },
    loaded: (n, k) => `Loaded ${n.toLocaleString("en")} people on ${k} lists.`,
    ignored: (c) => ` Ignored columns: ${c}.`, zeroRows: (z) => ` ${z} rows on no list were dropped.`,
    assumeTitle: "3. Assumptions behind the estimate",
    assume: ["Closed population: no one enters or leaves the population during the period the lists cover.",
             "Correct linkage: the same person is recognised as the same across lists, and different people are not merged.",
             "List dependence: being on one list can change the chance of being on another. Three lists let the models adjust for pairwise dependence; two lists cannot.",
             "Heterogeneity: people differ in how likely they are to be listed (for example by age or severity). Unmodelled heterogeneity usually makes the estimate too low."],
    footer: "STEP-T1D · preliminary v0 calculator · examples are synthetic, not study data.",
  },
  es: {
    eyebrow: "STEP-T1D · herramientas", title: "Calculadora de captura-recaptura",
    lead: "Estime cuántas personas no aparecen en ninguna de varias listas que se superponen. Todo se calcula en este navegador; sus datos no salen de este dispositivo.",
    badge: "Versión preliminar v0", inputTitle: "1. Sus listas", nLists: "Número de listas",
    ex2: "Ejemplo sintético, 2 listas", ex3: "Ejemplo sintético, 3 listas",
    fourFive: "Esta versión no admite cuatro o cinco listas.",
    history: "Aparece en", count: "Personas", inList: "en", notIn: "no en",
    pasteTitle: "Pegar una tabla de frecuencias (CSV)",
    pasteHelp: "Una columna por lista (0/1) y luego una columna llamada freq. Ejemplo: A,B,C,freq y luego 1,1,1,24 …",
    usePaste: "Usar la tabla pegada", uploadTitle: "Cargar una fila por persona (CSV)",
    uploadHelp: "Una fila de encabezado y luego una fila por persona, con una columna 0/1 por lista. Las demás columnas se ignoran. El archivo se lee aquí y nunca se envía.",
    run: "Estimar", cancel: "Cancelar",
    privacy: "Privacidad: la página solo descarga sus propios archivos. Su tabla se procesa en esta pestaña del navegador; no se guarda ni se envía.",
    resultsTitle: "2. Resultados", total: "Total estimado", hidden: "En ninguna lista", completeness: "Completitud de las listas",
    observed: "Observadas", ci: "intervalo del 95 %",
    stage: { load: "Cargando el motor estadístico (la primera vez: unos 40 MB, puede tardar un minuto)…", install: "Instalando paquetes…",
             import: "Iniciando el motor…", fit: "Ajustando modelos…" },
    fitting: (i, n, name) => `Ajustando el modelo ${i} de ${n} (${name})…`, cancelled: "Cancelado.",
    twoWarn: "Con dos listas no se puede comprobar si las listas son independientes. Si estar en una lista hace más (o menos) probable estar en la otra, la estimación tiene sesgo y el intervalo no lo refleja.",
    twoMethod: "Método: estimador de Chapman, intervalo del 95 % log-normal (Chao), con el número observado como límite inferior.",
    noOverlap: "Nadie aparece en ambas listas: la estimación con dos listas no está definida.",
    threeMethod: (d) => `Método: los 8 modelos log-lineales para tres listas (todas las combinaciones de dependencias entre pares), cada uno ajustado con aproximación de Laplace y muestreo por importancia (${d.toLocaleString("es-CO")} muestras), promediados según su verosimilitud marginal con igual peso a priori.`,
    modelsTitle: "Modelos", model: "Modelo (dependencias entre pares)", weight: "Peso", khat: "k de Pareto", reliab: "Diagnóstico",
    kGood: "confiable", kOk: "aceptable", kBad: "no confiable",
    kExplain: "La k de Pareto revisa el paso de muestreo por importancia de cada modelo: por debajo de 0,5 el resultado es confiable, entre 0,5 y 0,7 aceptable, y por encima de 0,7 no se debe confiar en las cifras de ese modelo.",
    indep: "independencia",
    err: { empty: "Ingrese al menos un conteo.", lists: "Use 2 o 3 listas (v0 no admite 4 o 5).", parse: "No se pudo leer la tabla: ", bad: "Los conteos deben ser números enteros mayores o iguales a cero." },
    loaded: (n, k) => `Se cargaron ${n.toLocaleString("es-CO")} personas en ${k} listas.`,
    ignored: (c) => ` Columnas ignoradas: ${c}.`, zeroRows: (z) => ` Se descartaron ${z} filas sin ninguna lista.`,
    assumeTitle: "3. Supuestos de la estimación",
    assume: ["Población cerrada: nadie entra ni sale de la población durante el periodo que cubren las listas.",
             "Enlace correcto: la misma persona se reconoce como la misma en todas las listas, y no se unen personas distintas.",
             "Dependencia entre listas: estar en una lista puede cambiar la probabilidad de estar en otra. Con tres listas los modelos ajustan la dependencia entre pares; con dos no es posible.",
             "Heterogeneidad: las personas difieren en su probabilidad de quedar registradas (por ejemplo, por edad o gravedad). La heterogeneidad no modelada suele dar estimaciones demasiado bajas."],
    footer: "STEP-T1D · calculadora preliminar v0 · los ejemplos son sintéticos, no son datos del estudio.",
  },
};
const EXAMPLES = { 2: { names: ["A", "B"], counts: { "11": 105, "10": 161, "01": 153 } },
                   3: { names: ["A", "B", "C"], counts: { "111": 24, "110": 81, "101": 31, "100": 130, "011": 29, "010": 124, "001": 81 } } };
const $ = (id) => document.getElementById(id);
let lang = "es";
try { lang = localStorage.getItem("calc-lang") || ((navigator.language || "es").startsWith("en") ? "en" : "es"); } catch { /* storage blocked */ }
let names = ["A", "B", "C"];
let lastResult = null;
let worker = null;
const state = { status: "idle", result: null, error: null };
window.__calc = state;

const t = () => T[lang];
const fmt = (x, d = 0) => Number(x).toLocaleString(lang === "es" ? "es-CO" : "en", { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (x) => fmt(100 * x, 1) + " %";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function histories(k) {
  const out = [];
  for (let i = (1 << k) - 1; i >= 1; i--) out.push(i.toString(2).padStart(k, "0"));
  return out;
}

function renderGrid(counts = {}) {
  const k = names.length;
  const L = t();
  const head = `<tr>${names.map((n) => `<th>${esc(n)}</th>`).join("")}<th class="num">${L.count}</th></tr>`;
  const rows = histories(k).map((h) => `<tr>${[...h].map((b) => `<td>${b === "1" ? "✓" : "–"}</td>`).join("")}` +
    `<td class="num"><input type="number" min="0" step="1" inputmode="numeric" data-h="${h}" aria-label="${L.count} ${esc(h)}" value="${counts[h] ?? ""}"></td></tr>`).join("");
  $("grid").innerHTML = `<thead>${head}</thead><tbody>${rows}</tbody>`;
}

function readGrid() {
  const counts = {};
  for (const inp of $("grid").querySelectorAll("input")) {
    const v = inp.value.trim() === "" ? 0 : Number(inp.value);
    if (!Number.isInteger(v) || v < 0) throw new Error(t().err.bad);
    counts[inp.dataset.h] = v;
  }
  if (!Object.values(counts).some((v) => v > 0)) throw new Error(t().err.empty);
  return counts;
}

function setTable(newNames, counts) {
  if (newNames.length < 2 || newNames.length > 3) throw new Error(t().err.lists);
  names = newNames;
  $("nlists").value = String(names.length);
  renderGrid(counts);
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  const sep = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  return lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, "")));
}

function fromFrequencyCsv(text) {
  const rows = parseCsv(text);
  const head = rows[0];
  const fi = head.findIndex((h) => /^(freq|count|n)$/i.test(h));
  if (fi < 0) throw new Error("freq");
  const lists = head.filter((_, i) => i !== fi);
  const counts = {};
  for (const r of rows.slice(1)) {
    const h = lists.map((_, j) => r[head.indexOf(lists[j])]).join("");
    if (!/^[01]+$/.test(h)) throw new Error(r.join(","));
    const v = Number(r[fi]);
    if (!Number.isInteger(v) || v < 0) throw new Error(t().err.bad);
    if (h.includes("1")) counts[h] = (counts[h] || 0) + v;
  }
  return { lists, counts };
}

function fromIndividualCsv(text) {
  const rows = parseCsv(text);
  const head = rows[0];
  const body = rows.slice(1);
  const keep = head.map((_, i) => body.length > 0 && body.every((r) => r[i] === "0" || r[i] === "1"));
  const lists = head.filter((_, i) => keep[i]);
  const ignored = head.filter((_, i) => !keep[i]);
  const counts = {};
  let zero = 0;
  for (const r of body) {
    const h = head.map((_, i) => (keep[i] ? r[i] : "")).join("");
    if (!h.includes("1")) { zero++; continue; }
    counts[h] = (counts[h] || 0) + 1;
  }
  return { lists, counts, ignored, zero, n: body.length - zero };
}

// Two lists: Chapman, with Chao's log-normal interval for the unseen part (bounded below by n).
function chapman(c) {
  const m = c["11"] || 0, n1 = m + (c["10"] || 0), n2 = m + (c["01"] || 0), n = n1 + n2 - m;
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

function renderResults(r) {
  lastResult = r;
  const L = t();
  $("results").hidden = false;
  const notes = [];
  if (r.undefinedEstimate) {
    $("stats").innerHTML = "";
    $("notes").innerHTML = `<p class="warn">${L.noOverlap}</p>`;
    $("modelsBox").innerHTML = "";
    return;
  }
  const { median, lower, upper } = r.N;
  const stat = (v, l, sub) => `<div class="stat"><div class="v">${v}</div><div class="l"><b>${l}</b>${sub}</div></div>`;
  $("stats").innerHTML =
    stat(fmt(median), L.total, `${L.ci}: ${fmt(lower)} – ${fmt(upper)}`) +
    stat(fmt(median - r.n), L.hidden, `${L.ci}: ${fmt(lower - r.n)} – ${fmt(upper - r.n)}`) +
    stat(pct(r.n / median), L.completeness, `${L.ci}: ${pct(r.n / upper)} – ${pct(r.n / lower)}`) +
    stat(fmt(r.n), L.observed, "");
  if (r.method === "chapman") notes.push(`<p class="warn">${L.twoWarn}</p>`, `<p class="muted">${L.twoMethod}</p>`);
  else notes.push(`<p class="muted">${L.threeMethod(r.draws)}</p>`);
  $("notes").innerHTML = notes.join("");
  if (r.models) {
    const kw = (k) => (k < 0.5 ? L.kGood : k <= 0.7 ? L.kOk : L.kBad);
    const rows = r.models.map((m) => `<tr><td>${m.name === "independence" ? L.indep : esc(m.name)}</td>` +
      `<td class="num">${pct(m.weight)}</td><td class="num">${fmt(m.N.median)} (${fmt(m.N.lower)}–${fmt(m.N.upper)})</td>` +
      `<td class="num">${fmt(m.khat, 2)}</td><td>${kw(m.khat)}</td></tr>`).join("");
    $("modelsBox").innerHTML = `<h3>${L.modelsTitle}</h3><div class="scroll"><table><thead><tr><th>${L.model}</th>` +
      `<th class="num">${L.weight}</th><th class="num">${L.total}</th><th class="num">${L.khat}</th><th>${L.reliab}</th></tr></thead>` +
      `<tbody>${rows}</tbody></table></div><p class="muted">${L.kExplain}</p>`;
  } else $("modelsBox").innerHTML = "";
}

function busy(on) {
  $("run").disabled = on;
  $("cancel").hidden = !on;
  $("progressBox").hidden = !on;
}

function progress(msg, frac) {
  $("progMsg").textContent = msg;
  if (frac == null) $("prog").removeAttribute("value"); else $("prog").value = 100 * frac;
}

function run() {
  $("inputMsg").textContent = "";
  let counts;
  try { counts = readGrid(); } catch (e) { $("inputMsg").innerHTML = `<span class="err">${esc(e.message)}</span>`; return; }
  if (names.length === 2) {
    const r = chapman(counts);
    Object.assign(state, { status: "done", result: r });
    renderResults(r);
    return;
  }
  const csv = [names.join(",") + ",freq", ...Object.entries(counts).filter(([, v]) => v > 0).map(([h, v]) => [...h, v].join(","))].join("\n");
  const n = Object.values(counts).reduce((a, b) => a + b, 0);
  busy(true);
  state.status = "running";
  progress(t().stage.load, null);
  if (!worker) worker = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
  worker.onmessage = ({ data: m }) => {
    if (m.type === "stage") progress(t().stage[m.stage], null);
    if (m.type === "model") progress(t().fitting(m.model, m.of, m.name === "independence" ? t().indep : m.name), (m.model - 1) / m.of);
    if (m.type === "done") {
      busy(false);
      const r = { n, N: m.result.bma_N, models: m.result.models, draws: m.result.draws, method: "bma", seconds: m.result.seconds };
      Object.assign(state, { status: "done", result: r });
      renderResults(r);
    }
    if (m.type === "error") {
      busy(false);
      Object.assign(state, { status: "error", error: m.error });
      $("inputMsg").innerHTML = `<span class="err">${esc(m.error)}</span>`;
    }
  };
  worker.onerror = (e) => { busy(false); state.status = "error"; state.error = String(e.message || e); $("inputMsg").innerHTML = `<span class="err">${esc(state.error)}</span>`; };
  worker.postMessage({ type: "run", csv });
}

function cancel() {
  if (worker) worker.terminate();
  worker = null;
  busy(false);
  state.status = "cancelled";
  $("inputMsg").textContent = t().cancelled;
}

function applyLang() {
  const L = t();
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-t]")) el.textContent = L[el.dataset.t];
  for (const b of document.querySelectorAll(".lang button")) b.setAttribute("aria-current", String(b.dataset.lang === lang));
  $("assume").innerHTML = L.assume.map((a) => `<li>${esc(a)}</li>`).join("");
  document.title = L.title + " · STEP-T1D";
  if (window.__logos) {
    $("logoLight").innerHTML = window.__logos[lang === "es" ? "reverse_es" : "reverse"];
    $("logoDark").innerHTML = window.__logos[lang === "es" ? "primary_es" : "primary"];
  }
  let counts = {};
  try { counts = readGrid(); } catch { /* empty grid */ }
  renderGrid(counts);
  if (lastResult) renderResults(lastResult);
}

for (const b of document.querySelectorAll(".lang button")) b.addEventListener("click", () => {
  lang = b.dataset.lang;
  try { localStorage.setItem("calc-lang", lang); } catch { /* storage blocked */ }
  applyLang();
});
$("nlists").addEventListener("change", () => { names = ["A", "B", "C"].slice(0, Number($("nlists").value)); renderGrid(); });
for (const k of [2, 3]) $(`ex${k}`).addEventListener("click", () => { setTable(EXAMPLES[k].names, EXAMPLES[k].counts); $("inputMsg").textContent = ""; });
$("usePaste").addEventListener("click", () => {
  try { const { lists, counts } = fromFrequencyCsv($("paste").value); setTable(lists, counts); $("inputMsg").textContent = ""; }
  catch (e) { $("inputMsg").innerHTML = `<span class="err">${esc(t().err.parse + e.message)}</span>`; }
});
$("file").addEventListener("change", async () => {
  const f = $("file").files[0];
  if (!f) return;
  try {
    const r = fromIndividualCsv(await f.text());
    setTable(r.lists, r.counts);
    $("inputMsg").textContent = t().loaded(r.n, r.lists.length) + (r.ignored.length ? t().ignored(r.ignored.join(", ")) : "") + (r.zero ? t().zeroRows(r.zero) : "");
  } catch (e) { $("inputMsg").innerHTML = `<span class="err">${esc(t().err.parse + e.message)}</span>`; }
  $("file").value = "";
});
$("run").addEventListener("click", run);
$("cancel").addEventListener("click", cancel);
fetch("./logos.json").then((r) => r.json()).then((l) => { window.__logos = l; applyLang(); }).catch(() => {});
setTable(EXAMPLES[3].names, EXAMPLES[3].counts);
applyLang();
