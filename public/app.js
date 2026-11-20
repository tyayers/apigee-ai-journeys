import { RdpViewer } from "./rdp-viewer.js";

const urlParams = new URLSearchParams(window.location.search);
const queryUserParam = urlParams.get("user")?.trim() || "";

const state = {
  csrfToken: "",
  authSource: "",
  user: null,
  keepSessionsRunning: true,
  rdpPassword: "",
  viewer: null,
  connecting: false,
  switchingView: false,
  isStandaloneTab:
    window.location.pathname === "/desktop" || urlParams.get("view") === "desktop",
};

// Cross-tab coordination so switching between "/" and "/desktop" disconnects cleanly without signing out
const handoffChannel =
  typeof BroadcastChannel === "function" ? new BroadcastChannel("apigee_ai_demos_rdp") : null;

const el = {
  unauthView: document.getElementById("unauth-view"),
  unauthAlert: document.getElementById("unauth-alert"),
  userSelectForm: document.getElementById("user-select-form"),
  userParamInput: document.getElementById("user-param-input"),
  userSelectSubmit: document.getElementById("user-select-submit"),

  workspaceView: document.getElementById("workspace-view"),
  navToggleBtn: document.getElementById("nav-toggle-btn"),
  navRail: document.getElementById("nav-rail"),
  topbarBrandLink: document.getElementById("topbar-brand-link"),
  openNewTabLink: document.getElementById("open-new-tab-link"),
  themeToggleBtn: document.getElementById("theme-toggle-btn"),
  topbarUserEmail: document.getElementById("topbar-user-email"),
  logoutBtn: document.getElementById("logout-btn"),
  metricCpuPill: document.getElementById("metric-cpu-pill"),
  metricMemPill: document.getElementById("metric-mem-pill"),
  sidebarVmUser: document.getElementById("sidebar-vm-user"),
  sidebarVmHome: document.getElementById("sidebar-vm-home"),
  sidebarCpuAvg: document.getElementById("sidebar-cpu-avg"),
  sidebarMemUsed: document.getElementById("sidebar-mem-used"),
  navLinksList: document.getElementById("nav-links-list"),
  navLinksEmpty: document.getElementById("nav-links-empty"),

  rdpStatusDot: document.getElementById("rdp-status-dot"),
  rdpStatusText: document.getElementById("rdp-status-text"),
  clipboardBtn: document.getElementById("clipboard-btn"),
  fullscreenBtn: document.getElementById("fullscreen-btn"),
  disconnectBtn: document.getElementById("disconnect-btn"),
  stopSessionBtn: document.getElementById("stop-session-btn"),

  topbarMoreBtn: document.getElementById("topbar-more-btn"),
  topbarMoreMenu: document.getElementById("topbar-more-menu"),
  menuUserEmail: document.getElementById("menu-user-email"),
  menuMetricCpuPill: document.getElementById("menu-metric-cpu-pill"),
  menuMetricMemPill: document.getElementById("menu-metric-mem-pill"),
  menuClipboardBtn: document.getElementById("menu-clipboard-btn"),
  menuFullscreenBtn: document.getElementById("menu-fullscreen-btn"),
  menuOpenNewTabLink: document.getElementById("menu-open-new-tab-link"),
  menuDisconnectBtn: document.getElementById("menu-disconnect-btn"),
  menuStopSessionBtn: document.getElementById("menu-stop-session-btn"),
  menuThemeToggleBtn: document.getElementById("menu-theme-toggle-btn"),
  menuLogoutBtn: document.getElementById("menu-logout-btn"),

  standaloneDrawerToggle: document.getElementById("standalone-drawer-toggle"),
  standaloneDrawer: document.getElementById("standalone-drawer"),
  standaloneDrawerClose: document.getElementById("standalone-drawer-close"),
  drawerStatusDot: document.getElementById("drawer-status-dot"),
  drawerStatusText: document.getElementById("drawer-status-text"),
  drawerUserEmail: document.getElementById("drawer-user-email"),
  drawerMetricCpuPill: document.getElementById("drawer-metric-cpu-pill"),
  drawerMetricMemPill: document.getElementById("drawer-metric-mem-pill"),
  switchFullViewLink: document.getElementById("switch-full-view-link"),
  drawerClipboardBtn: document.getElementById("drawer-clipboard-btn"),
  drawerFullscreenBtn: document.getElementById("drawer-fullscreen-btn"),
  drawerDisconnectBtn: document.getElementById("drawer-disconnect-btn"),
  drawerStopSessionBtn: document.getElementById("drawer-stop-session-btn"),
  drawerThemeToggleBtn: document.getElementById("drawer-theme-toggle-btn"),
  drawerLogoutBtn: document.getElementById("drawer-logout-btn"),

  rdpViewport: document.getElementById("rdp-viewport"),
  rdpCanvas: document.getElementById("rdp-canvas"),
  rdpConnectOverlay: document.getElementById("rdp-connect-overlay"),
  overlayHeading: document.getElementById("overlay-heading"),
  overlayDesc: document.getElementById("overlay-desc"),
  overlayUsername: document.getElementById("overlay-username"),
  rdpErrorBanner: document.getElementById("rdp-error-banner"),
  rdpReconnectBtn: document.getElementById("rdp-reconnect-btn"),

  clipboardDialog: document.getElementById("clipboard-dialog"),
  closeClipboardDialogBtn: document.getElementById("close-clipboard-dialog-btn"),
  closeClipboardBtn: document.getElementById("close-clipboard-btn"),
  clipboardForm: document.getElementById("clipboard-form"),
  clipboardTextarea: document.getElementById("clipboard-textarea"),
};

