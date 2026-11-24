import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const WATCHER_DIR = path.resolve(process.env.WATCHER_DIR || path.join(__dirname, "..", "vn169"));
const WATCHER_ENTRY = "watch_group_messages.js";
const LOGIN_ENTRY = "telegram_login.js";
const LOG_LIMIT = 1000;

const SESSION_PATH = path.join(WATCHER_DIR, "telegram_session.txt");
const DROP_CONFIG_PATH = path.join(WATCHER_DIR, "telegram_config.json");
const BOT_TOKEN_PATH = path.join(WATCHER_DIR, "bot.txt");
const STATE_PATH = path.join(WATCHER_DIR, "watcher_state.json");
const AUTH_PATH = path.join(WATCHER_DIR, "dropai_auth.json");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Log buffer + SSE
// ---------------------------------------------------------------------------
let logs = [];
const sseClients = new Set();

function pushLog(line, source = "watcher") {
  const entry = { ts: Date.now(), source, line: String(line) };
  logs.push(entry);
  if (logs.length > LOG_LIMIT) logs = logs.slice(-LOG_LIMIT);
  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

function attachLineReader(stream, onLine) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      if (line.trim()) onLine(line);
    }
  });
  stream.on("end", () => {
    if (buffer.trim()) onLine(buffer.trim());
    buffer = "";
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function readJson(filePath, fallback = {}) {
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function readSessionData() {
  let fileData = { session: "", api_id: "", api_hash: "", phone: "" };

  try {
    const raw = fs.readFileSync(SESSION_PATH, "utf8").trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        fileData = {
          session: parsed.session || "",
          api_id: parsed.api_id || "",
          api_hash: parsed.api_hash || "",
          phone: parsed.phone || "",
        };
      } catch {
        fileData = { session: raw, api_id: "", api_hash: "", phone: "" };
      }
    }
  } catch {
    // file khong ton tai
  }

  return {
    session: process.env.TELEGRAM_SESSION || fileData.session,
    api_id: process.env.TELEGRAM_API_ID || fileData.api_id,
    api_hash: process.env.TELEGRAM_API_HASH || fileData.api_hash,
    phone: process.env.TELEGRAM_PHONE || fileData.phone,
  };
}

function maskPhone(phone) {
  const text = String(phone || "");
  if (text.length <= 4) return text ? "***" : "";
  return `${text.slice(0, 3)}***${text.slice(-3)}`;
}

function readBotToken() {
  try {
    return fs.readFileSync(BOT_TOKEN_PATH, "utf8").trim();
  } catch {
    return "";
  }
}

function requireAuth(req, res, next) {
  if (!ADMIN_TOKEN) return next();
  const token = req.get("x-admin-token") || req.query.token;
  if (token === ADMIN_TOKEN) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// ---------------------------------------------------------------------------
// Watcher process
// ---------------------------------------------------------------------------
let watcher = null;
let watcherStartedAt = 0;
let lastExit = null;

function isWatcherRunning() {
  return Boolean(watcher && watcher.exitCode === null && !watcher.killed);
}

function validateWatcherConfig() {
  if (!fs.existsSync(path.join(WATCHER_DIR, WATCHER_ENTRY))) {
    return `Khong tim thay ${WATCHER_ENTRY} trong ${WATCHER_DIR}`;
  }
  const session = readSessionData();
  if (!session.session) {
    return "Chua co Telegram session. Hay dang nhap Telegram trong tab Dang nhap truoc.";
  }
  if (!session.api_id || !session.api_hash || !session.phone) {
    return "Thieu api_id / api_hash / phone. Hay luu cau hinh Telegram truoc.";
  }
  return null;
}

function startWatcher() {
  if (isWatcherRunning()) return { ok: false, message: "Watcher dang chay" };
  const configError = validateWatcherConfig();
  if (configError) return { ok: false, message: configError };

  watcher = spawn(process.execPath, [WATCHER_ENTRY], {
    cwd: WATCHER_DIR,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  watcherStartedAt = Date.now();
  lastExit = null;
  pushLog(`[web] Bat dau watcher (PID ${watcher.pid})`, "web");

  attachLineReader(watcher.stdout, (line) => pushLog(line, "stdout"));
  attachLineReader(watcher.stderr, (line) => pushLog(line, "stderr"));

  watcher.on("error", (err) => {
    pushLog(`[web] Loi spawn watcher: ${err?.message || err}`, "error");
  });
  watcher.on("exit", (code, signal) => {
    pushLog(`[web] Watcher dung (code=${code ?? "-"}, signal=${signal ?? "-"})`, "web");
    lastExit = { code, signal, at: Date.now() };
    watcher = null;
  });

  return { ok: true, pid: watcher.pid };
}

function stopWatcher() {
  if (!isWatcherRunning()) return { ok: false, message: "Watcher khong chay" };
  const pid = watcher.pid;
  pushLog(`[web] Gui SIGTERM toi watcher (PID ${pid})`, "web");
  watcher.kill("SIGTERM");
  const target = watcher;
  setTimeout(() => {
    if (target.exitCode === null) {
      pushLog(`[web] Watcher khong dung sau 5s, gui SIGKILL`, "web");
      target.kill("SIGKILL");
    }
  }, 5000).unref();
  return { ok: true, pid };
}

// ---------------------------------------------------------------------------
// Telegram login process
// ---------------------------------------------------------------------------
let loginProc = null;

function isLoginRunning() {
  return Boolean(loginProc && loginProc.exitCode === null && !loginProc.killed);
}

function startLogin() {
  if (isWatcherRunning()) {
    return { ok: false, message: "Hay dung watcher truoc khi dang nhap lai Telegram" };
  }
  if (isLoginRunning()) return { ok: false, message: "Dang trong qua trinh dang nhap" };
  if (!fs.existsSync(path.join(WATCHER_DIR, LOGIN_ENTRY))) {
    return { ok: false, message: `Khong tim thay ${LOGIN_ENTRY} trong ${WATCHER_DIR}` };
  }

  const session = readSessionData();
  if (!session.api_id || !session.api_hash || !session.phone) {
    return { ok: false, message: "Hay luu api_id / api_hash / phone truoc khi dang nhap" };
  }

  loginProc = spawn(process.execPath, [LOGIN_ENTRY], {
    cwd: WATCHER_DIR,
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  pushLog(`[web] Bat dau dang nhap Telegram (PID ${loginProc.pid})`, "login");

  attachLineReader(loginProc.stdout, (line) => pushLog(line, "login"));
  attachLineReader(loginProc.stderr, (line) => pushLog(line, "login"));

  loginProc.on("error", (err) => {
    pushLog(`[web] Loi spawn login: ${err?.message || err}`, "error");
  });
  loginProc.on("exit", (code, signal) => {
    pushLog(`[web] Tien trinh dang nhap ket thuc (code=${code ?? "-"}, signal=${signal ?? "-"})`, "login");
    loginProc = null;
  });

  return { ok: true, pid: loginProc.pid };
}

function sendLoginInput(text) {
  if (!isLoginRunning()) return { ok: false, message: "Khong co tien trinh dang nhap dang chay" };
  const value = String(text ?? "").replace(/[\r\n]+/g, " ").trim();
  if (!value) return { ok: false, message: "Input rong" };
  loginProc.stdin.write(`${value}\n`);
  pushLog(`[web] Da gui input cho tien trinh dang nhap (${value.length} ky tu)`, "login");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, watcherDir: WATCHER_DIR, watcherRunning: isWatcherRunning() });
});

app.get("/api/status", requireAuth, (_req, res) => {
  const state = readJson(STATE_PATH, {});
  const cfg = readJson(DROP_CONFIG_PATH, {});
  const session = readSessionData();
  const auth = readJson(AUTH_PATH, {});
  const botToken = readBotToken();

  res.json({
    running: isWatcherRunning(),
    pid: isWatcherRunning() ? watcher.pid : null,
    startedAt: watcherStartedAt,
    uptimeMs: isWatcherRunning() ? Date.now() - watcherStartedAt : 0,
    lastExit,
    loginRunning: isLoginRunning(),
    watcherDir: WATCHER_DIR,
    state: {
      pauseReason: state.pauseReason || null,
      pauseUntil: Number(state.pauseUntil || 0),
      dayProfit: state.lastLimits?.dayProfit ?? null,
      hourProfit: state.lastLimits?.hourProfit ?? null,
      balance: state.lastLimits?.balance ?? null,
      updatedAt: state.lastLimits?.updatedAt ?? null,
      limits: state.limits || null,
      betSteps: Array.isArray(state.betSteps) ? state.betSteps : null,
      loginPaused: state.loginPaused === true,
    },
    config: {
      apiId: session.api_id || cfg.api_id || "",
      phone: maskPhone(session.phone || cfg.phone || ""),
      hasSession: Boolean(session.session),
      hasDropCredentials: Boolean(cfg.drop_username && cfg.drop_password),
      dropUsername: cfg.drop_username || "",
      hasBotToken: Boolean(botToken),
      hasDropToken: Boolean(auth.token),
    },
  });
});

app.post("/api/config", requireAuth, (req, res) => {
  const { apiId, apiHash, phone, session, dropUsername, dropPassword, botToken } = req.body || {};
  const current = readSessionData();

  const nextSession = {
    session: typeof session === "string" && session.trim() ? session.trim() : current.session,
    api_id: apiId ? String(apiId) : current.api_id,
    api_hash: apiHash || current.api_hash,
    phone: phone || current.phone,
  };
  writeJson(SESSION_PATH, nextSession);

  const cfg = readJson(DROP_CONFIG_PATH, {});
  if (dropUsername) cfg.drop_username = String(dropUsername);
  if (dropPassword) cfg.drop_password = String(dropPassword);
  if (apiId) cfg.api_id = String(apiId);
  if (apiHash) cfg.api_hash = apiHash;
  if (phone) cfg.phone = phone;
  writeJson(DROP_CONFIG_PATH, cfg);

  if (typeof botToken === "string" && botToken.trim()) {
    fs.writeFileSync(BOT_TOKEN_PATH, botToken.trim(), "utf8");
  }

  pushLog("[web] Da luu cau hinh (Telegram/Drop/bot).", "web");
  res.json({ ok: true, note: "Da luu. Restart watcher de ap dung." });
});

app.get("/api/session", requireAuth, (_req, res) => {
  const session = readSessionData();
  res.json({
    ok: true,
    session: session.session,
    api_id: session.api_id,
    api_hash: session.api_hash,
    phone: session.phone,
  });
});

app.post("/api/settings", requireAuth, (req, res) => {
  const { betSteps, targetDayProfit, targetHourProfit, dayLossLimit, hourLossLimit } = req.body || {};
  const state = readJson(STATE_PATH, {});
  const next = { ...state };

  if (betSteps !== undefined) {
    const steps = (Array.isArray(betSteps) ? betSteps : String(betSteps).split(/[-,\s]+/))
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!steps.length) return res.status(400).json({ error: "betSteps khong hop le" });
    next.betSteps = steps;
  }

  const limits = { ...(state.limits || {}) };
  for (const [key, value] of Object.entries({ targetDayProfit, targetHourProfit, dayLossLimit, hourLossLimit })) {
    if (value === undefined || value === null || value === "") continue;
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      return res.status(400).json({ error: `${key} khong hop le` });
    }
    limits[key] = num;
  }
  if (Object.keys(limits).length) next.limits = limits;

  writeJson(STATE_PATH, next);
  pushLog("[web] Da cap nhat cai dat (he so / gioi han).", "web");
  res.json({
    ok: true,
    settings: { betSteps: next.betSteps || null, limits: next.limits || null },
    note: "Ap dung sau khi restart watcher.",
  });
});

app.post("/api/start", requireAuth, (_req, res) => {
  res.json(startWatcher());
});

app.post("/api/stop", requireAuth, (_req, res) => {
  res.json(stopWatcher());
});

app.post("/api/restart", requireAuth, (_req, res) => {
  if (isWatcherRunning()) {
    stopWatcher();
    setTimeout(() => startWatcher(), 1500);
    return res.json({ ok: true, message: "Dang restart..." });
  }
  res.json(startWatcher());
});

app.post("/api/login/start", requireAuth, (_req, res) => {
  res.json(startLogin());
});

app.post("/api/login/input", requireAuth, (req, res) => {
  res.json(sendLoginInput(req.body?.text));
});

app.post("/api/login/cancel", requireAuth, (_req, res) => {
  if (!isLoginRunning()) return res.json({ ok: false, message: "Khong co tien trinh dang nhap" });
  loginProc.kill("SIGTERM");
  res.json({ ok: true });
});

app.get("/api/logs", requireAuth, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 300), 1), LOG_LIMIT);
  res.json({ logs: logs.slice(-limit) });
});

