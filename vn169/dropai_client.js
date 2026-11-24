import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import input from "input";

const GAME_API_BASE = "https://vn168api.com/api/webapi";
const GAME_DEVICE_ID = "fd52ea6688df74da7e2bafaf4d6ecd48";
const TELEGRAM_CONFIG_PATH = path.resolve("telegram_config.json");
const AUTH_CACHE_PATH = path.resolve("dropai_auth.json");
const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
  Origin: "https://387vn.com",
  Referer: "https://387vn.com/",
  "Ar-Origin": "https://387vn.com",
  Accept: "application/json, text/plain, */*",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

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

function loadTelegramConfig() {
  return readJsonFile(TELEGRAM_CONFIG_PATH, {});
}

function saveTelegramConfig(config) {
  writeJsonFile(TELEGRAM_CONFIG_PATH, config);
}

function loadAuthCache() {
  return readJsonFile(AUTH_CACHE_PATH, {});
}

function saveAuthCache(auth) {
  writeJsonFile(AUTH_CACHE_PATH, auth);
}

function createDropSignature(data) {
  const exclude = new Set(["signature", "track", "xosoBettingData", "timestamp"]);
  const entries = [];

  for (const key of Object.keys(data).sort()) {
    if (exclude.has(key)) continue;

    const value = data[key];
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.length === 0) continue;

    let valueText;
    if (typeof value === "string") {
      valueText = JSON.stringify(value);
    } else if (typeof value === "boolean") {
      valueText = value ? "true" : "false";
    } else {
      valueText = String(value);
    }

    entries.push(`${JSON.stringify(key)}:${valueText}`);
  }

  const rawPayload = `{${entries.join(",")}}`;
  return createHash("md5").update(rawPayload, "utf8").digest("hex").toUpperCase();
}

function createSignedBody(body) {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = {
    ...body,
    random: body.random || randomUUID().replace(/-/g, "").toLowerCase(),
    timestamp,
  };

  return {
    ...payload,
    signature: createDropSignature(payload),
  };
}

async function resolveCredentials(interactive = true) {
  const config = loadTelegramConfig();
  let username = process.env.DROP_USERNAME || config.drop_username || "";
  let password = process.env.DROP_PASSWORD || config.drop_password || "";

  if (interactive && !username) {
    username = await input.text("Nhap DROP username (game): ");
  }
  if (interactive && !password) {
    password = await input.password("Nhap DROP password (game): ");
  }

  if (!username || !password) {
    return null;
  }

  if (config.drop_username !== username || config.drop_password !== password) {
    saveTelegramConfig({ ...config, drop_username: username, drop_password: password });
  }

  return { username, password };
}

async function performLogin(credentials) {
  const body = createSignedBody({
    username: credentials.username,
    pwd: credentials.password,
    phonetype: 0,
    logintype: "mobile",
    packId: "",
    deviceId: GAME_DEVICE_ID,
    language: 2,
  });

  const response = await fetch(`${GAME_API_BASE}/Login`, {
    method: "POST",
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(body),
  });

  const json = await response.json().catch(() => null);
  if (!json || json.code !== 0 || !json.data?.token) {
    const msg = json?.msg || `HTTP ${response.status}`;
    throw new Error(`DropAPI login failed: ${msg}`);
  }

  const auth = {
    token: json.data.token,
    username: credentials.username,
    createdAt: new Date().toISOString(),
  };
  saveAuthCache(auth);
  console.log(`[DropAPI] Login success for ${credentials.username}`);
  return auth;
}

export async function ensureDropApiLogin(options = {}) {
  const { interactive = true, forceRefresh = false } = options;
  const credentials = await resolveCredentials(interactive);
  if (!credentials) {
    console.log("[DropAPI] Skip login: missing game credentials");
    return null;
  }

  if (!forceRefresh) {
    const cached = loadAuthCache();
    if (cached?.token && cached?.username === credentials.username) {
      return cached;
    }
  }

  return performLogin(credentials);
}