function setBanner(bannerEl, message) {
  if (!message) {
    bannerEl.hidden = true;
    bannerEl.textContent = "";
    return;
  }
  bannerEl.textContent = message;
  bannerEl.hidden = false;
}

function installDialogLightDismissFallback(dialogEl) {
  if (!("closedBy" in HTMLDialogElement.prototype)) {
    dialogEl.addEventListener("click", (event) => {
      if (event.target !== dialogEl) return;
      const rect = dialogEl.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inside) {
        dialogEl.close();
      }
    });
  }
}

function setupThemeToggle() {
  const meta = document.querySelector('meta[name="color-scheme"]');
  const sysDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");

  const applyScheme = (scheme) => {
    document.documentElement.classList.remove("theme-light", "theme-dark");
    if (scheme === "light" || scheme === "dark") {
      meta.content = scheme;
      document.documentElement.classList.add(`theme-${scheme}`);
      localStorage.setItem("color-scheme", scheme);
    } else {
      meta.content = "light dark";
      localStorage.removeItem("color-scheme");
    }
  };

  const toggleTheme = () => {
    const pinned = localStorage.getItem("color-scheme");
    const systemScheme = sysDarkQuery.matches ? "dark" : "light";
    const oppositeOfSystem = systemScheme === "dark" ? "light" : "dark";

    if (!pinned) {
      applyScheme(oppositeOfSystem);
    } else {
      applyScheme(null);
    }
  };

  for (const btn of [el.themeToggleBtn, el.menuThemeToggleBtn, el.drawerThemeToggleBtn]) {
    btn?.addEventListener("click", toggleTheme);
  }
}

function withUserQuery(basePath) {
  if (!queryUserParam) return basePath;
  const sep = basePath.includes("?") ? "&" : "?";
  return `${basePath}${sep}user=${encodeURIComponent(queryUserParam)}`;
}

async function apiPost(path, payload) {
  const headers = { "Content-Type": "application/json" };
  if (state.csrfToken) {
    headers["X-CSRF-Token"] = state.csrfToken;
  }
  const resp = await fetch(withUserQuery(path), {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: JSON.stringify(payload || {}),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data.error || `Request failed (${resp.status})`);
    err.code = data.code;
    err.metrics = data.metrics;
    throw err;
  }
  return data;
}