app.get("/api/logs/stream", requireAuth, (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  res.write("retry: 3000\n\n");
  sseClients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      // ignore
    }
  }, 25000);
  heartbeat.unref?.();

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

app.get("/api/balance", requireAuth, (_req, res) => {
  const clientPath = path.join(WATCHER_DIR, "dropai_client.js");
  if (!fs.existsSync(clientPath)) {
    return res.status(400).json({ ok: false, error: "Khong tim thay dropai_client.js" });
  }

  const script = [
    'import { getDropBalance } from "./dropai_client.js";',
    'const balance = await getDropBalance({ interactive: false });',
    'console.log(JSON.stringify({ balance }));',
  ].join("\n");

  const proc = spawn(process.execPath, ["--input-type=module", "-e", script], {
    cwd: WATCHER_DIR,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let out = "";
  let err = "";
  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => (out += chunk));
  proc.stderr.on("data", (chunk) => (err += chunk));

  const timer = setTimeout(() => proc.kill("SIGKILL"), 15000);
  proc.on("close", () => {
    clearTimeout(timer);
    const lastLine = out.trim().split("\n").filter(Boolean).pop() || "";
    try {
      const json = JSON.parse(lastLine);
      res.json({ ok: true, balance: Number(json.balance || 0) });
    } catch {
      res.status(500).json({ ok: false, error: err.trim() || out.trim() || "Khong lay duoc so du" });
    }
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[web] Nhan ${signal}, dang dung...`);
  try {
    if (isLoginRunning()) loginProc.kill("SIGTERM");
  } catch {
    // ignore
  }
  try {
    if (isWatcherRunning()) watcher.kill("SIGTERM");
  } catch {
    // ignore
  }
  setTimeout(() => process.exit(0), 500).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("exit", () => {
  try {
    if (isLoginRunning()) loginProc.kill("SIGKILL");
  } catch {
    // ignore
  }
  try {
    if (isWatcherRunning()) watcher.kill("SIGKILL");
  } catch {
    // ignore
  }
});

app.listen(PORT, HOST, () => {
  console.log(`[web] Dashboard: http://${HOST}:${PORT}`);
  console.log(`[web] Watcher dir: ${WATCHER_DIR}`);
  if (!ADMIN_TOKEN) {
    console.log("[web] CANH BAO: chua dat ADMIN_TOKEN. Chi nen chay local (127.0.0.1).");
  }
  if (!fs.existsSync(path.join(WATCHER_DIR, WATCHER_ENTRY))) {
    console.log(`[web] CANH BAO: khong tim thay ${WATCHER_ENTRY} trong ${WATCHER_DIR}. Dat bien WATCHER_DIR.`);
  }
  if (process.env.AUTO_START === "1") {
    const result = startWatcher();
    if (result.ok) {
      console.log(`[web] Auto-start watcher PID ${result.pid}`);
    } else {
      console.log(`[web] Auto-start bo qua: ${result.message}`);
    }
  }
});
