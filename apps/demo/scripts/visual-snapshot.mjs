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