function renderHostMetrics(metrics) {
  if (!metrics) return;
  const cpuNow = Math.round(metrics.cpuCurrentPercent);
  const cpu5m = Number(metrics.cpuAvg5mPercent).toFixed(1);
  const memPct = Math.round(metrics.memUsedPercent);
  const cpuLabel = metrics.overloaded
    ? `! CPU ${cpuNow}% · 5m ${cpu5m}%`
    : `CPU ${cpuNow}% · 5m ${cpu5m}%`;
  const memLabel = `MEM ${memPct}%`;

  for (const pill of [el.metricCpuPill, el.menuMetricCpuPill, el.drawerMetricCpuPill]) {
    if (!pill) continue;
    pill.dataset.overloaded = metrics.overloaded ? "true" : "false";
    pill.textContent = cpuLabel;
  }
  for (const pill of [el.metricMemPill, el.menuMetricMemPill, el.drawerMetricMemPill]) {
    if (pill) pill.textContent = memLabel;
  }
  if (el.sidebarCpuAvg) {
    el.sidebarCpuAvg.textContent = `${cpu5m}% (now ${cpuNow}%)`;
  }
  if (el.sidebarMemUsed) {
    el.sidebarMemUsed.textContent = memLabel.replace("MEM ", "");
  }
}

function setRdpStatus(dotState, label) {
  for (const dot of [el.rdpStatusDot, el.drawerStatusDot]) {
    if (dot) dot.dataset.state = dotState;
  }
  for (const textEl of [el.rdpStatusText, el.drawerStatusText]) {
    if (textEl) textEl.textContent = label;
  }
}

function setSessionControls({ connected, showStop }) {
  for (const btn of [el.disconnectBtn, el.menuDisconnectBtn, el.drawerDisconnectBtn]) {
    if (btn) btn.hidden = !connected;
  }
  if (typeof showStop === "boolean") {
    for (const btn of [el.stopSessionBtn, el.menuStopSessionBtn, el.drawerStopSessionBtn]) {
      if (btn) btn.hidden = !showStop;
    }
  }
  for (const btn of [el.clipboardBtn, el.menuClipboardBtn, el.drawerClipboardBtn]) {
    if (btn) btn.disabled = !connected;
  }
}

function setMoreMenuOpen(open) {
  if (!el.topbarMoreMenu || !el.topbarMoreBtn) return;
  el.topbarMoreMenu.hidden = !open;
  el.topbarMoreBtn.setAttribute("aria-expanded", String(open));
}

function setStandaloneDrawerOpen(open) {
  if (!el.standaloneDrawer || !el.standaloneDrawerToggle) return;
  el.standaloneDrawer.hidden = !open;
  el.standaloneDrawerToggle.setAttribute("aria-expanded", String(open));
}

function renderSidebarLinks(links) {
  if (!el.navLinksList) return;
  el.navLinksList.replaceChildren();
  const validLinks = Array.isArray(links)
    ? links.filter((item) => item && typeof item.name === "string" && typeof item.url === "string" && item.url)
    : [];

  if (validLinks.length === 0) {
    if (el.navLinksEmpty) el.navLinksEmpty.hidden = false;
    return;
  }
  if (el.navLinksEmpty) el.navLinksEmpty.hidden = true;

  for (const item of validLinks) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.className = "nav-link-btn";
    a.href = item.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";

    const label = document.createElement("span");
    label.className = "nav-link-label";
    label.textContent = item.name;

    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("width", "14");
    icon.setAttribute("height", "14");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "1.75");
    icon.setAttribute("stroke-linecap", "round");
    icon.setAttribute("stroke-linejoin", "round");
    icon.setAttribute("aria-hidden", "true");
    icon.classList.add("nav-link-icon");
    const path1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path1.setAttribute("d", "M15 3h6v6");
    const path2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path2.setAttribute("d", "M10 14 21 3");
    const path3 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path3.setAttribute("d", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6");
    icon.append(path1, path2, path3);

    a.append(label, icon);
    li.append(a);
    el.navLinksList.append(li);
  }
}

