import fs from "node:fs";
import path from "node:path";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";

const SESSION_PATH = path.resolve("telegram_session.txt");
const TARGET_GROUP_USERNAME = "vn168wingoo";
const DUMP_LOG_PATH = path.resolve("debug_message_dump.log");
const POLL_INTERVAL_MS = 1000;

// Regex patterns - sao chep tu watch_group_messages.js de test
const SIGNAL_PATTERN = /Hãy đánh[\s\S]*?(NHỎ|LỚN)[\s\S]*Kỳ xổ hiện tại\s*(\d+)/iu;
const SIGNAL_PATTERN_PHASE2 = /Hãy đánh[\s\S]*?(NHỎ|LỚN)[\s\S]*?Kỳ xổ hiện tại\s*\d+/iu;
const SIGNAL_COUNT_PATTERN = /Hãy đánh[\s\S]*?(NHỎ|LỚN)/giu;
const RESULT_PATTERN = /Kết quả kỳ xổ\s*:\s*\d+\s*(NHỎ|LỚN)/iu;
const LOSE_PATTERN = /(THUA|LOSE|LOST)/iu;
const WIN_PATTERN = /(THẮNG|THANG|WIN)/iu;

function loadSessionData() {
  if (!fs.existsSync(SESSION_PATH)) {
    return { session: "", api_id: "", api_hash: "", phone: "" };
  }
  const raw = fs.readFileSync(SESSION_PATH, "utf8").trim();
  if (!raw) return { session: "", api_id: "", api_hash: "", phone: "" };
  try { return JSON.parse(raw); }
  catch { return { session: raw, api_id: "", api_hash: "", phone: "" }; }
}

async function askConfig(saved) {
  const apiId = Number(process.env.TELEGRAM_API_ID || saved.api_id || (await input.text("Nhap TELEGRAM_API_ID: ")));
  const apiHash = process.env.TELEGRAM_API_HASH || saved.api_hash || (await input.password("Nhap TELEGRAM_API_HASH: "));
  const phone = process.env.TELEGRAM_PHONE || saved.phone || (await input.text("Nhap so dien thoai Telegram: "));
  const session = process.env.TELEGRAM_SESSION || saved.session || "";
  if (!apiId || !apiHash || !phone) throw new Error("Thieu thong tin dang nhap Telegram");
  return { api_id: apiId, api_hash: apiHash, phone, session };
}

function senderName(sender) {
  if (!sender) return "unknown";
  return `${sender.firstName || ""} ${sender.lastName || ""}`.trim() || sender.username || sender.id?.toString?.() || "unknown";
}

const lines = [];
function log(line) {
  const stamp = new Date().toISOString();
  const full = `[${stamp}] ${line}`;
  console.log(full);
  lines.push(full);
}

function flushLog() {
  fs.writeFileSync(DUMP_LOG_PATH, lines.join("\n") + "\n", "utf8");
}

function testMessage(text, senderUsername) {
  const results = [];

  // Phase 1
  const phase1Pass = senderUsername === "vn168_command1_bot";
  results.push(`  Phase1 (sender=vn168_command1_bot): ${phase1Pass ? "PASS" : "SKIP"} (actual: ${senderUsername})`);

  if (!phase1Pass) return results;

  // Phase 2 - test ca 2 pattern
  const hasSignal_phase2 = SIGNAL_PATTERN_PHASE2.test(text);
  const hasResult = RESULT_PATTERN.test(text);
  const hasSignal_global = SIGNAL_PATTERN.test(text);
  const signalCount = (text.match(SIGNAL_COUNT_PATTERN) || []).length;

  results.push(`  Phase2 (local pattern):  ${hasSignal_phase2 ? "SIGNAL" : "no-signal"}`);
  results.push(`  Phase2 (global SIGNAL):  ${hasSignal_global ? "SIGNAL" : "no-signal"}`);
  results.push(`  Phase2 (result pattern): ${hasResult ? "RESULT" : "no-result"}`);
  results.push(`  Phase3 (signal count):   ${signalCount} ${signalCount >= 2 ? "(SKIP - too many)" : ""}`);

  // Neu co signal, test parseSignal pattern
  if (hasSignal_global) {
    const m = text.match(SIGNAL_PATTERN);
    if (m) {
      results.push(`  ParseSignal: signal=${m[1]}, round=${m[2]}`);
    } else {
      results.push(`  ParseSignal: KHONG MATCH (!!!)`);
    }
  }

  // Win/Lose
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const isWin = WIN_PATTERN.test(text) || normalized.includes("THANG") || normalized.includes("WIN");
  const isLose = LOSE_PATTERN.test(text) || normalized.includes("THUA") || normalized.includes("LOSE") || normalized.includes("LOST");
  if (isWin) results.push(`  Result: WIN`);
  if (isLose) results.push(`  Result: LOSE`);

  return results;
}

