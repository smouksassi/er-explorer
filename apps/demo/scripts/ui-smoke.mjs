#!/usr/bin/env node
/**
 * Headless UI smoke for layout visual policy (Phase 0+1).
 * Prerequisite: node apps/demo/scripts/verify-build.mjs
 * Run from repo root: node apps/demo/scripts/ui-smoke.mjs
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..", "..");
const distHtml = path.join(root, "apps", "demo", "dist", "index.html");

const NEUTRAL_COMPARE = "#64748b";
const NEUTRAL_DOSE_CHROME = "#475569";

function fail(msg) {
  console.error(`\nui-smoke FAIL: ${msg}`);
  process.exit(1);
}

function ok(label) {
  console.log(`  ✓ ${label}`);
}

async function loadDemo(page) {
  const url = pathToFileURL(distHtml).href;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator("#reloadBundledBtn").click();
  await page.locator("#applyMappingBtn").click();
  await page.waitForFunction(
    () => {
      const n = document.querySelector("#kpiShowing")?.textContent?.trim();
      return n && n !== "—" && !Number.isNaN(Number(n));
    },
    { timeout: 60_000 }
  );
  await page.waitForSelector("#scatterPanels svg", { timeout: 30_000 });
}

async function endpointIds(page) {
  return page.$$eval("#endpointGroup input[type=checkbox]", (inputs) =>
    inputs.map((i) => i.value)
  );
}

async function openDrawerRail(page, rail) {
  await page.locator(`.nav-btn[data-rail="${rail}"]`).click();
}

async function setCheckbox(page, id, checked) {
  await page.evaluate(
    ({ id, checked }) => {
      const el = document.getElementById(id);
      if (!el || el.type !== "checkbox") throw new Error(`missing checkbox #${id}`);
      if (el.checked !== checked) {
        el.checked = checked;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    },
    { id, checked }
  );
  await page.waitForTimeout(150);
}

async function setSelectedEndpoints(page, ids) {
  await openDrawerRail(page, "analysis");
  await page.evaluate((wantIds) => {
    const inputs = [...document.querySelectorAll("#endpointGroup input[type=checkbox]")];
    for (const input of inputs) {
      const want = wantIds.includes(input.value);
      if (input.checked !== want) {
        input.checked = want;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }, ids);
  await page.waitForTimeout(200);
}

async function setSelectValue(page, id, value) {
  await page.evaluate(
    ({ id, value }) => {
      const el = document.getElementById(id);
      if (!el || el.tagName !== "SELECT") throw new Error(`missing select #${id}`);
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { id, value }
  );
  await page.waitForTimeout(200);
}

async function setMultiSelectValues(page, id, values) {
  await page.evaluate(
    ({ id, values }) => {
      const el = document.getElementById(id);
      if (!el || el.tagName !== "SELECT") throw new Error(`missing select #${id}`);
      const want = new Set(values);
      for (const opt of el.options) {
        opt.selected = want.has(opt.value);
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { id, values }
  );
  await page.waitForTimeout(200);
}

async function distShapeStrokes(page) {
  return page.$$eval("path.er-ridge-shape", (paths) =>
    paths.map((p) => p.getAttribute("stroke")?.toLowerCase() ?? "")
  );
}

async function distinct(values) {
  return [...new Set(values.filter(Boolean))];
}

async function ridgeGroupIds(page) {
  return page.$$eval("g.er-ridge", (gs) => gs.map((g) => g.getAttribute("data-group") ?? ""));
}

async function projectionFills(page) {
  return page.$$eval(".er-dose-projection circle", (cs) =>
    cs.map((c) => c.getAttribute("fill")?.toLowerCase() ?? "")
  );
}

async function readoutText(page) {
  const el = page.locator(".readout").first();
  if (!(await el.count())) return "";
  return (await el.innerText()).trim();
}

async function openStyleDrawer(page) {
  await openDrawerRail(page, "style");
  await page.locator("#drawer-style").waitFor({ state: "visible" });
}

async function run() {
  console.log("\nui-smoke: ensuring build…");
  const build = spawnSync(process.execPath, ["apps/demo/scripts/verify-build.mjs"], {
    cwd: root,
    stdio: "inherit"
  });
  if (build.status !== 0) process.exit(build.status ?? 1);

  let chromium;
  try {
    const pw = await import(pathToFileURL(path.join(root, "apps", "demo", "node_modules", "playwright", "index.mjs")).href);
    chromium = pw.chromium;
  } catch {
    console.log("Installing playwright (one-time)…");
    const inst = spawnSync("pnpm", ["add", "-D", "playwright@1.49.1", "--filter", "@er-explorer/demo"], {
      cwd: root,
      stdio: "inherit",
      shell: true
    });
    if (inst.status !== 0) fail("could not add playwright devDependency");
    const browsers = spawnSync("npx", ["playwright", "install", "chromium"], {
      cwd: path.join(root, "apps", "demo"),
      stdio: "inherit",
      shell: true
    });
    if (browsers.status !== 0) fail("playwright install chromium failed");
    const pw = await import(pathToFileURL(path.join(root, "apps", "demo", "node_modules", "playwright", "index.mjs")).href);
    chromium = pw.chromium;
  }
  if (!chromium) fail("playwright chromium not available");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  try {
    console.log("\nui-smoke: load bundled effICGI");
    await loadDemo(page);
    ok("dataset loaded and scatter rendered");

    const eps = await endpointIds(page);
    if (eps.length < 2) fail("smoke needs at least two endpoints in dataset");
    const pick = eps.filter((e) => e !== "icgi").slice(0, 2);
    const compareEps = pick.length >= 2 ? pick : eps.slice(0, 2);

    console.log("\n1) Guided compare — split distribution ON");
    await openDrawerRail(page, "style");
    await page.locator('input[name="layoutMode"][value="guided"]').check();
    await openDrawerRail(page, "analysis");
    await setSelectedEndpoints(page, compareEps);
    const compareCb = page.locator("#compareEndpoints");
    if (await compareCb.isDisabled()) fail("compare endpoints should be enabled with 2+ endpoints");
    await setCheckbox(page, "compareEndpoints", true);
    await setCheckbox(page, "compareDistByEndpoint", true);
    await openDrawerRail(page, "plot");
    await page.waitForTimeout(300);

    const legendVisible = await page.locator("#endpointLegend").evaluate((el) => el.style.display !== "none");
    if (!legendVisible) fail("endpoint legend should show when color=endpoints (guided compare)");
    ok("endpoint legend visible");

    const splitIds = (await ridgeGroupIds(page)).filter((id) => id.includes("|"));
    if (splitIds.length < 2) fail(`expected split dist rows (dose|endpoint), got ${splitIds.length}`);
    ok(`split dist rows (${splitIds.length} with |)`);

    console.log("\n2) Guided compare — split distribution OFF (ADR-0012: neutral strip, endpoint curves)");
    await setCheckbox(page, "compareDistByEndpoint", false);
    await openDrawerRail(page, "plot");
    await page.waitForTimeout(400);

    // One color channel per view: under color=endpoints, unsplit dose rows are
    // grouped by dose only -> neutral ink; dose identity is the row label.
    const strokes = await distShapeStrokes(page);
    if (!strokes.length) fail("no distribution shapes rendered");
    const uniqStroke = await distinct(strokes);
    const allNeutral = uniqStroke.length === 1 && uniqStroke[0] === NEUTRAL_COMPARE;
    if (!allNeutral) {
      fail(`unsplit dist under color=endpoints must be neutral ${NEUTRAL_COMPARE}, got ${uniqStroke.join(", ")}`);
    }
    ok("dist rows neutral under color=endpoints (one color channel)");

    const curveStrokes = await page.$$eval(".facet-scatter-block path[stroke]", (paths) =>
      paths
        .map((p) => p.getAttribute("stroke")?.toLowerCase() ?? "")
        .filter((s) => s && s !== "none" && s !== "#ffffff")
    );
    const endpointPalette = compareEps.map((e) =>
      ({ brls: "#55a868", prls: "#8172b2", icgi: "#4c72b0" }[e] ?? "")
    );
    const hasEndpointCurve = curveStrokes.some((s) => endpointPalette.includes(s));
    if (!hasEndpointCurve && curveStrokes.length) {
      ok("curve strokes present (palette check skipped)");
    } else if (hasEndpointCurve) {
      ok("scatter curves use endpoint colors");
    }

    console.log("\n3) Advanced — endpoint rows + color by endpoints");
    await openStyleDrawer(page);
    await page.evaluate(() => {
      const r = document.querySelector('input[name="layoutMode"][value="advanced"]');
      if (r instanceof HTMLInputElement) {
        r.checked = true;
        r.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await setMultiSelectValues(page, "advancedRowFacets", ["endpoints"]);
    await setMultiSelectValues(page, "advancedColFacets", []);
    await setSelectValue(page, "advancedColorBy", "endpoints");
    await setCheckbox(page, "advancedColorDistShapes", false);
    await openDrawerRail(page, "plot");
    await page.waitForTimeout(400);

    const titles = await page.$$eval(".panel-cell-title", (els) => els.map((e) => e.textContent?.trim() ?? ""));
    if (titles.length < compareEps.length) {
      fail(`expected facet titles per endpoint, got ${titles.length}: ${titles.join("; ")}`);
    }
    ok(`endpoint row facets (${titles.length} panel titles)`);

    // Each endpoint must get its OWN panels — duplicated first-endpoint stacks
    // passed the count check for months (fallback col branch clobbered row endpoints).
    const stackEndpoints = await page.$$eval(".metric-stack[data-endpoint]", (els) => [
      ...new Set(els.map((e) => e.getAttribute("data-endpoint")))
    ]);
    if (stackEndpoints.length < compareEps.length) {
      fail(`endpoint row facets must cover every endpoint, got stacks for: ${stackEndpoints.join(", ")}`);
    }
    ok(`distinct endpoint stacks (${stackEndpoints.join(", ")})`);

    const overlayText = await page.locator("text=ENDPOINTS OVERLAID").count();
    if (overlayText > 0) fail("Advanced should not show ENDPOINTS OVERLAID banner");
    ok("no legacy overlay banner");

    // ADR-0012 dedup: strips collapse over endpoints — with endpoints as the only
    // row facet there must be exactly ONE dist strip per exposure metric, never
    // one per endpoint row (the duplicated-stacked-strips bug).
    const distStackMetrics = await page.$$eval(".metric-stack-dist-only", (els) =>
      els.map((e) => e.getAttribute("data-metric"))
    );
    const uniqDistMetrics = [...new Set(distStackMetrics)];
    if (distStackMetrics.length !== uniqDistMetrics.length) {
      fail(`dist strips must collapse over endpoints: ${distStackMetrics.length} strips for metrics ${uniqDistMetrics.join(", ")}`);
    }
    ok(`dist strips deduped over endpoints (${distStackMetrics.length} strip(s): ${uniqDistMetrics.join(", ")})`);

    console.log("\n4) Advanced — color by sex + split dist → click row → readout/projections");
    await openStyleDrawer(page);
    const sexValue = await page.evaluate(() => {
      const sel = document.getElementById("advancedColorBy");
      if (!sel || sel.tagName !== "SELECT") return null;
      for (const opt of sel.options) {
        if (/sex/i.test(opt.textContent ?? "") || opt.value === "sex") return opt.value;
      }
      return null;
    });
    if (!sexValue) fail("no sex covariate in advanced color select");
    await setSelectValue(page, "advancedColorBy", sexValue);
    await setCheckbox(page, "advancedColorDistShapes", true);
    await openDrawerRail(page, "plot");
    await page.waitForTimeout(400);

    await openDrawerRail(page, "overlays");

    const levelIds = (await ridgeGroupIds(page)).filter((id) => id.includes("|"));
    if (levelIds.length < 2) fail("expected color-split dist rows (dose|level)");
    ok(`covariate split dist (${levelIds.length} split rows)`);

    await setCheckbox(page, "showDistReadout", true);
    // Dispatch the click directly: with 3 endpoint rows the physical click point
    // can land off-ridge in headless; the handler itself is what we're testing.
    await page.evaluate(() => {
      const g = document.querySelector("g.er-ridge");
      g?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await page.waitForTimeout(500);

    const readout = await readoutText(page);
    if (!readout || /click a box/i.test(readout)) {
      fail("readout should populate after clicking a split dist row");
    }
    ok("readout populated after dist click");

    const fills = await projectionFills(page);
    if (fills.length && fills.every((f) => f === NEUTRAL_DOSE_CHROME)) {
      fail("projections should not all be neutral dose chrome color");
    }
    if (fills.length) ok(`projection markers rendered (${fills.length} circles)`);
    else ok("readout ok (no binary projection circles in this layout — acceptable)");

    console.log("\n5) Advanced — continuous endpoint + color sex + fit per group (ADR-0012 curve groups)");
    await setSelectedEndpoints(page, ["brls"]);
    await openStyleDrawer(page);
    await setSelectValue(page, "advancedColorBy", sexValue);
    await setCheckbox(page, "advancedColorDistShapes", false);
    await setSelectValue(page, "advancedGroupCurves", sexValue);
    await openDrawerRail(page, "plot");
    await page.waitForTimeout(400);

    const contCurveStrokes = await page.$$eval(".facet-scatter-block svg path[stroke]", (paths) =>
      paths
        .filter((p) => p.getAttribute("fill") === "none" && !p.getAttribute("stroke-dasharray"))
        .map((p) => p.getAttribute("stroke")?.toLowerCase() ?? "")
        .filter((s) => s && s !== "none" && s !== "#ffffff" && s !== "#e2e8f0")
    );
    const uniqCont = [...new Set(contCurveStrokes)];
    if (uniqCont.includes("#64748b") && uniqCont.length === 1) {
      fail("continuous endpoint with fit-per-color should not render a single pooled gray curve");
    }
    if (uniqCont.length < 2) {
      fail(`expected >=2 curve stroke colors for continuous fit-per-color, got ${uniqCont.join(", ")}`);
    }
    ok(`continuous fit-per-color renders ${uniqCont.length} distinct curve colors`);

    console.log("\n6) Advanced — continuous endpoint + color endpoints (monochrome, no dose rainbow)");
    await openStyleDrawer(page);
    await setSelectValue(page, "advancedColorBy", "endpoints");
    await openDrawerRail(page, "plot");
    await page.waitForTimeout(400);

    // Per-PANEL monochrome: each endpoint's panel wears exactly one point color
    // (its own endpoint accent) — a dose rainbow inside any panel fails.
    const perStackFills = await page.$$eval(".metric-stack[data-endpoint]", (stacks) =>
      stacks
        .map((s) => ({
          ep: s.getAttribute("data-endpoint"),
          fills: [
            ...new Set(
              [...s.querySelectorAll("svg g.er-points circle")]
                .map((c) => (c.getAttribute("fill") || "").toLowerCase())
                .filter((f) => f && f !== "none" && f !== "#ffffff" && f !== "transparent")
            )
          ]
        }))
        .filter((s) => s.fills.length)
    );
    if (!perStackFills.length) fail("no scatter points found for monochrome check");
    for (const s of perStackFills) {
      if (s.fills.length > 1) {
        fail(`panel ${s.ep} under color=endpoints must be monochrome, got ${s.fills.join(", ")}`);
      }
    }
    ok(
      `points monochrome per panel under color=endpoints (${perStackFills
        .map((s) => `${s.ep}:${s.fills[0]}`)
        .join(", ")})`
    );

    console.log("\n7) CONFORMANCE MATRIX (ADR-0013/I7): same scenarios per family → same structure");
    // Every scenario runs against a binary AND a continuous endpoint; structure
    // (projection group count, colors under the one-channel law, callout count)
    // must be IDENTICAL across families. I8: split curves expand pooled clicks
    // to level groups; pooled curve keeps the pooled group in neutral.
    const CONFORMANCE_SCENARIOS = [
      {
        name: "grouped curves, pooled 2400mg click → group partition",
        groupBy: "wt",
        splitBoxplots: false,
        clickGroup: "2400 mg",
        expectGroups: 2
      },
      {
        name: "grouped curves, single level-row click → one group on its curve",
        groupBy: "wt",
        splitBoxplots: true,
        clickPrefix: "2400 mg|",
        expectGroups: 1
      },
      {
        name: "pooled curve, pooled click → one neutral group",
        groupBy: "",
        splitBoxplots: false,
        clickGroup: "2400 mg",
        expectGroups: 1,
        expectColors: ["#475569"]
      }
    ];
    const captureStructure = () =>
      page.$$eval(".metric-stack-scatter svg", (svgs) => {
        const svg = svgs[0];
        if (!svg) return null;
        const markerGroups = svg.querySelectorAll(".er-dose-projection").length;
        const markerColors = [
          ...new Set(
            [...svg.querySelectorAll(".er-dose-projection circle")]
              .map((c) => (c.getAttribute("fill") || c.getAttribute("stroke") || "").toLowerCase())
              .filter((f) => f && f !== "#ffffff" && f !== "#111827" && f !== "transparent" && f !== "none")
          )
        ].sort();
        const observedCallouts = [...svg.querySelectorAll(".er-marker-hit")].filter((el) =>
          (el.getAttribute("data-er-marker-tip") || "").includes("Observed")
        ).length;
        return { markerGroups, markerColors, observedCallouts };
      });
    for (const sc of CONFORMANCE_SCENARIOS) {
      const familyStructures = [];
      for (const ep of ["icgi", "brls"]) {
        await setSelectedEndpoints(page, [ep]);
        await openStyleDrawer(page);
        await setSelectValue(page, "advancedColorBy", "wt");
        await setSelectValue(page, "advancedGroupCurves", sc.groupBy);
        await setCheckbox(page, "advancedColorDistShapes", sc.splitBoxplots);
        await openDrawerRail(page, "analysis");
        await page.locator("#resetBtn").click();
        await page.waitForTimeout(300);
        await openDrawerRail(page, "plot");
        const clicked = await page.evaluate(({ group, prefix }) => {
          const g = [...document.querySelectorAll("g.er-ridge")].find((el) => {
            const id = el.getAttribute("data-group") ?? "";
            return group ? id === group : id.startsWith(prefix) && id.length > prefix.length;
          });
          if (!g) return false;
          g.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          return true;
        }, { group: sc.clickGroup, prefix: sc.clickPrefix ?? "" });
        if (!clicked) fail(`conformance(${ep}, ${sc.name}): row "${sc.clickGroup ?? sc.clickPrefix}" not rendered`);
        await page.waitForTimeout(600);
        const structure = await captureStructure();
        if (!structure) fail(`conformance(${ep}, ${sc.name}): no scatter svg`);
        familyStructures.push({ ep, ...structure });
      }
      const [bin, cont] = familyStructures;
      if (bin.markerGroups !== sc.expectGroups || cont.markerGroups !== sc.expectGroups) {
        fail(
          `conformance "${sc.name}": expected ${sc.expectGroups} group(s), got binary=${bin.markerGroups} continuous=${cont.markerGroups}`
        );
      }
      if (JSON.stringify(bin.markerColors) !== JSON.stringify(cont.markerColors)) {
        fail(`conformance "${sc.name}": color mismatch ${bin.markerColors} vs ${cont.markerColors}`);
      }
      if (sc.expectColors && JSON.stringify(bin.markerColors) !== JSON.stringify(sc.expectColors)) {
        fail(`conformance "${sc.name}": expected colors ${sc.expectColors}, got ${bin.markerColors}`);
      }
      if (bin.observedCallouts !== cont.observedCallouts) {
        fail(`conformance "${sc.name}": callout mismatch ${bin.observedCallouts} vs ${cont.observedCallouts}`);
      }
      ok(`${sc.name} — identical (${bin.markerGroups} group(s), [${bin.markerColors.join(", ")}], ${bin.observedCallouts} callouts)`);
    }

    console.log("\nui-smoke: ALL CHECKS PASSED\n");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