function startMetricsPolling() {
  const refreshMetrics = async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const resp = await fetch(withUserQuery("/api/metrics"), {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.metrics) {
        renderHostMetrics(data.metrics);
      }
    } catch {
      // Ignore transient network poll errors
    }
  };

  setInterval(refreshMetrics, 3000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void refreshMetrics();
    }
  });
}

function showExclusiveView(target) {
  el.unauthView.hidden = target !== "unauth";
  el.workspaceView.hidden = target !== "workspace";
}

function ensureRdpViewer() {
  if (state.viewer) return state.viewer;
  state.viewer = new RdpViewer({
    canvas: el.rdpCanvas,
    viewport: el.rdpViewport,
    onStatus: (status, detail) => {
      const dotState = status === "error" ? "disconnected" : status;

      if (status === "connected") {
        state.connecting = false;
        setRdpStatus(dotState, detail ? `Connected · ${detail}` : "Connected");
        el.rdpConnectOverlay.hidden = true;
        setSessionControls({ connected: true, showStop: state.keepSessionsRunning });
        el.rdpReconnectBtn.textContent = "Reconnect to desktop";
        el.rdpReconnectBtn.hidden = true;
        setBanner(el.rdpErrorBanner, "");
      } else if (status === "connecting") {
        state.connecting = true;
        const msg = detail || "Connecting…";
        setRdpStatus(dotState, msg);
        el.overlayHeading.textContent = "Connecting to desktop";
        el.overlayDesc.textContent = msg;
        el.rdpConnectOverlay.hidden = false;
        el.rdpReconnectBtn.hidden = true;
      } else if (status === "error") {
        state.connecting = false;
        const isResourceBusy =
          typeof detail === "string" && detail.toLowerCase().includes("no free resources");
        setRdpStatus(dotState, isResourceBusy ? "No free resources" : "Disconnected");
        el.overlayHeading.textContent = isResourceBusy
          ? "No free resources available"
          : "Connection interrupted";
        el.overlayDesc.textContent = isResourceBusy
          ? "Host VM average CPU over the last 5 minutes is 70% or higher."
          : `Signed in as ${state.user?.email || ""} (${state.user?.username || ""}).`;
        el.rdpConnectOverlay.hidden = false;
        el.rdpReconnectBtn.textContent = isResourceBusy
          ? "Retry connection"
          : "Reconnect to desktop";
        el.rdpReconnectBtn.hidden = false;
        setSessionControls({ connected: false });
        setBanner(el.rdpErrorBanner, detail || "Unable to establish xrdp session.");
      } else {
        state.connecting = false;
        setRdpStatus(dotState, detail || "Signed out");
        el.overlayHeading.textContent =
          detail === "Moved to new tab" ? "Active in new tab" : "Desktop signed out";
        el.overlayDesc.textContent = `Reconnect to start a fresh desktop session for '${state.user?.username || ""}'.`;
        el.rdpConnectOverlay.hidden = false;
        el.rdpReconnectBtn.textContent = "Reconnect to desktop";
        el.rdpReconnectBtn.hidden = false;
        setSessionControls({ connected: false });
      }
    },
    onRemoteClipboard: (text) => {
      el.clipboardTextarea.value = text;
    },
  });
  return state.viewer;
}

