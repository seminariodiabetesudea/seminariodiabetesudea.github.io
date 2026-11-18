// Web Worker: loads Pyodide and the engine from this site's own vendor/ folder, then fits the 8
// three-list models (py/calc.py).  Nothing is fetched from another origin; the data stay in this worker.
// In:  {type: "run", csv}
// Out: {type: "stage", stage} | {type: "model", model, of, name} | {type: "done", result} | {type: "error", error}
import { loadPyodide } from "./vendor/pyodide/pyodide.mjs";

const here = (p) => new URL(p, import.meta.url).href;
const LOCK_PACKAGES = ["numpy", "scipy", "pandas", "packaging", "typing-extensions", "setuptools", "pygments",
                       "rich", "cloudpickle", "lazy-loader", "threadpoolctl"];
let ready = null;

async function boot() {
  self.postMessage({ type: "stage", stage: "load" });
  const py = await loadPyodide({ indexURL: here("./vendor/pyodide/"), env: { PYTENSOR_FLAGS: "cxx=" },
                                 stdin: () => null });
  self.postMessage({ type: "stage", stage: "install" });
  const wheels = await (await fetch(here("./wheels.json"))).json();
  await py.loadPackage([...LOCK_PACKAGES, ...wheels.map((w) => here(`./vendor/wheels/${w}`))],
                       { messageCallback: () => {} });
  for (const f of ["spike_common.py", "laplace_is.py", "calc.py"]) {
    py.FS.writeFile(`/home/pyodide/${f}`, await (await fetch(here(`./py/${f}`))).text());
  }
  self.postMessage({ type: "stage", stage: "import" });
  await py.runPythonAsync(`
import sys, logging, warnings
sys.path.insert(0, "/home/pyodide")
warnings.filterwarnings("ignore")
import calc, laplace_is
laplace_is.configure_pytensor()
for _n in ("pymc", "pytensor"):
    logging.getLogger(_n).setLevel(logging.ERROR)
`);
  return py;
}

self.onmessage = async (ev) => {
  try {
    ready = ready || boot();
    const py = await ready;
    self.postMessage({ type: "stage", stage: "fit" });
    py.globals.set("csv_text", ev.data.csv);
    py.globals.set("progress_callback", (m) => self.postMessage({ type: "model", ...JSON.parse(m) }));
    const out = await py.runPythonAsync("calc.run_json(csv_text, '{}', log=progress_callback)");
    self.postMessage({ type: "done", result: JSON.parse(out) });
  } catch (e) {
    self.postMessage({ type: "error", error: String(e && e.message ? e.message : e) });
  }
};
