import fs from "node:fs";
import path from "node:path";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";
import { ensureDropApiLogin, logoutDropApi, getDropBalance, placeDropBet } from "./dropai_client.js";
import { startTelegramBotService } from "./telegram_bot_client.js";

const TARGET_GROUP_USERNAME = "vn168wingoo";
const TARGET_GROUP_ID = "-1001538393680";
const TARGET_GROUP_NAME = "VN168 - WINGO (1 phut)";
const SESSION_PATH = path.resolve("telegram_session.txt");
const TOOL_STATE_PATH = path.resolve("watcher_state.json");
const WATCHER_LOCK_PATH = path.resolve("watcher.lock");
const POLL_INTERVAL_MS = 500;
const HOUR_PAUSE_MS = 30 * 60 * 1000;
const HOUR_PAUSE_MINUTES = 30;
const TARGET_HOUR_PAUSE_MS = 10 * 60 * 1000;
const TARGET_HOUR_PAUSE_MINUTES = 10;
const SIGNAL_PATTERN = /Hãy đánh[\s\S]*?(NHỎ|LỚN)[\s\S]*Kỳ xổ hiện tại\s*(\d+)/iu;
const LOSE_PATTERN = /(THUA|LOSE|LOST)/iu;
const WIN_PATTERN = /(THẮNG|THANG|WIN)/iu;
const MESSAGE_FETCH_LIMIT = 200;
const MESSAGE_FETCH_MAX_PAGES = 20;

function envPositiveNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envBetSteps(name) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return null;
  const steps = raw.split(/[-,\s]+/).map(Number).filter((value) => Number.isFinite(value) && value > 0);
  return steps.length ? steps : null;
}

const DEFAULT_BET_STEPS = envBetSteps("BET_STEPS") || [1, 2, 4, 8, 16];
const DEFAULT_TARGET_DAY_PROFIT = envPositiveNumber("TARGET_DAY_PROFIT", 299000);
const DEFAULT_TARGET_HOUR_PROFIT = envPositiveNumber("TARGET_HOUR_PROFIT", 30000);
const DEFAULT_DAY_LOSS_LIMIT = envPositiveNumber("DAY_LOSS_LIMIT", 100000);
const DEFAULT_HOUR_LOSS_LIMIT = envPositiveNumber("HOUR_LOSS_LIMIT", 10000);

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;

  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireWatcherLock() {
  const existing = readJsonFile(WATCHER_LOCK_PATH, {});
  const existingPid = Number(existing?.pid || 0);

  if (existingPid && existingPid !== process.pid && isProcessAlive(existingPid)) {
    console.error(`[watcher] Da co instance dang chay voi PID ${existingPid}. Thoat de tranh trung tin nhan.`);
    return false;
  }

  writeJsonFile(WATCHER_LOCK_PATH, { pid: process.pid, started_at: new Date().toISOString() });
  return true;
}

function releaseWatcherLock() {
  const existing = readJsonFile(WATCHER_LOCK_PATH, {});
  if (Number(existing?.pid) === process.pid && fs.existsSync(WATCHER_LOCK_PATH)) {
    fs.unlinkSync(WATCHER_LOCK_PATH);
  }
}

function loadToolState() {
  return readJsonFile(TOOL_STATE_PATH, { loginPaused: false });
}

function saveToolState(state) {
  const current = readJsonFile(TOOL_STATE_PATH, {});
  writeJsonFile(TOOL_STATE_PATH, { ...current, ...state });
}

function parseBetSteps(raw) {
  return String(raw || "")
    .split(/[-,\s]+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

function loadSessionData() {
  let fileData = { session: "", api_id: "", api_hash: "", phone: "" };

  if (fs.existsSync(SESSION_PATH)) {
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
        // Migrate old format where the file stored only the session string.
        fileData = { session: raw, api_id: "", api_hash: "", phone: "" };
      }
    }
  }

  // Env uu tien de chay tren cloud (filesystem tam, session luu trong env).
  return {
    session: process.env.TELEGRAM_SESSION || fileData.session,
    api_id: process.env.TELEGRAM_API_ID || fileData.api_id,
    api_hash: process.env.TELEGRAM_API_HASH || fileData.api_hash,
    phone: process.env.TELEGRAM_PHONE || fileData.phone,
  };
}


