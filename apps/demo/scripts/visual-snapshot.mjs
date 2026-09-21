#!/usr/bin/env node
/**
 * Deterministic visual regression harness for the painter convergence (E2).
 *
 * Renders a scenario battery in the built demo and captures, per scenario:
 * every .metric-stack's dataset attrs + full SVG markup, readout texts, and the
 * status line. Rendering is deterministic (seeded jitter, fixed viewport), so
 * exact string comparison is the diff.
 *
 *   node scripts/visual-snapshot.mjs --write    # capture/refresh baselines
 *   node scripts/visual-snapshot.mjs            # compare against baselines
 *
 * Baselines live in scripts/__visual_baselines__/ and are committed: a diff in
 * review = a rendering change that must be either a bug or an EXPLAINED intent.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..", "..");
const distHtml = path.join(root, "apps", "demo", "dist", "index.html");
const baseDir = path.join(__dirname, "__visual_baselines__");
const WRITE = process.argv.includes("--write");

function fail(msg) {
  console.error(`\nvisual-snapshot FAIL: ${msg}`);
  process.exit(1);
}

const pw = await import(
  pathToFileURL(path.join(root, "apps", "demo", "node_modules", "playwright", "index.mjs")).href
);
const browser = await pw.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

await page.goto(pathToFileURL(distHtml).href, { waitUntil: "domcontentloaded" });
await page.locator("#reloadBundledBtn").click();
await page.locator("#applyMappingBtn").click();
await page.waitForFunction(() => {
  const n = document.querySelector("#kpiShowing")?.textContent?.trim();
  return n && n !== "—" && !Number.isNaN(Number(n));
}, { timeout: 60000 });
await page.waitForSelector("#scatterPanels svg", { timeout: 30000 });

async function setCb(id, checked) {
  await page.evaluate(({ id, checked }) => {
    const el = document.getElementById(id);
    if (el && el.checked !== checked) {
      el.checked = checked;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, { id, checked });
}
async function setPreset(value) {
  await page.evaluate((v) => {
    const r = document.querySelector(`input[name="guidedPreset"][value="${v}"]`);
    if (r && !r.checked) {
      r.checked = true;
      r.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, value);
}
async function setSel(id, value) {
  await page.evaluate(({ id, value }) => {
    const el = document.getElementById(id);
    if (el && el.value !== value) {
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, { id, value });
}
async function setEndpoints(ids) {
  await page.locator('.nav-btn[data-rail="analysis"]').click();
  await page.evaluate((want) => {
    document.querySelectorAll("#endpointGroup input[type=checkbox]").forEach((inp) => {
      const w = want.includes(inp.value);
      if (inp.checked !== w) {
        inp.checked = w;
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  }, ids);
}
async function setMode(mode) {
  await page.locator('.nav-btn[data-rail="style"]').click();
  await page.evaluate((m) => {
    const r = document.querySelector(`input[name="layoutMode"][value="${m}"]`);
    if (r && !r.checked) {
      r.checked = true;
      r.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, mode);
}
async function setFacets(rows, cols) {
  await page.evaluate(({ rows, cols }) => {
    const apply = (id, want) => {
      const el = document.getElementById(id);
      for (const o of el.options) o.selected = want.includes(o.value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    apply("advancedRowFacets", rows);
    apply("advancedColFacets", cols);
    const all=[...document.getElementById("advancedRowFacets").options,...document.getElementById("advancedColFacets").options].map(o=>o.value);
    for(const w of [...rows,...cols]) if(!all.includes(w)) throw new Error("facet option not found: "+w);
  }, { rows, cols });
}
async function resetSelection() {
  await page.locator('.nav-btn[data-rail="analysis"]').click();
  await page.locator("#resetBtn").click();
}
async function clickRow(group) {
  const clicked = await page.evaluate((g) => {
    const el = [...document.querySelectorAll("g.er-ridge")].find(
      (r) => r.getAttribute("data-group") === g
    );
    if (!el) return false;
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  }, group);
  if (!clicked) fail(`row "${group}" not rendered`);
}
async function settle() {
  await page.locator('.nav-btn[data-rail="plot"]').click();
  await page.waitForTimeout(650);
}

async function capture() {
  return page.evaluate(() => {
    const stacks = [...document.querySelectorAll(".metric-stack")].map((s) => ({
      kind: s.dataset.stackKind ?? "",
      metric: s.dataset.metric ?? "",
      endpoint: s.dataset.endpoint ?? "",
      panelId: s.dataset.panelId ?? "",
      compareEndpoints: s.dataset.compareEndpoints ?? "",
      svg: [...s.querySelectorAll("svg")].map((v) => v.outerHTML).join("\n<!-- svg -->\n")
    }));
    const readouts = [...document.querySelectorAll(".readout")].map((r) => (r.textContent || "").trim());
    const status = document.getElementById("statusLine")?.textContent?.trim() ?? "";
    const titles = [...document.querySelectorAll(".panel-cell-title,.facet-row-label")].map(
      (t) => (t.textContent || "").trim()
    );
    return { titles, stacks, readouts, status };
  });
}

// ---- Scenario battery: everything E2 rewrites (compare painter) + regular-painter guards ----
const SCENARIOS = [
  {
    name: "s1-guided-compare-split-on",
    run: async () => {
      await setEndpoints(["icgi", "icgi2"]);
      await setMode("guided");
      await setPreset("overlay");
      await setCb("compareDistByEndpoint", true);
      await resetSelection();
      await settle();
    }
  },
  {
    name: "s2-guided-compare-split-off-pooled-click",
    run: async () => {
      await setCb("compareDistByEndpoint", false);
      await settle();
      await clickRow("2400 mg");
      await settle();
    }
  },
  {
    name: "s3-overlay-binary-plus-rescaled-linear",
    run: async () => {
      await setEndpoints(["icgi", "icgi7"]);
      await setMode("guided");
      await setPreset("overlay");
      await setCb("compareDistByEndpoint", false);
      await resetSelection();
      await settle();
    }
  },
  {
    name: "s4-advanced-overlay-crcl-facets-level-click",
    run: async () => {
      await setMode("advanced");
      await setSel("advancedColorBy", "endpoints");
      await setFacets([], ["var:crcl"]);
      await resetSelection();
      await settle();
      await clickRow("2400 mg");
      await settle();
    }
  },
  {
    name: "s5-regular-endpoint-rows-color-dose",
    run: async () => {
      await setEndpoints(["icgi", "brls"]);
      await setMode("advanced");
      await setFacets(["endpoints"], []);
      await setSel("advancedColorBy", "dose");
      await resetSelection();
      await settle();
    }
  },
  {
    name: "s6-regular-color-sex-fitsep-pooled-click",
    run: async () => {
      await setSel("advancedColorBy", "sex");
      await setSel("advancedGroupCurves", "sex");
      await settle();
      await clickRow("2400 mg");
      await settle();
    }
  },
  {
    // Strip rule P1 (E3): endpoint COLUMNS get one column-aligned strip each,
    // whose readout fits only that column's endpoint; grouping partitions the
    // pooled click per sex on both.
    name: "s7-endpoint-columns-per-column-strips-pooled-click",
    run: async () => {
      await setEndpoints(["icgi", "icgi7"]);
      await setMode("advanced");
      await setFacets([], ["endpoints"]);
      await setSel("advancedColorBy", "sex");
      await setSel("advancedGroupCurves", "sex");
      await resetSelection();
      await settle();
      await clickRow("2400 mg");
      await settle();
    }
  },
  {
    // Linetype channel (E5, the motivating case): facet+color=crcl (degenerate,
    // both curves wear the panel color) + group=sex + linetype=sex — dash is
    // what distinguishes the two sex curves inside each panel.
    name: "s8-linetype-sex-under-crcl-facet-color",
    run: async () => {
      await setEndpoints(["icgi"]);
      await setMode("advanced");
      await setFacets([], ["var:crcl"]);
      await setSel("advancedColorBy", "crcl");
      await setSel("advancedGroupCurves", "sex");
      await setSel("advancedLinetypeBy", "sex");
      await resetSelection();
      await settle();
    }
  },
  {
    // Callout density (E6) — default "Selected groups only" with NO selection:
    // split/bin callouts collapse to cohort level (pooled observed %/N; fitted
    // pill suppressed under split curves until a group is clicked).
    name: "s9-callout-density-selected-no-selection",
    run: async () => {
      await setEndpoints(["icgi"]);
      await setMode("advanced");
      await setFacets([], []);
      await setSel("advancedColorBy", "crcl");
      await setSel("advancedGroupCurves", "crcl");
      await setSel("advancedLinetypeBy", "endpoints");
      await page.locator('.nav-btn[data-rail="overlays"]').click();
      await page.evaluate(() => {
        const r = document.querySelector('input[name="refLine"][value="median"]');
        if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
      });
      await setCb("showObservedResp", true);
      await setCb("showReferenceFit", true);
      await page.evaluate(() => {
        const r = document.querySelector('input[name="calloutDensity"][value="selected"]');
        if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
      });
      await resetSelection();
      await settle();
    }
  },
  {
    // Callout density (E6) — "All groups": every group's callouts render.
    name: "s10-callout-density-all-no-selection",
    run: async () => {
      await page.locator('.nav-btn[data-rail="overlays"]').click();
      await page.evaluate(() => {
        const r = document.querySelector('input[name="calloutDensity"][value="all"]');
        if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
      });
      await settle();
    }
  },
  {
    // Level recoding (2026-08-28): race merged 2,3→"2+3", 4,5→"4+5", 99→(missing),
    // user order [2+3, 1, 4+5, ...] — recoded identity everywhere (color levels,
    // strips, gray missing) via the ONE level model.
    name: "s11-recode-race-merge-missing-order",
    run: async () => {
      await page.locator('.nav-btn[data-rail="overlays"]').click();
      await page.evaluate(() => {
        const r = document.querySelector('input[name="calloutDensity"][value="selected"]');
        if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
        const off = document.querySelector('input[name="refLine"][value="none"]');
        if (off && !off.checked) { off.checked = true; off.dispatchEvent(new Event("change", { bubbles: true })); }
      });
      await page.locator('.nav-btn[data-rail="data"]').click();
      await page.evaluate(() => {
        const el = document.getElementById("recodeVariableSelect");
        el.value = "race";
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      const setTarget = async (raw, target) => {
        await page.evaluate(({ raw, target }) => {
          const inp = [...document.querySelectorAll('#recodeEditor input[type=text]')].find((i) => i.placeholder === raw);
          inp.value = target;
          inp.dispatchEvent(new Event("change", { bubbles: true }));
        }, { raw, target });
        await page.waitForTimeout(250);
      };
      await setTarget("2", "2+3");
      await setTarget("3", "2+3");
      await setTarget("4", "4+5");
      await setTarget("5", "4+5");
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll("#recodeEditor > div > div")];
        const row = rows.find((r) => r.querySelector("span")?.title === "99");
        row.querySelector("button").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await page.waitForTimeout(400);
      await setSel("advancedColorBy", "race");
      await setSel("advancedGroupCurves", "");
      await setSel("advancedLinetypeBy", "endpoints");
      await resetSelection();
      await settle();
    }
  },
  {
    // TWO SMOOTHER FAMILIES AT ONCE, one per data kind: loess on the
    // CONTINUOUS endpoint (brls) and GAM on the BINARY one (icgi).
    //
    // This scenario used to run loess on BOTH. That is no longer offered:
    // an unconstrained local regression has no mechanism to respect [0,1],
    // and on real icgi subgroups its point estimate reached 1.07. The
    // baseline diff on this scenario IS the loess→GAM before/after record for
    // the binary panel. Everything else about the scenario is deliberately
    // unchanged — grouping by sex still proves the pipelines stay
    // family-blind, and the pooled click still exercises smoother readout fits.
    name: "s12-smoothers-binary-gam-continuous-loess",
    run: async () => {
      await setEndpoints(["icgi", "brls"]);
      await page.locator('.nav-btn[data-rail="analysis"]').click();
      await page.evaluate(() => {
        for (const [ep, model] of [["icgi", "gam"], ["brls", "loess"]]) {
          const sel = document.querySelector(`select[data-endpoint-model="${ep}"]`);
          if (sel && sel.value !== model) {
            sel.value = model;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      });
      await setMode("advanced");
      await setFacets(["endpoints"], []);
      await setSel("advancedColorBy", "sex");
      await setSel("advancedGroupCurves", "sex");
      await setSel("advancedLinetypeBy", "endpoints");
      await resetSelection();
      await settle();
      await clickRow("1200 mg");
      await settle();
    }
  },
  {
    // Unified minimum-support rule (I11). Rides s11's still-active race recode
    // (levels 1, 2+3, 4+5, 7, 8, (missing)) whose dose×level cells are naturally
    // tiny: 600 mg×"1" N=2 (minimal), 600 mg×"8" N=1 (single), 600 mg×"2+3" N=3,
    // while "4+5" stays a full box. Pins: raw-point strip rows instead of boxes
    // below N=5; readout Min·Median·Max (no quartiles) at minimal tier and the
    // single-value line at N=1; NO Q1–Q3 projection band/markers for abstaining
    // groups; per-group curves absent below MIN_FIT_N with "fit n/a (N=k)" in
    // the readout (race "1" has 4 rows dataset-wide → no curve, both families).
    name: "s13-minimum-support-tiers",
    run: async () => {
      await setEndpoints(["icgi", "brls"]);
      await page.locator('.nav-btn[data-rail="analysis"]').click();
      await page.evaluate(() => {
        // s12 left icgi on gam and brls on loess — restore the default
        // families so this scenario exercises the logistic/linear guards.
        for (const [ep, model] of [["icgi", "logistic"], ["brls", "linear"]]) {
          const sel = document.querySelector(`select[data-endpoint-model="${ep}"]`);
          if (sel && sel.value !== model) {
            sel.value = model;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      });
      await setMode("advanced");
      await setFacets(["endpoints"], []);
      await setSel("advancedColorBy", "race");
      await setSel("advancedGroupCurves", "race");
      await setSel("advancedLinetypeBy", "endpoints");
      await setCb("advancedColorDistShapes", true);
      await resetSelection();
      await settle();
      await clickRow("600 mg|1");
      await clickRow("600 mg|8");
      await settle();
    }
  },
  {
    // Linetype obeys ONE authority in EVERY painter (2026-09 fix): the binary
    // painter passed the linetype module's "" (solid) through, but the
    // continuous painter coerced it to undefined — FitLayer's legacy "7 5"
    // default re-dashed it (user report: "linetype not working" on brls/prls).
    // FitLayer now has NO dash policy of its own. This scenario pins the SAME
    // spec across both families: icgi (binary) and brls (continuous), group +
    // linetype = sex → per panel, sex 1 curve SOLID, sex 2 curve "8 5" —
    // identically in every panel, and the pooled strips/readout untouched.
    name: "s14-linetype-solid-both-families",
    run: async () => {
      await setEndpoints(["icgi", "brls"]);
      await setMode("advanced");
      await setFacets(["endpoints"], ["var:age"]);
      await setSel("advancedColorBy", "sex");
      await setSel("advancedGroupCurves", "sex");
      await setSel("advancedLinetypeBy", "sex");
      await setCb("advancedColorDistShapes", false);
      await resetSelection();
      await settle();
    }
  },
  {
    // Color=Endpoints strip constancy (user-confirmed bug 2026-09-17): a
    // per-COLUMN strip serves exactly ONE endpoint — its rows wear that
    // endpoint's accent (icgi strip blue, brls strip green), and the pooled
    // click's projection accent matches (resolveDoseRowPaint contract).
    name: "s15-endpoint-color-per-column-strips",
    run: async () => {
      await setEndpoints(["icgi", "brls"]);
      await setMode("advanced");
      await setFacets([], ["endpoints"]);
      await setSel("advancedColorBy", "endpoints");
      await setSel("advancedGroupCurves", "");
      await setSel("advancedLinetypeBy", "none");
      await setCb("advancedColorDistShapes", false);
      await resetSelection();
      await settle();
      await clickRow("1200 mg");
      await settle();
    }
  },
  {
    // The scope half of the same law: endpoints on ROWS collapse to ONE shared
    // strip serving BOTH endpoints — the channel is not constant over the
    // strip, so its rows stay NEUTRAL (and the projection accent likewise).
    name: "s16-endpoint-color-collapsed-strip-neutral",
    run: async () => {
      // Two passes: clearing columns first lets endpoints move to rows (the
      // rows-then-cols single pass loses to the "columns win" dedupe mid-sync).
      await setFacets([], []);
      await setFacets(["endpoints"], []);
      await resetSelection();
      await settle();
      await clickRow("1200 mg");
      await settle();
    }
  },
  {
    // Emax (ADR-0013's FOURTH family, continuous-only): brls (γ estimated —
    // sigmoidicity on) and prls (E0 fixed off — no placebo/SoC anchor toggle)
    // prove both per-endpoint toggles land on the shared curve/projection/
    // readout pipeline with the same zero-pipeline-change contract as
    // logistic/linear/loess. Deterministic fitting (grid + golden-section,
    // no starting values) means this scenario is exactly reproducible.
    name: "s17-emax-fourth-family",
    run: async () => {
      await setEndpoints(["brls", "prls"]);
      await page.locator('.nav-btn[data-rail="analysis"]').click();
      await page.evaluate(() => {
        for (const ep of ["brls", "prls"]) {
          const sel = document.querySelector(`select[data-endpoint-model="${ep}"]`);
          if (sel && sel.value !== "emax") {
            sel.value = "emax";
            sel.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      });
      await page.evaluate(() => {
        const gamma = document.querySelector('input[data-emax-gamma="brls"]');
        if (gamma && !gamma.checked) {
          gamma.checked = true;
          gamma.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const e0 = document.querySelector('input[data-emax-e0="prls"]');
        if (e0 && e0.checked) {
          e0.checked = false;
          e0.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      await setMode("advanced");
      await setFacets(["endpoints"], []);
      await setSel("advancedColorBy", "sex");
      await setSel("advancedGroupCurves", "sex");
      await setSel("advancedLinetypeBy", "endpoints");
      await resetSelection();
      await settle();
      await clickRow("1200 mg");
      await settle();
    }
  },
  {
    // GAM (ADR-0013's FIFTH family, binary-only) — the loess replacement, in
    // the configuration that made loess misbehave rather than a flattering one.
    //
    // icgi alone, unfaceted, grouped AND split by sex: on loess this is the
    // exact shape whose sex=1 subgroup (N=282, span 0.5) produced a POINT
    // ESTIMATE of 1.07 and a CI reaching 1.89. The GAM smooths on the logit
    // scale and inverse-transforms, so every curve and band value here must
    // land strictly inside (0,1) — that containment is what this baseline
    // pins, and it is structural, not clamped.
    //
    // k is left at the mgcv default (10); the pooled click exercises the GAM
    // readout fit line and the describeFit equation/edf/λ tooltip.
    name: "s18-gam-binary-bounded",
    run: async () => {
      await setEndpoints(["icgi"]);
      await page.locator('.nav-btn[data-rail="analysis"]').click();
      await page.evaluate(() => {
        const sel = document.querySelector('select[data-endpoint-model="icgi"]');
        if (sel && sel.value !== "gam") {
          sel.value = "gam";
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      await setMode("advanced");
      await setFacets([], []);
      await setSel("advancedColorBy", "sex");
      await setSel("advancedGroupCurves", "sex");
      await setSel("advancedLinetypeBy", "none");
      await setCb("advancedColorDistShapes", false);
      await resetSelection();
      await settle();
      await clickRow("1200 mg");
      await settle();
    }
  }
];

fs.mkdirSync(baseDir, { recursive: true });
let failures = 0;
for (const sc of SCENARIOS) {
  await sc.run();
  const snap = JSON.stringify(await capture(), null, 1);
  const file = path.join(baseDir, `${sc.name}.json`);
  if (WRITE) {
    fs.writeFileSync(file, snap);
    console.log(`  wrote ${sc.name} (${(snap.length / 1024).toFixed(0)} KB)`);
  } else {
    if (!fs.existsSync(file)) fail(`no baseline for ${sc.name} — run with --write first`);
    const base = fs.readFileSync(file, "utf8");
    if (base === snap) {
      console.log(`  ✓ ${sc.name}`);
    } else {
      failures++;
      const a = base.split("\n");
      const b = snap.split("\n");
      let i = 0;
      while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
      console.log(`  ✗ ${sc.name} — first diff at line ${i + 1}:`);
      console.log(`    baseline: ${(a[i] ?? "<eof>").slice(0, 160)}`);
      console.log(`    current : ${(b[i] ?? "<eof>").slice(0, 160)}`);
      fs.writeFileSync(path.join(baseDir, `${sc.name}.current.json`), snap);
    }
  }
}
await browser.close();
if (!WRITE && failures) fail(`${failures} scenario(s) diverged from baseline (see *.current.json)`);
console.log(WRITE ? "\nvisual-snapshot: baselines written\n" : "\nvisual-snapshot: ALL MATCH\n");