async function main() {
  const saved = loadSessionData();
  const config = await askConfig(saved);

  log("=== BAT DAU DEBUG MESSAGE DUMP ===");
  log(`Group: @${TARGET_GROUP_USERNAME}`);
  log(`Log file: ${DUMP_LOG_PATH}`);
  log("");

  const stringSession = new StringSession(config.session);
  const client = new TelegramClient(stringSession, config.api_id, config.api_hash, { connectionRetries: 5 });

  await client.start({
    phoneNumber: async () => config.phone,
    password: async () => input.password("Nhap mat khau 2FA (neu co): "),
    phoneCode: async () => input.text("Nhap ma xac minh Telegram: "),
    onError: (err) => { throw err; },
  });

  const currentSession = client.session.save();
  fs.writeFileSync(SESSION_PATH, JSON.stringify({
    session: currentSession, api_id: String(config.api_id),
    api_hash: config.api_hash, phone: config.phone,
  }, null, 2), "utf8");

  const entity = await client.getEntity(TARGET_GROUP_USERNAME);
  let lastSeenId = 0;

  // Lay 100 tin nhan gan nhat de phan tich
  log("=== LAY 100 TIN NHAN GAN NHAT ===");
  const initial = await client.getMessages(entity, { limit: 100 });
  let signalCount = 0;
  let resultCount = 0;
  let botMessageCount = 0;
  let otherMessageCount = 0;

  for (const msg of initial) {
    const text = msg.message || "";
    const sender = await msg.getSender();
    const username = sender?.username || "N/A";
    const name = senderName(sender);

    if (username === "vn168_command1_bot") botMessageCount++;
    else otherMessageCount++;

    if (!text) continue;

    const tests = testMessage(text, username);
    const hasSignal = SIGNAL_PATTERN_PHASE2.test(text) || SIGNAL_PATTERN.test(text);
    const hasResult = RESULT_PATTERN.test(text);

    if (hasSignal) signalCount++;
    if (hasResult) resultCount++;

    // Chi log tin nhan tu bot hoac co signal/result de giam noise
    if (username === "vn168_command1_bot" || hasSignal || hasResult) {
      log(`\n--- ID=${msg.id} | time=${new Date(msg.date * 1000).toLocaleString("vi-VN")} | user=${name} (@${username})`);
      log(`TEXT START >>>`);
      log(text);
      log(`<<< TEXT END`);
      for (const t of tests) log(t);
    }

    if (msg.id > lastSeenId) lastSeenId = msg.id;
  }

  log(`\n=== THONG KE ===`);
  log(`Tong tin nhan: ${initial.length}`);
  log(`Tin tu vn168_command1_bot: ${botMessageCount}`);
  log(`Tin tu nguoi khac: ${otherMessageCount}`);
  log(`Tin co signal: ${signalCount}`);
  log(`Tin co result: ${resultCount}`);
  log(`lastSeenId: ${lastSeenId}`);

  flushLog();
  log(`\nDa luu vao: ${DUMP_LOG_PATH}`);
  log("=== HOAN TAT - KIEM TRA FILE LOG ===");
}

main().catch((err) => {
  console.error("FATAL:", err);
  fs.appendFileSync(DUMP_LOG_PATH, `\n[FATAL] ${err?.message || err}\n`, "utf8");
  process.exit(1);
});