function saveSessionData(data) {
  fs.writeFileSync(
    SESSION_PATH,
    JSON.stringify(
      {
        session: data.session || "",
        api_id: data.api_id || "",
        api_hash: data.api_hash || "",
        phone: data.phone || "",
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function askConfig(saved) {
  const apiId = Number(process.env.TELEGRAM_API_ID || saved.api_id || (await input.text("Nhap TELEGRAM_API_ID: ")));
  const apiHash = process.env.TELEGRAM_API_HASH || saved.api_hash || (await input.password("Nhap TELEGRAM_API_HASH: "));
  const phone = process.env.TELEGRAM_PHONE || saved.phone || (await input.text("Nhap so dien thoai Telegram (vd +8490xxxxxxx): "));
  const session = process.env.TELEGRAM_SESSION || saved.session || "";

  if (!apiId || !apiHash || !phone) {
    throw new Error("Thieu TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_PHONE");
  }

  return { api_id: apiId, api_hash: apiHash, phone, session };
}

function formatDate(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(Number(dateValue) * 1000);
  return date.toLocaleString("vi-VN", { hour12: false });
}

function senderName(sender) {
  if (!sender) return "unknown";
  const firstName = sender.firstName || "";
  const lastName = sender.lastName || "";
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || sender.username || sender.id?.toString?.() || "unknown";
}

function normalizeText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function parseSignal(text) {
  if (!text) {
    return null;
  }

  const signalMatch = text.match(SIGNAL_PATTERN);
  if (!signalMatch) {
    return null;
  }

  return {
    signal: signalMatch[1],
    round: signalMatch[2],
    raw: text,
  };
}

// Lay tat ca tin nhan co id > afterId, phan trang bang maxId de khong bo sot
// khi co nhieu hon MESSAGE_FETCH_LIMIT tin moi giua 2 lan poll.
async function fetchNewMessages(client, entity, afterId) {
  const collected = new Map();
  let maxId = 0;

  for (let page = 0; page < MESSAGE_FETCH_MAX_PAGES; page += 1) {
    const batch = await client.getMessages(entity, {
      limit: MESSAGE_FETCH_LIMIT,
      minId: afterId,
      ...(maxId ? { maxId } : {}),
    });

    if (!batch.length) break;

    for (const message of batch) {
      collected.set(message.id, message);
    }

    if (batch.length < MESSAGE_FETCH_LIMIT) break;

    const smallestId = batch.reduce((min, message) => (message.id < min ? message.id : min), batch[0].id);
    if (maxId && smallestId >= maxId) break;
    maxId = smallestId;
  }

  return [...collected.values()].sort((a, b) => a.id - b.id);
}

function formatMoney(amount) {
  return `${Number(amount || 0).toLocaleString("vi-VN")} đ`;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}p ${seconds}s`;
}

function localDayKey(timestampMs) {
  const date = new Date(timestampMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localHourKey(timestampMs) {
  const date = new Date(timestampMs);
  return `${localDayKey(timestampMs)}-${String(date.getHours()).padStart(2, "0")}`;
}

async function main() {
  if (!acquireWatcherLock()) {
    process.exit(0);
  }

  let botService = null;
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (signal) console.log(`[watcher] Nhan ${signal}, dang dung tool...`);
    try {
      botService?.shutdown?.();
    } catch (err) {
      console.error("[Bot] Loi khi dung bot:", err?.message || err);
    }
    releaseWatcherLock();
    process.exit(0);
  };

  process.on("exit", () => releaseWatcherLock());
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const saved = loadSessionData();
  const config = await askConfig(saved);
  const savedState = loadToolState();
  let loginPaused = savedState.loginPaused === true;
  let autoBetEnabled = !loginPaused;
  let martingaleStep = 0;
  let consecutiveWins = 0;
  let betSteps = envBetSteps("BET_STEPS")
    || (Array.isArray(savedState.betSteps) && savedState.betSteps.length ? [...savedState.betSteps] : [...DEFAULT_BET_STEPS]);
  let lastResultText = null;
  let cycleStartBalance = 0;

  let pauseReason = savedState.pauseReason || null;
  let pauseUntil = Number(savedState.pauseUntil || 0);
  let dayStartedAt = Number(savedState.dayStartedAt || 0);
  let hourStartedAt = Number(savedState.hourStartedAt || 0);
  let dayStartBalance = savedState.dayStartBalance ?? null;
  let hourStartBalance = savedState.hourStartBalance ?? null;
  let lastLimits = savedState.lastLimits ?? null;
  let targetDayProfit = envPositiveNumber("TARGET_DAY_PROFIT", savedState.limits?.targetDayProfit ?? DEFAULT_TARGET_DAY_PROFIT);
  let targetHourProfit = envPositiveNumber("TARGET_HOUR_PROFIT", savedState.limits?.targetHourProfit ?? DEFAULT_TARGET_HOUR_PROFIT);
  let dayLossLimit = envPositiveNumber("DAY_LOSS_LIMIT", savedState.limits?.dayLossLimit ?? DEFAULT_DAY_LOSS_LIMIT);
  let hourLossLimit = envPositiveNumber("HOUR_LOSS_LIMIT", savedState.limits?.hourLossLimit ?? DEFAULT_HOUR_LOSS_LIMIT);
  let lastDayKey = "";
  let lastHourKey = "";
  const initNowMs = Date.now();
  if (!dayStartedAt) dayStartedAt = initNowMs;
  if (!hourStartedAt) hourStartedAt = initNowMs;
  lastDayKey = localDayKey(dayStartedAt);
  lastHourKey = localHourKey(hourStartedAt);

  const getCycleProfit = async () => {
    const balance = await getDropBalance({ interactive: false });
    return { balance, profit: balance - cycleStartBalance };
  };

  const startNewCycle = async ({ resetStep = true } = {}) => {
    loginPaused = false;
    pauseReason = null;
    pauseUntil = 0;
    saveToolState({ loginPaused, pauseReason, pauseUntil });
    await ensureDropApiLogin({ interactive: true, forceRefresh: true });
    cycleStartBalance = await getDropBalance({ interactive: false });
    if (dayStartBalance === null) dayStartBalance = cycleStartBalance;
    if (hourStartBalance === null) hourStartBalance = cycleStartBalance;
    saveToolState({ dayStartBalance, hourStartBalance });
    autoBetEnabled = true;
    if (resetStep) {
      martingaleStep = 0;
      consecutiveWins = 0;
    }
    console.log(`[cycle] Bat dau chu ky moi. Von dau: ${formatMoney(cycleStartBalance)}`);
  };

  const syncTimeWindows = () => {
    const now = Date.now();
    const dayKey = localDayKey(now);
    const hourKey = localHourKey(now);
    const dayChanged = dayKey !== lastDayKey;
    const hourChanged = hourKey !== lastHourKey;

    if (dayChanged) {
      if (pauseReason === "DAY_TARGET") {
        console.log("[limits] Sang ngay moi, reset muc tieu ngay. Quay lai dat cuoc.");
        pauseReason = null;
        pauseUntil = 0;
      }
      dayStartedAt = now;
      dayStartBalance = null;
    }
    if (hourChanged || dayChanged) {
      hourStartedAt = now;
      hourStartBalance = null;
    }
    if (dayChanged || hourChanged) {
      lastDayKey = dayKey;
      lastHourKey = hourKey;
      saveToolState({
        dayStartedAt,
        hourStartedAt,
        dayStartBalance,
        hourStartBalance,
        pauseReason,
        pauseUntil: pauseUntil || 0,
        limits: { targetDayProfit, targetHourProfit, dayLossLimit, hourLossLimit },
      });
    }
  };

  const isTimePaused = () => {
    if (!pauseReason) return false;
    if (pauseReason === "HOUR_TARGET" || pauseReason === "HOUR_LOSS") {
      return !(pauseUntil > 0 && Date.now() >= pauseUntil);
    }
    return true;
  };

  const resumeFromHourPauseIfDue = async () => {
    syncTimeWindows();
    if (pauseReason !== "HOUR_TARGET" && pauseReason !== "HOUR_LOSS") return;
    if (!(pauseUntil > 0 && Date.now() >= pauseUntil)) return;

    pauseReason = null;
    pauseUntil = 0;
    // Reset moc do lai lai/lo cua gio. Neu giu moc cu, lai gio van dang
    // vuot nguong nen enforceTimeLimits se pause lai ngay lap tuc.
    hourStartedAt = Date.now();
    try {
      hourStartBalance = await getDropBalance({ interactive: false });
    } catch {
      hourStartBalance = null;
    }
    if (lastLimits) {
      lastLimits = { ...lastLimits, hourProfit: 0, updatedAt: Date.now() };
    }
    saveToolState({
      pauseReason,
      pauseUntil,
      hourStartedAt,
      hourStartBalance,
      ...(lastLimits ? { lastLimits } : {}),
    });
    console.log("[limits] Da het thoi gian nghi, quay lai dat cuoc (reset moc lai gio).");
    if (botService) {
      void botService.notifyLimitsResume({
        dayProfit: lastLimits?.dayProfit ?? null,
        hourProfit: lastLimits?.hourProfit ?? null,
      }).catch((err) => console.error("[Bot] notifyLimitsResume error:", err?.message || err));
    }
  };

  const enforceTimeLimits = async (balance) => {
    if (loginPaused) return;

    const now = Date.now();
    syncTimeWindows();
    if (dayStartBalance === null) dayStartBalance = balance;
    if (hourStartBalance === null) hourStartBalance = balance;

    const dayProfit = balance - dayStartBalance;
    const hourProfit = balance - hourStartBalance;
    lastLimits = { dayProfit, hourProfit, balance, updatedAt: now };
    saveToolState({ dayStartBalance, hourStartBalance, lastLimits });

    if (pauseReason) return;

    let hitReason = null;
    if (dayProfit >= targetDayProfit) hitReason = "DAY_TARGET";
    else if (dayProfit <= -dayLossLimit) hitReason = "DAY_LOSS";
    else if (hourProfit >= targetHourProfit) hitReason = "HOUR_TARGET";
    else if (hourProfit <= -hourLossLimit) hitReason = "HOUR_LOSS";

    if (!hitReason) return;

    pauseReason = hitReason;
    const pauseMinutes = hitReason === "HOUR_TARGET" ? TARGET_HOUR_PAUSE_MINUTES : HOUR_PAUSE_MINUTES;
    pauseUntil = hitReason === "HOUR_TARGET" || hitReason === "HOUR_LOSS" ? now + (hitReason === "HOUR_TARGET" ? TARGET_HOUR_PAUSE_MS : HOUR_PAUSE_MS) : 0;
    saveToolState({
      pauseReason,
      pauseUntil,
      limits: { targetDayProfit, targetHourProfit, dayLossLimit, hourLossLimit },
    });
    console.log(`[limits] Cham muc ${hitReason} (loi hom nay: ${formatMoney(dayProfit)}, loi gio nay: ${formatMoney(hourProfit)}). ${hitReason.startsWith("HOUR") ? `Nghi ${pauseMinutes} phut roi tu dong quay lai.` : "Dung dat cuoc."}`);
    if (botService) {
      await botService.notifyLimitsPause({
        reason: hitReason,
        dayProfit,
        hourProfit,
      }).catch((err) => console.error("[Bot] notifyLimitsPause error:", err?.message || err));
    }
  };

  const checkCycleLimits = async () => {
    if (loginPaused) return null;

    const cycle = await getCycleProfit();
    await enforceTimeLimits(cycle.balance);
    return cycle;
  };

  if (loginPaused) {
    console.log("[cycle] Dang tam dung dang nhap game do lenh /stop. Gui /start de dang nhap lai.");
  } else {
    await startNewCycle();
  }
  botService = await startTelegramBotService({
    onBalanceRequest: async () => {
      if (loginPaused) throw new Error("Dang dung dang nhap game. Gui /start de dang nhap lai.");
      return getDropBalance({ interactive: false });
    },
    onStartBetting: async ({ reset } = {}) => {
      await startNewCycle({ resetStep: reset !== false });
    },
    onStopBetting: async () => {
      await logoutDropApi();
      loginPaused = true;
      autoBetEnabled = false;
      saveToolState({ loginPaused });
    },
    onSetBetSteps: async (steps) => {
      const nextSteps = Array.isArray(steps) && steps.length > 0 ? steps : DEFAULT_BET_STEPS;
      betSteps = [...nextSteps];
      martingaleStep = 0;
      saveToolState({ betSteps: [...betSteps] });
    },
    onSetLimits: async (nextLimits = {}) => {
      const next = {
        targetDayProfit: nextLimits.targetDayProfit ?? DEFAULT_TARGET_DAY_PROFIT,
        targetHourProfit: nextLimits.targetHourProfit ?? DEFAULT_TARGET_HOUR_PROFIT,
        dayLossLimit: nextLimits.dayLossLimit ?? DEFAULT_DAY_LOSS_LIMIT,
        hourLossLimit: nextLimits.hourLossLimit ?? DEFAULT_HOUR_LOSS_LIMIT,
      };
      targetDayProfit = next.targetDayProfit;
      targetHourProfit = next.targetHourProfit;
      dayLossLimit = next.dayLossLimit;
      hourLossLimit = next.hourLossLimit;
      saveToolState({
        loginPaused,
        pauseReason,
        pauseUntil: pauseUntil || 0,
        limits: next,
      });
      return { ...next };
    },
    getLoginPaused: () => loginPaused,
    getBettingEnabled: () => autoBetEnabled,
    getBetSteps: () => [...betSteps],
    getMartingaleStep: () => martingaleStep,
    getDayTargetProfit: () => targetDayProfit,
    getHourTargetProfit: () => targetHourProfit,
    getDayLossLimit: () => dayLossLimit,
    getHourLossLimit: () => hourLossLimit,
    getDayProfit: () => lastLimits?.dayProfit ?? null,
    getHourProfit: () => lastLimits?.hourProfit ?? null,
    getPauseReason: () => pauseReason,
    getPauseUntil: () => pauseUntil,
    getHourPauseMinutes: () => pauseReason === "HOUR_TARGET" ? TARGET_HOUR_PAUSE_MINUTES : HOUR_PAUSE_MINUTES,
    getCycleStartBalance: () => cycleStartBalance,
  });

  if (botService) {
    try {
      await botService.notifyStartupSuccess();
    } catch (err) {
      console.error("[Bot] notifyStartupSuccess error:", err?.message || err);
    }
  }

  const stringSession = new StringSession(config.session);

  const client = new TelegramClient(stringSession, config.api_id, config.api_hash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => config.phone,
    password: async () => input.password("Nhap mat khau 2FA (neu co): "),
    phoneCode: async () => input.text("Nhap ma xac minh Telegram: "),
    onError: (err) => {
      throw err;
    },
  });

  const currentSession = client.session.save();
  saveSessionData({
    session: currentSession,
    api_id: String(config.api_id),
    api_hash: config.api_hash,
    phone: config.phone,
  });
  if (currentSession !== config.session) {
    console.log(`Da cap nhat session dang nhap 1 lan vao ${SESSION_PATH}\n`);
  }

  const entity = await client.getEntity(TARGET_GROUP_USERNAME);
  let lastSeenId = 0;

  const [latestMessage] = await client.getMessages(entity, { limit: 1 });
  lastSeenId = latestMessage?.id || 0;

  console.log(`Dang theo doi group mac dinh: ${TARGET_GROUP_NAME}`);
  console.log(`ID: ${TARGET_GROUP_ID}`);
  console.log(`Username: @${TARGET_GROUP_USERNAME}`);
  console.log(`Polling moi ${POLL_INTERVAL_MS}ms. Nhan Ctrl+C de dung.`);
  console.log(`Moc tin nhan ban dau: ${lastSeenId} (tin cu hon se bo qua).`);
  console.log("Chi lay tin nhan co cau truc: THUA/THANG + Hay danh LON/NHO + Ky xo hien tai\n");

  while (true) {
    try {
      await resumeFromHourPauseIfDue();

      const freshMessages = await fetchNewMessages(client, entity, lastSeenId);

      for (const message of freshMessages) {
        // Tien moc ngay khi nhan tin de loi giua chung khong lam replay tin
        // (replay co the dat cuoc 2 lan).
        lastSeenId = Math.max(lastSeenId, message.id);

        if (loginPaused) {
          continue;
        }

        const text = message.message || "";
        const sender = await message.getSender();
        const senderUsername = sender.username || "";
        const senderId = sender.id?.toString?.() || "";

        // Phase 1: Chỉ lấy tin nhắn từ bot发放 tín hiệu (user ID 2111584638)
        if (senderId !== "2111584638" && senderUsername !== "vn168_command1_bot") {
          continue;
        }

        // Phase 2: Kiểm tra nội dung - tín hiệu hoặc kết quả
        const signalPattern = /Hãy đánh[\s\S]*?(NHỎ|LỚN)[\s\S]*?Kỳ xổ hiện tại\s*\d+/iu;
        const resultPattern = /Kết quả kỳ xổ\s*:\s*\d+\s*(NHỎ|LỚN)/iu;
        const hasSignal = signalPattern.test(text);
        const hasResult = resultPattern.test(text);

        if (!hasSignal && !hasResult) {
          continue;
        }

        // Phase 3: Bỏ qua tin nhắn chứa >= 2 tín hiệu
        if (hasSignal) {
          const signalCount = (text.match(/Hãy đánh[\s\S]*?(NHỎ|LỚN)/giu) || []).length;
          if (signalCount >= 2) {
            console.log(`[skip] Tin nhan co ${signalCount} tin hieu, bo qua`);
            continue;
          }
        }

        const normalized = normalizeText(text);

        // Phase 4: parse signal chính thức
        const parsed = parseSignal(text);

        // Phase 5: update multiplier from result message.
        let processedResult = false;

        if (hasResult && (WIN_PATTERN.test(text) || normalized.includes("THANG") || normalized.includes("WIN"))) {
          processedResult = true;
          lastResultText = "THẮNG";
          consecutiveWins += 1;
          if (consecutiveWins >= 3) {
            martingaleStep = 0;
            consecutiveWins = 0;
            console.log(`[result] THANG 3 ky lien tiep -> ve muc 1 (chot lai), x${betSteps[0]}`);
          } else if (consecutiveWins >= 2) {
            const wasFinalStep = martingaleStep >= betSteps.length - 1;
            if (wasFinalStep) {
              console.log(`[result] THANG lan 2 lien tiep (max step) -> giu muc cuoi, x${betSteps[martingaleStep]}`);
            } else {
              martingaleStep += 1;
              console.log(`[result] THANG lan 2 lien tiep -> len 1 muc, x${betSteps[martingaleStep]}`);
            }
          } else {
            console.log(`[result] THANG lan 1 -> giu nguyen bac, x${betSteps[martingaleStep]}`);
          }
          const cycle = await checkCycleLimits().catch((err) => {
            console.error("[cycle] Khong kiem tra duoc gioi han sau THANG:", err?.message || err);
            return null;
          });
          if (botService) {
            void botService.notifyResult({
              resultType: "WIN",
              newStep: martingaleStep,
              multiplier: betSteps[martingaleStep],
              dayProfit: lastLimits?.dayProfit ?? null,
              hourProfit: lastLimits?.hourProfit ?? null,
            }).catch((err) => console.error("[Bot] notifyResult WIN error:", err?.message || err));
          }
        }

        if (hasResult && (LOSE_PATTERN.test(text) || normalized.includes("THUA") || normalized.includes("LOSE") || normalized.includes("LOST"))) {
          processedResult = true;
          lastResultText = "THUA";
          martingaleStep = 0;
          consecutiveWins = 0;
          console.log(`[result] THUA -> ve muc 1, x${betSteps[martingaleStep]}`);
          const cycle = await checkCycleLimits().catch((err) => {
            console.error("[cycle] Khong kiem tra duoc gioi han sau THUA:", err?.message || err);
            return null;
          });
          if (botService) {
            void botService.notifyResult({
              resultType: "LOSE",
              newStep: martingaleStep,
              multiplier: betSteps[martingaleStep],
              dayProfit: lastLimits?.dayProfit ?? null,
              hourProfit: lastLimits?.hourProfit ?? null,
            }).catch((err) => console.error("[Bot] notifyResult LOSE error:", err?.message || err));
          }
        }

        if (!parsed) {
          continue;
        }

        const betCount = betSteps[martingaleStep];
        const betMoney = betCount * 1000;
        const suffix = `x${betCount}`;

        let betStatus = "paused";
        let balanceText = "unavailable";
        let cycleProfit = null;

        if (loginPaused) {
          betStatus = "paused (/stop da tat dang nhap game, gui /start de dang nhap lai)";
        } else if (!autoBetEnabled) {
          betStatus = "paused (auto bet dang tat, gui /start de bat lai)";
        } else if (isTimePaused()) {
          betStatus = pauseReason === "DAY_LOSS"
            ? "paused (cham gioi han lo ngay, can /start de tiep tuc)"
            : pauseReason === "DAY_TARGET"
              ? "paused (dat muc tieu lai ngay, dung den het ngay)"
              : `paused (dang nghi ${pauseReason === "HOUR_TARGET" ? TARGET_HOUR_PAUSE_MINUTES : HOUR_PAUSE_MINUTES} phut do muc ${pauseReason})`;
        } else {
          try {
            const betResult = await placeDropBet({
              issueNumber: parsed.round,
              signal: parsed.signal,
              betCount,
            }, { interactive: false });
            betStatus = betResult.success
              ? `success (${betResult.issueNumber})`
              : `failed (${betResult.message})`;
          } catch (err) {
            betStatus = `failed (${err?.message || err})`;
          }
        }

        try {
          const cycle = await checkCycleLimits();
          const balance = cycle?.balance ?? await getDropBalance({ interactive: false });
          cycleProfit = cycle?.profit ?? balance - cycleStartBalance;
          balanceText = `${balance.toLocaleString("vi-VN")} đ`;
        } catch (err) {
          balanceText = `unavailable (${err?.message || err})`;
        }

        console.log("----------------------------------------");
        console.log(`Time: ${formatDate(message.date)}`);
        console.log(`From: ${senderName(sender)}`);
        console.log(`Message ID: ${message.id}`);
        console.log(`Round: ${parsed.round}`);
        console.log(`Signal: ${parsed.signal} ${suffix}`);
        console.log(`Bet Money: ${betMoney.toLocaleString("vi-VN")} đ`);
        console.log(`Bet: ${betStatus}`);
        console.log(`Balance: ${balanceText}`);
        if (cycleProfit !== null) console.log(`Cycle Profit: ${formatMoney(cycleProfit)}`);
        if (lastLimits) {
          console.log(`Day Profit: ${formatMoney(lastLimits.dayProfit)} / ${formatMoney(targetDayProfit)} | Hour Profit: ${formatMoney(lastLimits.hourProfit)} / ${formatMoney(targetHourProfit)}`);
        }

        if (botService) {
          try {
            await botService.notifyBetUpdate({
              multiplier: betCount,
              betMoney,
              betStatus,
              balanceText,
              resultText: lastResultText,
              dayProfit: lastLimits?.dayProfit ?? null,
              hourProfit: lastLimits?.hourProfit ?? null,
              pauseReason,
              pauseUntil,
            });
          } catch (err) {
            console.error("[Bot] Notify error:", err?.message || err);
          }
        }
      }

    } catch (err) {
      console.error("Loi khi lay tin nhan:", err?.message || err);

      try {
        if (!client.connected) {
          console.log("[Telegram] Mat ket noi, dang reconnect...");
          await client.connect();
          console.log("[Telegram] Reconnect thanh cong.");
        }
      } catch (reconnectErr) {
        console.error("[Telegram] Reconnect that bai:", reconnectErr?.message || reconnectErr);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error("Loi:", err?.message || err);
  process.exit(1);
});