async function provisionAndAutoConnect() {
  if (!state.user || state.connecting) return;
  state.connecting = true;
  setBanner(el.rdpErrorBanner, "");
  el.rdpConnectOverlay.hidden = false;
  el.rdpReconnectBtn.hidden = true;
  el.rdpStatusDot.dataset.state = "connecting";
  setRdpStatus("connecting", `Provisioning '${state.user.username}'…`);
  el.overlayHeading.textContent = "Preparing workstation";
  el.overlayDesc.textContent = `Ensuring Linux user '${state.user.username}' is ready…`;

  try {
    const ensured = await apiPost("/api/vm-user/ensure", {});
    if (ensured.metrics) {
      renderHostMetrics(ensured.metrics);
    }
    state.user = ensured.user;
    state.rdpPassword = ensured.rdpPassword;
    el.sidebarVmUser.textContent = state.user.username;
    el.sidebarVmHome.textContent = state.user.homeDir;

    const viewer = ensureRdpViewer();
    await viewer.connect({
      username: state.user.username,
      password: state.rdpPassword,
    });
  } catch (err) {
    state.connecting = false;
    if (err.metrics) {
      renderHostMetrics(err.metrics);
    }
    const isResourceBusy = err.code === "RESOURCE_BUSY";
    setRdpStatus("disconnected", isResourceBusy ? "No free resources" : "Disconnected");
    el.overlayHeading.textContent = isResourceBusy
      ? "No free resources available"
      : "Provisioning failed";
    el.overlayDesc.textContent = isResourceBusy
      ? `Host VM 5-minute average CPU is ${
          err.metrics ? `${Number(err.metrics.cpuAvg5mPercent).toFixed(1)}%` : "≥ 70%"
        } (limit: 70%).`
      : `Could not prepare Linux user '${state.user.username}'.`;
    el.rdpReconnectBtn.textContent = isResourceBusy ? "Retry connection" : "Reconnect to desktop";
    el.rdpReconnectBtn.hidden = false;
    setBanner(el.rdpErrorBanner, err.message);
  }
}

function renderAuthenticatedWorkspace() {
  el.topbarUserEmail.textContent = state.user.email;
  if (el.menuUserEmail) el.menuUserEmail.textContent = state.user.email;
  if (el.drawerUserEmail) el.drawerUserEmail.textContent = state.user.email;
  el.sidebarVmUser.textContent = state.user.username;
  el.sidebarVmHome.textContent = `/home/${state.user.username}`;
  el.overlayUsername.textContent = state.user.username;
  el.topbarBrandLink.href = withUserQuery("/");
  el.openNewTabLink.href = withUserQuery("/desktop");
  if (el.menuOpenNewTabLink) el.menuOpenNewTabLink.href = withUserQuery("/desktop");
  if (el.switchFullViewLink) el.switchFullViewLink.href = withUserQuery("/");

  const hideLogout = state.authSource === "iap";
  for (const btn of [el.logoutBtn, el.menuLogoutBtn, el.drawerLogoutBtn]) {
    if (btn) btn.hidden = hideLogout;
  }

  if (state.isStandaloneTab) {
    el.workspaceView.classList.add("is-standalone-desktop");
    el.navRail.hidden = true;
    el.navToggleBtn.hidden = true;
    el.openNewTabLink.hidden = true;
    if (el.standaloneDrawerToggle) el.standaloneDrawerToggle.hidden = false;
    setStandaloneDrawerOpen(false);
    document.title = `Desktop (${state.user.username}) · Apigee AI CloudTop`;
    if (handoffChannel) {
      handoffChannel.postMessage({ type: "claimed_standalone_tab", username: state.user.username });
    }
  } else {
    el.workspaceView.classList.remove("is-standalone-desktop");
    const sidebarCollapsed = localStorage.getItem("sidebar-collapsed") === "true";
    el.navRail.hidden = sidebarCollapsed;
    el.navToggleBtn.hidden = false;
    el.navToggleBtn.setAttribute("aria-expanded", String(!sidebarCollapsed));
    el.openNewTabLink.hidden = false;
    if (el.standaloneDrawerToggle) el.standaloneDrawerToggle.hidden = true;
    setStandaloneDrawerOpen(false);
    if (handoffChannel) {
      handoffChannel.postMessage({ type: "claimed_full_view", username: state.user.username });
    }
  }

  showExclusiveView("workspace");
  ensureRdpViewer();
  void provisionAndAutoConnect();
}