export async function logoutDropApi() {
  const auth = loadAuthCache();
  if (!auth?.token) {
    console.log("[DropAPI] Khong co token dang nhap de logout.");
    return false;
  }

  try {
    const signedBody = createSignedBody({ language: 2 });
    await fetch(`${GAME_API_BASE}/Logout`, {
      method: "POST",
      headers: {
        ...DEFAULT_HEADERS,
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify(signedBody),
    });
  } catch (err) {
    console.error("[DropAPI] Goi logout API that bai (bo qua):", err?.message || err);
  }

  try {
    if (fs.existsSync(AUTH_CACHE_PATH)) {
      fs.unlinkSync(AUTH_CACHE_PATH);
      console.log("[DropAPI] Da xoa auth cache (logout thanh cong).");
    }
  } catch (err) {
    console.error("[DropAPI] Xoa auth cache that bai:", err?.message || err);
  }

  return true;
}

export async function callDropApi(endpoint, body = {}, options = {}) {
  const { interactive = true, retryOnAuthFailure = true } = options;
  let auth = await ensureDropApiLogin({ interactive });
  if (!auth?.token) {
    throw new Error("DropAPI auth unavailable");
  }

  const send = async (token) => {
    const signedBody = createSignedBody(body);
    const response = await fetch(`${GAME_API_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        ...DEFAULT_HEADERS,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(signedBody),
    });

    const json = await response.json().catch(() => null);
    return { response, json };
  };

  let result = await send(auth.token);
  const authFailed =
    !result.response.ok ||
    result.json?.msg?.toLowerCase?.().includes("token") ||
    result.json?.code === 401;

  if (authFailed && retryOnAuthFailure) {
    auth = await ensureDropApiLogin({ interactive, forceRefresh: true });
    if (!auth?.token) {
      throw new Error("DropAPI re-auth failed");
    }
    result = await send(auth.token);
  }

  return result;
}

export async function getDropBalance(options = {}) {
  const result = await callDropApi("/GetBalance", { language: 2 }, options);
  if (result.json?.code !== 0) {
    throw new Error(result.json?.msg || "GetBalance failed");
  }

  return Number(result.json?.data?.amount || 0);
}

export async function getCurrentIssueNumber(typeId = 1, options = {}) {
  const result = await callDropApi(
    "/GetNoaverageEmerdList",
    { typeId, pageSize: 5, pageNo: 1, language: 2 },
    options,
  );

  const list = result.json?.data?.list;
  const latestIssue = list?.[0]?.issueNumber;
  if (!latestIssue) {
    return null;
  }

  const nextIssue = (BigInt(String(latestIssue)) + 1n).toString();
  return nextIssue;
}

function parseIssueNumber(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  return BigInt(text);
}

function compareIssues(left, right) {
  if (left === null || right === null) return null;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function placeDropBet({
  typeId = 1,
  issueNumber,
  signal,
  betCount = 1,
  amount = 1000,
  retries = 10,
}, options = {}) {
  const normalizedSignal = String(signal).trim().toUpperCase();
  const isBig = normalizedSignal === "LỚN" || normalizedSignal === "LON" || normalizedSignal === "BIG";
  const isSmall = normalizedSignal === "NHỎ" || normalizedSignal === "NHO" || normalizedSignal === "SMALL";

  if (!isBig && !isSmall) {
    throw new Error("Invalid betting input");
  }

  const selectType = isBig ? 13 : 14;
  const targetIssue = parseIssueNumber(issueNumber);
  const attemptedIssues = new Set();
  let lastError = null;

  for (let attempt = 0; attempt < Math.max(1, retries); attempt += 1) {
    let currentIssueText = "";
    let currentIssue = null;

    try {
      currentIssueText = String((await getCurrentIssueNumber(typeId, options)) || "").trim();
      currentIssue = parseIssueNumber(currentIssueText);
    } catch (err) {
      // Loi tam thoi khi lay ky xo: cho 1s roi thu lai, chua dat cuoc.
      lastError = err;
      await sleep(1000);
      continue;
    }

    if (!currentIssueText) {
      lastError = new Error("Khong lay duoc ky xo hien tai");
      await sleep(1000);
      continue;
    }

    // Chi so sanh khi ca 2 deu la so; neu API doi format thi bo qua guard
    // de giu hanh vi cu (dat vao ky hien tai).
    const cmp = targetIssue !== null && currentIssue !== null
      ? compareIssues(targetIssue, currentIssue)
      : 0;

    if (cmp < 0) {
      // Tin hieu den tre, ky cua tin hieu da xo -> bo qua, khong dat vao ky sau.
      return {
        success: false,
        skipped: true,
        message: `Ky ${issueNumber} da xo (ky hien tai ${currentIssueText}), bo qua`,
        issueNumber: String(issueNumber || ""),
        raw: null,
      };
    }

    if (cmp > 0) {
      // Tin hieu cho ky chua mo -> cho den khi thanh ky hien tai.
      await sleep(1000);
      continue;
    }

    if (attemptedIssues.has(currentIssueText)) break;
    attemptedIssues.add(currentIssueText);

    const payload = {
      typeId,
      issuenumber: currentIssueText,
      amount,
      betCount,
      gameType: 2,
      selectType,
      language: 2,
    };

    let result;
    try {
      result = await callDropApi("/GameBetting", payload, options);
    } catch (err) {
      // Khong retry dat cuoc: response co the da duoc server xu ly, retry se
      // thanh dat 2 lan. Tra loi that bai va de vong sau xu ly.
      return {
        success: false,
        message: `Loi goi API dat cuoc: ${err?.message || err}`,
        issueNumber: currentIssueText,
        raw: null,
      };
    }

    const msgText = String(result.json?.msg || "");
    const success = result.json?.code === 0 && /succe/i.test(msgText);

    if (success) {
      return {
        success: true,
        message: msgText || "success",
        issueNumber: currentIssueText,
        raw: result.json,
      };
    }

    // Loi nghiep vu (ky da xo, het tien...): khong thu ky khac.
    return {
      success: false,
      message: msgText || `Dat cuoc that bai (code ${result.json?.code ?? "?"})`,
      issueNumber: currentIssueText,
      raw: result.json,
    };
  }

  return {
    success: false,
    message: lastError
      ? `Khong dat duoc cuoc: ${lastError?.message || lastError}`
      : "Het thoi gian cho ky xo moi",
    issueNumber: String(issueNumber || ""),
    raw: null,
  };
}

export { createDropSignature, loadAuthCache };
