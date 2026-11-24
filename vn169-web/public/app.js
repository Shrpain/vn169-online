"use strict";

const $ = (id) => document.getElementById(id);

// Backend có thể nằm khác origin (ví dụ UI trên Vercel, backend trên Render/VPS).
// Thứ tự: localStorage (nhập trong modal Kết nối) > window.VN169_API_BASE (config.js) > cùng origin.
function resolveApiBase() {
  const stored = localStorage.getItem("vn169_api_base");
  const configured = window.VN169_API_BASE || "";
  return String(stored !== null ? stored : configured).replace(/\/+$/, "");
}

let apiBase = resolveApiBase();

function apiUrl(path) {
  return `${apiBase}${path}`;
}

const PAUSE_LABELS = {
  DAY_TARGET: "Đạt mục tiêu lãi ngày",
  DAY_LOSS: "Chạm giới hạn lỗ ngày",
  HOUR_TARGET: "Đạt mục tiêu lãi giờ",
  HOUR_LOSS: "Chạm giới hạn lỗ giờ",
};

const app = {
  token: localStorage.getItem("vn169_admin_token") || "",
  status: null,
  statusFetchedAt: 0,
  logs: [],
  seenLogs: new Set(),
  es: null,
  configPrefilled: false,
  toastTimer: null,
};