async function bootstrap() {
  setupThemeToggle();
  installDialogLightDismissFallback(el.clipboardDialog);

  if (state.isStandaloneTab) {
    el.userSelectForm.action = "/desktop";
  }

  if (handoffChannel) {
    handoffChannel.addEventListener("message", (event) => {
      const msg = event.data;
      if (!msg || !state.user || msg.username !== state.user.username) return;
      if (msg.type === "claimed_standalone_tab" && !state.isStandaloneTab && state.viewer?.connected) {
        state.viewer.disconnect(4002, "Switching view");
        setRdpStatus("disconnected", "Moved to new tab");
        el.overlayHeading.textContent = "Session open in new tab";
        el.overlayDesc.textContent = `Linux desktop for '${state.user.username}' was transferred to the standalone tab.`;
        el.rdpConnectOverlay.hidden = false;
        el.rdpReconnectBtn.hidden = false;
        setSessionControls({ connected: false });
      } else if (msg.type === "claimed_full_view" && state.isStandaloneTab && state.viewer?.connected) {
        state.viewer.disconnect(4002, "Switching view");
        setRdpStatus("disconnected", "Moved to full view");
        el.overlayHeading.textContent = "Session open in full view";
        el.overlayDesc.textContent = `Linux desktop for '${state.user.username}' was transferred to the full workspace tab.`;
        el.rdpConnectOverlay.hidden = false;
        el.rdpReconnectBtn.hidden = false;
        setSessionControls({ connected: false });
      }
    });
  }

  el.navToggleBtn.addEventListener("click", () => {
    const nextHidden = !el.navRail.hidden;
    el.navRail.hidden = nextHidden;
    el.navToggleBtn.setAttribute("aria-expanded", String(!nextHidden));
    localStorage.setItem("sidebar-collapsed", String(nextHidden));
  });

  el.topbarMoreBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    setMoreMenuOpen(el.topbarMoreMenu.hidden);
  });

  el.standaloneDrawerToggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    setStandaloneDrawerOpen(el.standaloneDrawer.hidden);
  });

  el.standaloneDrawerClose?.addEventListener("click", () => {
    setStandaloneDrawerOpen(false);
  });

  document.addEventListener("click", (event) => {
    if (el.topbarMoreMenu && !el.topbarMoreMenu.hidden) {
      if (!el.topbarMoreMenu.contains(event.target) && !el.topbarMoreBtn?.contains(event.target)) {
        setMoreMenuOpen(false);
      }
    }
    if (el.standaloneDrawer && !el.standaloneDrawer.hidden) {
      if (
        !el.standaloneDrawer.contains(event.target) &&
        !el.standaloneDrawerToggle?.contains(event.target)
      ) {
        setStandaloneDrawerOpen(false);
      }
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (el.topbarMoreMenu && !el.topbarMoreMenu.hidden) setMoreMenuOpen(false);
    if (el.standaloneDrawer && !el.standaloneDrawer.hidden) setStandaloneDrawerOpen(false);
  });

  el.switchFullViewLink?.addEventListener("click", (event) => {
    event.preventDefault();
    state.switchingView = true;
    state.viewer?.disconnect(4002, "Switching view");
    window.location.href = withUserQuery("/");
  });

  el.rdpReconnectBtn.addEventListener("click", () => {
    void provisionAndAutoConnect();
  });

  const handleDisconnect = () => {
    setMoreMenuOpen(false);
    setStandaloneDrawerOpen(false);
    state.viewer?.disconnect();
    if (state.keepSessionsRunning) {
      setRdpStatus("disconnected", "Disconnected");
      el.overlayHeading.textContent = "Session paused";
      el.overlayDesc.textContent = `Your desktop session for '${state.user?.username || ""}' is still running on the host. Reconnect to resume.`;
      el.rdpReconnectBtn.textContent = "Resume desktop";
      setSessionControls({ connected: false, showStop: true });
    } else {
      setRdpStatus("disconnected", "Signed out");
      el.overlayHeading.textContent = "Desktop signed out";
      el.overlayDesc.textContent = `Reconnect to start a fresh desktop session for '${state.user?.username || ""}'.`;
      el.rdpReconnectBtn.textContent = "Reconnect to desktop";
      setSessionControls({ connected: false, showStop: false });
    }
    el.rdpConnectOverlay.hidden = false;
    el.rdpReconnectBtn.hidden = false;
  };

  for (const btn of [el.disconnectBtn, el.menuDisconnectBtn, el.drawerDisconnectBtn]) {
    btn?.addEventListener("click", handleDisconnect);
  }

  const handleStopSession = async () => {
    setMoreMenuOpen(false);
    setStandaloneDrawerOpen(false);
    for (const btn of [el.stopSessionBtn, el.menuStopSessionBtn, el.drawerStopSessionBtn]) {
      if (btn) btn.disabled = true;
    }
    state.viewer?.disconnect();
    try {
      await apiPost("/api/rdp/stop", {});
    } catch {
      // Best-effort
    } finally {
      for (const btn of [el.stopSessionBtn, el.menuStopSessionBtn, el.drawerStopSessionBtn]) {
        if (btn) btn.disabled = false;
      }
    }
    setRdpStatus("disconnected", "Signed out");
    el.overlayHeading.textContent = "Desktop session stopped";
    el.overlayDesc.textContent = `Reconnect to start a fresh desktop session for '${state.user?.username || ""}'.`;
    el.rdpConnectOverlay.hidden = false;
    el.rdpReconnectBtn.textContent = "Reconnect to desktop";
    el.rdpReconnectBtn.hidden = false;
    setSessionControls({ connected: false, showStop: false });
  };

  for (const btn of [el.stopSessionBtn, el.menuStopSessionBtn, el.drawerStopSessionBtn]) {
    btn?.addEventListener("click", () => {
      void handleStopSession();
    });
  }

  // Immediately close WebSocket on tab close / reload so the VM desktop session signs out right away
  window.addEventListener("pagehide", () => {
    if (!state.switchingView) {
      state.viewer?.disconnect();
    }
  });

  const handleFullscreen = () => {
    setMoreMenuOpen(false);
    if (!document.fullscreenElement) {
      el.rdpViewport.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  for (const btn of [el.fullscreenBtn, el.menuFullscreenBtn, el.drawerFullscreenBtn]) {
    btn?.addEventListener("click", handleFullscreen);
  }

  // Clipboard modal
  const handleOpenClipboard = () => {
    setMoreMenuOpen(false);
    el.clipboardDialog.showModal();
  };

  for (const btn of [el.clipboardBtn, el.menuClipboardBtn, el.drawerClipboardBtn]) {
    btn?.addEventListener("click", handleOpenClipboard);
  }

  el.closeClipboardDialogBtn.addEventListener("click", () => el.clipboardDialog.close());
  el.closeClipboardBtn.addEventListener("click", () => el.clipboardDialog.close());
  el.clipboardForm.addEventListener("submit", (e) => {
    e.preventDefault();
    state.viewer?.sendClipboardText(el.clipboardTextarea.value);
    el.clipboardDialog.close();
    el.rdpCanvas.focus();
  });

  const handleLogout = async () => {
    setMoreMenuOpen(false);
    setStandaloneDrawerOpen(false);
    state.viewer?.disconnect();
    try {
      await apiPost("/api/auth/logout", {});
    } catch {
      // Ignore
    }
    window.location.href = state.isStandaloneTab ? "/desktop" : "/";
  };

  for (const btn of [el.logoutBtn, el.menuLogoutBtn, el.drawerLogoutBtn]) {
    btn?.addEventListener("click", () => {
      void handleLogout();
    });
  }

  const resp = await fetch(withUserQuery("/api/me"), { credentials: "same-origin" });
  const data = await resp.json().catch(() => ({}));

  if (data.metrics) {
    renderHostMetrics(data.metrics);
  }
  startMetricsPolling();

  if (!data.authenticated) {
    if (data.error) {
      setBanner(el.unauthAlert, data.error);
    }
    showExclusiveView("unauth");
    return;
  }

  state.csrfToken = data.csrfToken;
  state.authSource = data.authSource;
  state.user = data.user;
  state.keepSessionsRunning = data.keepSessionsRunning !== false;
  renderSidebarLinks(data.links);
  renderAuthenticatedWorkspace();
}

bootstrap();
