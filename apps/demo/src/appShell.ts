export type ShellRail = "data" | "filters" | "analysis" | "overlays" | "style" | "plot" | "session";

const RAILS: ShellRail[] = ["data", "filters", "analysis", "overlays", "style", "plot", "session"];

let goToRail: (rail: ShellRail, opts?: { force?: boolean }) => void = () => {};

export function initAppShell(onRailChange?: (rail: ShellRail) => void): void {
  const drawer = document.getElementById("appDrawer");
  const railButtons = document.querySelectorAll<HTMLButtonElement>("[data-rail]");
  const themeToggle = document.getElementById("themeToggle") as HTMLButtonElement | null;
  const drawerClose = document.getElementById("drawerCloseBtn");

  const savedTheme = localStorage.getItem("er-demo-theme");
  if (savedTheme === "dark") document.documentElement.dataset.theme = "dark";

  themeToggle?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("er-demo-theme", next);
    updateThemeToggleLabel(themeToggle);
  });
  updateThemeToggleLabel(themeToggle);

  let activeRail: ShellRail = "data";

  function selectRail(rail: ShellRail, opts?: { force?: boolean }): void {
    if (!opts?.force && rail === activeRail && rail !== "plot") {
      rail = "plot";
    }
    activeRail = rail;
    for (const id of RAILS) {
      const panel = document.getElementById(`drawer-${id}`);
      if (panel) panel.hidden = id !== rail;
    }
    railButtons.forEach((btn) => {
      const active = btn.dataset.rail === rail;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-current", active ? "page" : "false");
    });
    if (drawer) {
      drawer.classList.toggle("hidden", rail === "plot");
      drawer.classList.toggle("drawer-overlay-open", rail !== "plot" && window.matchMedia("(max-width: 768px)").matches);
    }
    onRailChange?.(rail);
  }

  goToRail = selectRail;

  railButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const rail = btn.dataset.rail as ShellRail | undefined;
      if (rail) selectRail(rail);
    });
  });

  drawerClose?.addEventListener("click", () => {
    selectRail("plot");
  });

  selectRail("data", { force: true });

  window.addEventListener("resize", () => {
    const active = document.querySelector<HTMLButtonElement>("[data-rail].active")?.dataset.rail as ShellRail | undefined;
    if (active && drawer) {
      drawer.classList.toggle("drawer-overlay-open", active !== "plot" && window.matchMedia("(max-width: 768px)").matches);
    }
  });
}

export function setShellRail(rail: ShellRail, opts?: { force?: boolean }): void {
  goToRail(rail, opts);
}

function updateThemeToggleLabel(btn: HTMLButtonElement | null): void {
  if (!btn) return;
  const dark = document.documentElement.dataset.theme === "dark";
  btn.textContent = dark ? "Light theme" : "Dark theme";
  btn.setAttribute("aria-pressed", String(dark));
}

export function setPlotWorkspaceVisible(visible: boolean): void {
  const hint = document.getElementById("plotEmptyHint");
  const content = document.getElementById("plotContent");
  const editMappingBtn = document.getElementById("editMappingBtn");
  if (hint) hint.hidden = visible;
  if (content) content.hidden = !visible;
  if (editMappingBtn) editMappingBtn.hidden = !visible;
  document.body.classList.toggle("has-dataset", visible);
}