// ---------------------------------------------------------------------------
// utils
// ---------------------------------------------------------------------------
function fmtMoney(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toLocaleString("vi-VN")} đ`;
}

function fmtNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("vi-VN");
}

function fmtDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString("vi-VN", { hour12: false });
  } catch {
    return "--:--:--";
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function toast(message, type = "info") {
  const el = $("toast");
  el.textContent = message;
  el.className = `toast ${type}`;
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => el.classList.add("hidden"), 3800);
}

function setConn(online) {
  const dot = $("connDot");
  dot.className = `dot ${online ? "online" : "offline"}`;
  $("connText").textContent = online ? "Đã kết nối" : "Mất kết nối";
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (app.token) headers["x-admin-token"] = app.token;

  let response;
  try {
    response = await fetch(apiUrl(path), { ...options, headers });
  } catch {
    showTokenModal();
    throw new Error("Không kết nối được backend. Kiểm tra URL backend trong modal Kết nối.");
  }

  if (response.status === 401) {
    showTokenModal();
    throw new Error("Unauthorized");
  }

  if (response.status === 404 && !apiBase) {
    // UI tĩnh (Vercel) không có API — hướng dẫn nhập URL backend.
    showTokenModal();
    throw new Error("Chưa cấu hình backend URL");
  }

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(json?.error || json?.message || `HTTP ${response.status}`);
  }
  return json;
}

// ---------------------------------------------------------------------------
// status rendering
// ---------------------------------------------------------------------------
function setProfit(el, subEl, value, target, label) {
  if (value === null || value === undefined) {
    el.textContent = "—";
    el.className = "card-value";
    subEl.textContent = `${label}: ${fmtMoney(target)}`;
    return;
  }

  el.textContent = fmtMoney(value);
  el.className = `card-value ${Number(value) > 0 ? "positive" : Number(value) < 0 ? "negative" : ""}`;
  subEl.textContent = `${label}: ${fmtMoney(target)}`;
}

function renderStatus(status) {
  app.status = status;
  app.statusFetchedAt = Date.now();
  setConn(true);

  const running = Boolean(status.running);
  const runPill = $("runPill");
  runPill.textContent = running ? "RUNNING" : "STOPPED";
  runPill.className = `pill ${running ? "running" : "stopped"}`;

  $("runMeta").textContent = running
    ? `PID: ${status.pid ?? "—"} · Uptime: ${fmtDuration(status.uptimeMs)}`
    : status.lastExit
      ? `Lần dừng cuối: code ${status.lastExit.code ?? "-"} / ${status.lastExit.signal ?? "-"}`
      : "Chưa chạy";

  const st = status.state || {};
  const limits = st.limits || {};

  $("balanceValue").textContent = fmtMoney(st.balance);

  setProfit($("dayProfitValue"), $("dayProfitSub"), st.dayProfit, limits.targetDayProfit, "Mục tiêu");
  setProfit($("hourProfitValue"), $("hourProfitSub"), st.hourProfit, limits.targetHourProfit, "Mục tiêu");

  const steps = Array.isArray(st.betSteps) && st.betSteps.length ? st.betSteps : null;
  $("stepsValue").textContent = steps ? steps.map((value) => `x${value}`).join(" → ") : "mặc định";
  $("stepsSub").textContent = steps
    ? `Mỗi đơn vị = 1.000đ · ${steps.length} bậc`
    : "Dãy mặc định 1-2-4-8-16";

  const pauseReason = st.pauseReason || null;
  const pauseValue = $("pauseValue");
  if (pauseReason) {
    pauseValue.textContent = PAUSE_LABELS[pauseReason] || pauseReason;
    pauseValue.className = "card-value small-value negative";
  } else {
    pauseValue.textContent = "Không";
    pauseValue.className = "card-value small-value positive";
  }
  updateCountdown();

  const notes = [];
  if (st.loginPaused) notes.push("Đăng nhập game đang TẮT (/stop)");
  if (!status.config?.hasDropCredentials) notes.push("Thiếu tài khoản game");
  if (!status.config?.hasBotToken) notes.push("Thiếu bot token");
  $("controlNote").textContent = notes.join(" · ");

  $("startBtn").disabled = running;
  $("stopBtn").disabled = !running;

  const loginPill = $("loginPill");
  loginPill.textContent = status.loginRunning ? "RUNNING" : "IDLE";
  loginPill.className = `pill ${status.loginRunning ? "running" : "stopped"}`;
  $("loginStartBtn").disabled = status.loginRunning || running;
  $("loginCancelBtn").disabled = !status.loginRunning;

  if (!app.configPrefilled) {
    prefillConfig(status.config || {});
  }
  renderPhoneWarning(status.config || {});
}

function updateCountdown() {
  const status = app.status;
  if (!status) return;
  const st = status.state || {};
  const sub = $("pauseSub");

  if (!st.pauseReason) {
    sub.textContent = "Tool đang chạy bình thường";
    return;
  }
  if (st.pauseReason === "DAY_TARGET" || st.pauseReason === "DAY_LOSS") {
    sub.textContent = st.pauseReason === "DAY_TARGET"
      ? "Tự reset khi sang ngày mới"
      : "Cần /start để gỡ sớm";
    return;
  }
  if (st.pauseUntil > 0) {
    const left = st.pauseUntil - Date.now();
    sub.textContent = left > 0 ? `Còn lại: ${fmtDuration(left)}` : "Sắp quay lại…";
  } else {
    sub.textContent = "—";
  }
}

async function refreshStatus() {
  try {
    const status = await api("/api/status");
    renderStatus(status);
    return status;
  } catch (err) {
    setConn(false);
    if (err.message !== "Unauthorized") console.error(err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// logs
// ---------------------------------------------------------------------------
function logLineHtml(entry) {
  const source = ["stdout", "stderr", "login", "web", "error"].includes(entry.source) ? entry.source : "web";
  return `<span class="log-line"><span class="log-time">${fmtTime(entry.ts)}</span><span class="log-source src-${source}">${source}</span>${escapeHtml(entry.line)}</span>`;
}

function matchesFilter(entry) {
  const filter = $("logFilter").value;
  if (filter === "all") return true;
  if (filter === "stderr") return entry.source === "stderr" || entry.source === "error";
  return entry.source === filter;
}

function appendToBox(box, entry, maxLines) {
  box.insertAdjacentHTML("beforeend", logLineHtml(entry));
  while (box.childElementCount > maxLines) {
    box.removeChild(box.firstElementChild);
  }
}

function logKey(entry) {
  return `${entry.ts}|${entry.source}|${entry.line}`;
}

function appendLog(entry) {
  const key = logKey(entry);
  if (app.seenLogs.has(key)) return;
  app.seenLogs.add(key);

  app.logs.push(entry);
  if (app.logs.length > 2000) app.logs = app.logs.slice(-2000);
  if (app.seenLogs.size > 4000) app.seenLogs = new Set(app.logs.map(logKey));

  appendToBox($("miniLog"), entry, 200);
  $("miniLog").scrollTop = $("miniLog").scrollHeight;

  if (matchesFilter(entry)) {
    appendToBox($("logBox"), entry, 1000);
    if ($("autoScroll").checked) {
      $("logBox").scrollTop = $("logBox").scrollHeight;
    }
  }

  if (entry.source === "login" || entry.source === "error") {
    appendToBox($("loginLog"), entry, 400);
    $("loginLog").scrollTop = $("loginLog").scrollHeight;
  }
}

function renderLogs() {
  const box = $("logBox");
  box.innerHTML = "";
  for (const entry of app.logs.filter(matchesFilter)) {
    box.insertAdjacentHTML("beforeend", logLineHtml(entry));
  }
  box.scrollTop = box.scrollHeight;

  const mini = $("miniLog");
  mini.innerHTML = "";
  for (const entry of app.logs.slice(-200)) {
    mini.insertAdjacentHTML("beforeend", logLineHtml(entry));
  }
  mini.scrollTop = mini.scrollHeight;
}

async function loadInitialLogs() {
  try {
    const data = await api("/api/logs?limit=300");
    app.logs = [];
    app.seenLogs.clear();
    for (const entry of Array.isArray(data.logs) ? data.logs : []) {
      app.seenLogs.add(logKey(entry));
      app.logs.push(entry);
    }
    renderLogs();
  } catch (err) {
    if (err.message !== "Unauthorized") console.error(err);
  }
}

// Fallback khi SSE bi proxy buffer: poll log định kỳ, dedupe theo key.
async function pollRecentLogs() {
  try {
    const data = await api("/api/logs?limit=50");
    for (const entry of Array.isArray(data.logs) ? data.logs : []) {
      appendLog(entry);
    }
  } catch (err) {
    if (err.message !== "Unauthorized") console.error(err);
  }
}

function connectLogs() {
  if (app.es) {
    app.es.close();
    app.es = null;
  }
  const url = app.token
    ? `${apiUrl("/api/logs/stream")}?token=${encodeURIComponent(app.token)}`
    : apiUrl("/api/logs/stream");
  const es = new EventSource(url);
  app.es = es;

  es.onopen = () => setConn(true);
  es.onmessage = (event) => {
    try {
      appendLog(JSON.parse(event.data));
    } catch {
      // ignore malformed
    }
  };
  es.onerror = () => setConn(false);
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------
function prefillConfig(config) {
  if (config.apiId && !$("apiId").value) $("apiId").value = config.apiId;

  // Khong dien so dien thoai da mask vao input: neu nguoi dung bam Luu
  // se ghi de so that bang "+84***567" -> Telegram khong gui ma duoc.
  const phoneInput = $("phone");
  if (config.phone) {
    phoneInput.placeholder = `Đang dùng: ${config.phone} — để trống nếu không đổi`;
  }

  if (config.dropUsername && !$("dropUsername").value) $("dropUsername").value = config.dropUsername;
  app.configPrefilled = true;
}

function renderPhoneWarning(config) {
  const phone = String(config?.phone || "");
  const warn = $("phoneWarn");
  if (!warn) return;
  const invalid = phone && (phone.includes("*") || !/^\+\d{8,15}$/.test(phone));
  if (invalid) {
    warn.textContent =
      "Số Telegram đang lưu không hợp lệ (bị mask). Nhập lại số đầy đủ dạng +8490xxxxxxx rồi bấm Lưu cấu hình.";
    warn.classList.remove("hidden");
  } else {
    warn.classList.add("hidden");
  }
}

async function saveConfig(event) {
  event.preventDefault();
  const payload = {
    apiId: $("apiId").value.trim(),
    apiHash: $("apiHash").value.trim(),
    phone: $("phone").value.trim(),
    session: $("session").value.trim(),
    dropUsername: $("dropUsername").value.trim(),
    dropPassword: $("dropPassword").value,
    botToken: $("botToken").value.trim(),
  };

  try {
    const result = await api("/api/config", { method: "POST", body: JSON.stringify(payload) });
    $("apiHash").value = "";
    $("dropPassword").value = "";
    $("botToken").value = "";
    $("session").value = "";
    $("configNote").textContent = result.note || "Đã lưu";
    toast("Đã lưu cấu hình", "success");
    await refreshStatus();
  } catch (err) {
    toast(`Lỗi lưu cấu hình: ${err.message}`, "error");
  }
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------
function prefillSettings(status) {
  if (!status) return;
  const st = status.state || {};
  const limits = st.limits || {};

  if (document.activeElement !== $("betSteps")) {
    $("betSteps").value = Array.isArray(st.betSteps) ? st.betSteps.join("-") : $("betSteps").value;
  }
  for (const [id, key] of [
    ["targetDayProfit", "targetDayProfit"],
    ["targetHourProfit", "targetHourProfit"],
    ["dayLossLimit", "dayLossLimit"],
    ["hourLossLimit", "hourLossLimit"],
  ]) {
    const input = $(id);
    if (document.activeElement !== input && limits[key] !== undefined) {
      input.value = limits[key];
    }
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const payload = {
    betSteps: $("betSteps").value.trim(),
    targetDayProfit: $("targetDayProfit").value.trim(),
    targetHourProfit: $("targetHourProfit").value.trim(),
    dayLossLimit: $("dayLossLimit").value.trim(),
    hourLossLimit: $("hourLossLimit").value.trim(),
  };

  try {
    const result = await api("/api/settings", { method: "POST", body: JSON.stringify(payload) });
    $("settingsNote").textContent = result.note || "Đã lưu";
    toast("Đã lưu cài đặt. Restart để áp dụng.", "success");
    await refreshStatus();
    prefillSettings(app.status);
  } catch (err) {
    toast(`Lỗi lưu cài đặt: ${err.message}`, "error");
  }
}

// ---------------------------------------------------------------------------
// controls
// ---------------------------------------------------------------------------
async function withButton(button, action) {
  button.disabled = true;
  try {
    await action();
  } finally {
    setTimeout(() => refreshStatus(), 400);
  }
}

function bindControls() {
  $("startBtn").addEventListener("click", () => withButton($("startBtn"), async () => {
    try {
      const result = await api("/api/start", { method: "POST" });
      if (!result.ok) throw new Error(result.message);
      toast(`Đã start watcher (PID ${result.pid})`, "success");
    } catch (err) {
      toast(`Không start được: ${err.message}`, "error");
    }
  }));

  $("stopBtn").addEventListener("click", () => withButton($("stopBtn"), async () => {
    try {
      const result = await api("/api/stop", { method: "POST" });
      if (!result.ok) throw new Error(result.message);
      toast("Đã gửi lệnh dừng watcher", "success");
    } catch (err) {
      toast(`Không stop được: ${err.message}`, "error");
    }
  }));

  $("restartBtn").addEventListener("click", () => withButton($("restartBtn"), async () => {
    try {
      const result = await api("/api/restart", { method: "POST" });
      if (!result.ok) throw new Error(result.message);
      toast(result.message || "Đang restart watcher…", "success");
    } catch (err) {
      toast(`Không restart được: ${err.message}`, "error");
    }
  }));

  $("refreshStatusBtn").addEventListener("click", async () => {
    await refreshStatus();
    toast("Đã làm mới trạng thái");
  });

  $("refreshBalanceBtn").addEventListener("click", async () => {
    const button = $("refreshBalanceBtn");
    button.disabled = true;
    $("balanceNote").textContent = "Đang lấy…";
    try {
      const result = await api("/api/balance");
      $("balanceValue").textContent = fmtMoney(result.balance);
      $("balanceNote").textContent = "";
      toast("Đã cập nhật số dư", "success");
    } catch (err) {
      $("balanceNote").textContent = err.message;
      toast(`Không lấy được số dư: ${err.message}`, "error");
    } finally {
      button.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------
function bindLogin() {
  $("loginStartBtn").addEventListener("click", async () => {
    try {
      const result = await api("/api/login/start", {
        method: "POST",
        body: JSON.stringify({ forceSMS: Boolean($("loginForceSms")?.checked) }),
      });
      if (!result.ok) throw new Error(result.message);
      $("loginLog").innerHTML = "";
      toast("Đã gửi yêu cầu mã. Kiểm tra app Telegram (chat “Telegram”) hoặc SMS.", "success");
      await refreshStatus();
    } catch (err) {
      toast(`Không bắt đầu được: ${err.message}`, "error");
    }
  });

  $("loginCancelBtn").addEventListener("click", async () => {
    try {
      await api("/api/login/cancel", { method: "POST" });
      toast("Đã huỷ đăng nhập");
      await refreshStatus();
    } catch (err) {
      toast(`Lỗi huỷ: ${err.message}`, "error");
    }
  });

  const send = async () => {
    const input = $("loginInput");
    const text = input.value.trim();
    if (!text) return;
    try {
      const result = await api("/api/login/input", { method: "POST", body: JSON.stringify({ text }) });
      if (!result.ok) throw new Error(result.message);
      input.value = "";
    } catch (err) {
      toast(`Không gửi được input: ${err.message}`, "error");
    }
  };

  $("loginSendBtn").addEventListener("click", send);
  $("loginInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      send();
    }
  });
}

// ---------------------------------------------------------------------------
// tabs & token modal
// ---------------------------------------------------------------------------
function bindTabs() {
  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
      tab.classList.add("active");
      const panel = $(`tab-${tab.dataset.tab}`);
      if (panel) panel.classList.add("active");
      if (tab.dataset.tab === "logs") {
        $("logBox").scrollTop = $("logBox").scrollHeight;
      }
      if (tab.dataset.tab === "settings") {
        prefillSettings(app.status);
      }
    });
  }

  for (const link of document.querySelectorAll("[data-goto]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const target = document.querySelector(`.tab[data-tab="${link.dataset.goto}"]`);
      target?.click();
    });
  }
}

function showTokenModal() {
  $("apiBaseInput").value = apiBase;
  $("tokenModal").classList.remove("hidden");
  if (apiBase) {
    $("tokenInput").focus();
  } else {
    $("apiBaseInput").focus();
  }
}

function saveConnectionInputs() {
  const nextBase = $("apiBaseInput").value.trim().replace(/\/+$/, "");
  const baseChanged = nextBase !== apiBase;
  apiBase = nextBase;
  if (nextBase) {
    localStorage.setItem("vn169_api_base", nextBase);
  } else {
    localStorage.removeItem("vn169_api_base");
  }

  app.token = $("tokenInput").value.trim();
  if (app.token) {
    localStorage.setItem("vn169_admin_token", app.token);
  } else {
    localStorage.removeItem("vn169_admin_token");
  }

  return baseChanged;
}

function bindToken() {
  $("tokenBtn").addEventListener("click", () => {
    $("tokenInput").value = app.token;
    showTokenModal();
  });

  $("tokenSaveBtn").addEventListener("click", async () => {
    const baseChanged = saveConnectionInputs();
    $("tokenModal").classList.add("hidden");
    if (baseChanged) {
      location.reload();
      return;
    }
    connectLogs();
    await refreshStatus();
    await loadInitialLogs();
  });

  $("connSaveBtn").addEventListener("click", () => {
    saveConnectionInputs();
    location.reload();
  });

  $("tokenInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("tokenSaveBtn").click();
  });
}

function bindLogs() {
  $("logFilter").addEventListener("change", renderLogs);
  $("clearLogsBtn").addEventListener("click", () => {
    $("logBox").innerHTML = "";
    $("miniLog").innerHTML = "";
  });
}

function bindSessionExport() {
  let exportedSession = "";

  $("exportSessionBtn").addEventListener("click", async () => {
    try {
      const data = await api("/api/session");
      exportedSession = data.session || "";
      $("sessionExport").value = exportedSession
        ? JSON.stringify(
            {
              TELEGRAM_API_ID: data.api_id,
              TELEGRAM_API_HASH: data.api_hash,
              TELEGRAM_PHONE: data.phone,
              TELEGRAM_SESSION: data.session,
            },
            null,
            2,
          )
        : "(chưa có session — hãy đăng nhập trước)";
      toast("Đã xuất session. Cẩn thận: thông tin nhạy cảm.", "success");
    } catch (err) {
      toast(`Không xuất được session: ${err.message}`, "error");
    }
  });

  $("copySessionBtn").addEventListener("click", async () => {
    if (!exportedSession) {
      toast("Chưa có session để copy", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(exportedSession);
      toast("Đã copy session string", "success");
    } catch {
      $("sessionExport").select();
      document.execCommand("copy");
      toast("Đã copy session string", "success");
    }
  });

  $("copySessionJsonBtn").addEventListener("click", async () => {
    const value = $("sessionExport").value.trim();
    if (!value || value.startsWith("(")) {
      toast("Chưa có session để copy", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      toast("Đã copy JSON", "success");
    } catch {
      $("sessionExport").select();
      document.execCommand("copy");
      toast("Đã copy JSON", "success");
    }
  });
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
function init() {
  bindTabs();
  bindControls();
  bindLogin();
  bindToken();
  bindLogs();
  bindSessionExport();
  $("configForm").addEventListener("submit", saveConfig);
  $("settingsForm").addEventListener("submit", saveSettings);

  refreshStatus().then((status) => {
    if (!status) return;
    prefillSettings(status);
  });
  loadInitialLogs();
  connectLogs();

  setInterval(refreshStatus, 3000);
  setInterval(pollRecentLogs, 3000);
  setInterval(updateCountdown, 1000);
}

document.addEventListener("DOMContentLoaded", init);
