/**
 * Dang nhap Telegram tu web dashboard.
 * - Doc cau hinh tu telegram_session.txt (JSON) hoac env TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_PHONE.
 * - Prompt duoc in ra stdout theo tung dong, input doc tu stdin (web gui vao).
 * - Luu session JSON vao telegram_session.txt khi thanh cong.
 *
 * Chay truc tiep: node telegram_login.js
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const SESSION_PATH = path.resolve("telegram_session.txt");

function loadSessionData() {
  if (!fs.existsSync(SESSION_PATH)) {
    return { session: "", api_id: "", api_hash: "", phone: "" };
  }

  const raw = fs.readFileSync(SESSION_PATH, "utf8").trim();
  if (!raw) {
    return { session: "", api_id: "", api_hash: "", phone: "" };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      session: parsed.session || "",
      api_id: parsed.api_id || "",
      api_hash: parsed.api_hash || "",
      phone: parsed.phone || "",
    };
  } catch {
    return { session: raw, api_id: "", api_hash: "", phone: "" };
  }
}

function saveSessionData(data) {
  fs.writeFileSync(
    SESSION_PATH,
    JSON.stringify(
      {
        session: data.session || "",
        api_id: data.api_id ? String(data.api_id) : "",
        api_hash: data.api_hash || "",
        phone: data.phone || "",
      },
      null,
      2,
    ),
    "utf8",
  );
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function askLine() {
  return new Promise((resolve) => rl.question("", (answer) => resolve(String(answer || "").trim())));
}

async function askValue(label, envValue, savedValue, { secret = false } = {}) {
  if (envValue) return String(envValue).trim();
  if (savedValue) return String(savedValue).trim();

  console.log(label);
  const answer = await askLine();
  if (!answer) {
    throw new Error(`Thieu gia tri cho ${label.replace(/:$/, "")}`);
  }
  if (secret) console.log("(da nhap, khong hien thi)");
  return answer;
}

async function main() {
  const saved = loadSessionData();

  const apiId = Number(
    await askValue("Nhap TELEGRAM_API_ID:", process.env.TELEGRAM_API_ID, saved.api_id),
  );
  const apiHash = await askValue("Nhap TELEGRAM_API_HASH:", process.env.TELEGRAM_API_HASH, saved.api_hash);
  const phone = await askValue(
    "Nhap so dien thoai Telegram (vd +8490xxxxxxx):",
    process.env.TELEGRAM_PHONE,
    saved.phone,
  );

  if (!apiId || !apiHash || !phone) {
    throw new Error("Thieu TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_PHONE");
  }

  const client = new TelegramClient(new StringSession(saved.session), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => phone,
    password: async () => {
      console.log("Nhap mat khau 2FA (neu co):");
      return askLine();
    },
    phoneCode: async () => {
      console.log("Nhap ma xac minh Telegram:");
      return askLine();
    },
    onError: (err) => {
      throw err;
    },
  });

  const session = client.session.save();
  saveSessionData({
    session,
    api_id: String(apiId),
    api_hash: apiHash,
    phone,
  });

  console.log(`[login] Dang nhap thanh cong. Da luu session vao ${SESSION_PATH}`);
  await client.disconnect().catch(() => {});
  rl.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[login] That bai: ${err?.message || err}`);
    rl.close();
    process.exit(1);
  });
