const STORAGE_KEY = "er-demo-scatter-pane-ratio";
const STACK_HEIGHT_KEY = "er-demo-metric-stack-height";

/** `0` = auto (flex-fill the plot panel). */
export function loadMetricStackHeight(defaultPx = 0): number {
  const raw = localStorage.getItem(STACK_HEIGHT_KEY);
  if (!raw) return defaultPx;
  if (raw === "0" || raw === "auto") return 0;
  const n = Number(raw);
  if (n === 560) return 0;
  return Number.isFinite(n) && n >= 320 && n <= 1200 ? Math.round(n) : defaultPx;
}

export function saveMetricStackHeight(px: number): void {
  if (px <= 0) localStorage.setItem(STACK_HEIGHT_KEY, "0");
  else localStorage.setItem(STACK_HEIGHT_KEY, String(Math.round(px)));
}

export function applyMetricStackHeight(stack: HTMLElement, heightPx: number): void {
  if (heightPx <= 0) {
    stack.style.height = "";
    stack.style.flex = "1 1 0";
    stack.style.minHeight = "280px";
  } else {
    stack.style.flex = "0 0 auto";
    stack.style.height = `${heightPx}px`;
    stack.style.minHeight = "";
  }
}

/** Drag handle under the plot grid — changes total stack height (scatter + distribution). */
export function attachPlotStackHeightResizer(
  handle: HTMLElement,
  getHeight: () => number,
  onHeight: (px: number) => void,
  onRelease?: () => void
): void {
  let startY = 0;
  let startH = 480;

  handle.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    startY = ev.clientY;
    startH = getHeight();
    handle.setPointerCapture(ev.pointerId);
  });
  handle.addEventListener("pointermove", (ev) => {
    if (!handle.hasPointerCapture(ev.pointerId)) return;
    const dy = ev.clientY - startY;
    const next = Math.max(320, Math.min(1200, startH + dy));
    onHeight(next);
  });
  handle.addEventListener("pointerup", (ev) => {
    if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
    onRelease?.();
  });
}

export function loadScatterPaneRatio(defaultRatio = 0.74): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultRatio;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0.25 && n <= 0.85 ? n : defaultRatio;
}

export function saveScatterPaneRatio(ratio: number): void {
  localStorage.setItem(STORAGE_KEY, String(Math.round(ratio * 1000) / 1000));
}

/** Vertical drag handle between scatter and distribution panes inside a `.metric-stack`. */
export function attachMetricStackSplitter(
  stack: HTMLElement,
  onRatio: (scatterShare: number) => void,
  onRelease?: () => void
): void {
  const handle = stack.querySelector<HTMLElement>(".metric-stack-splitter");
  if (!handle) return;

  let startY = 0;
  let startRatio = 0.58;

  const readRatio = (): number => {
    const scatter = stack.querySelector<HTMLElement>(".metric-stack-scatter");
    const dist = stack.querySelector<HTMLElement>(".metric-stack-dist");
    if (!scatter || !dist) return 0.58;
    const sh = scatter.getBoundingClientRect().height;
    const dh = dist.getBoundingClientRect().height;
    const t = sh + dh;
    return t > 0 ? sh / t : 0.58;
  };

  const applyRatio = (ratio: number) => {
    const r = Math.max(0.25, Math.min(0.85, ratio));
    stack.style.setProperty("--scatter-fr", String(Math.round(r * 100)));
    stack.style.setProperty("--dist-fr", String(Math.round((1 - r) * 100)));
    onRatio(r);
  };

  handle.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    startY = ev.clientY;
    startRatio = readRatio();
    handle.setPointerCapture(ev.pointerId);
  });
  handle.addEventListener("pointermove", (ev) => {
    if (!handle.hasPointerCapture(ev.pointerId)) return;
    const total = stack.getBoundingClientRect().height;
    if (total < 80) return;
    const dy = ev.clientY - startY;
    applyRatio(startRatio + dy / total);
  });
  handle.addEventListener("pointerup", (ev) => {
    if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
    onRelease?.();
  });
}

export function applyScatterPaneRatio(stack: HTMLElement, ratio: number): void {
  const r = Math.max(0.25, Math.min(0.85, ratio));
  stack.style.setProperty("--scatter-fr", String(Math.round(r * 100)));
  stack.style.setProperty("--dist-fr", String(Math.round((1 - r) * 100)));
}

/** Splitter between `.facet-scatter-block` and `.facet-dist-block` inside `.facet-layout`. */
export function attachFacetBlockSplitter(
  facet: HTMLElement,
  onRatio: (scatterShare: number) => void,
  onRelease?: () => void
): void {
  const handle = facet.querySelector<HTMLElement>(".facet-block-splitter");
  if (!handle) return;

  let startY = 0;
  let startRatio = 0.74;

  const readRatio = (): number => {
    const scatter = facet.querySelector<HTMLElement>(".facet-scatter-block");
    const dist = facet.querySelector<HTMLElement>(".facet-dist-block");
    if (!scatter || !dist) return 0.74;
    const sh = scatter.getBoundingClientRect().height;
    const dh = dist.getBoundingClientRect().height;
    const t = sh + dh;
    return t > 0 ? sh / t : 0.74;
  };

  const applyRatio = (ratio: number) => {
    const r = Math.max(0.25, Math.min(0.85, ratio));
    applyScatterPaneRatio(facet, r);
    onRatio(r);
  };

  handle.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    startY = ev.clientY;
    startRatio = readRatio();
    handle.setPointerCapture(ev.pointerId);
  });
  handle.addEventListener("pointermove", (ev) => {
    if (!handle.hasPointerCapture(ev.pointerId)) return;
    const total = facet.getBoundingClientRect().height;
    if (total < 120) return;
    const dy = ev.clientY - startY;
    applyRatio(startRatio + dy / total);
  });
  handle.addEventListener("pointerup", (ev) => {
    if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
    onRelease?.();
  });
}
