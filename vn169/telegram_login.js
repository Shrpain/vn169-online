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
let lastTelegramError = "";

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

function normalizePhone(raw) {
  let value = String(raw || "").replace(/[\s\-().]/g, "");
  if (!value) return "";
  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  if (value.startsWith("0")) value = `+84${value.slice(1)}`;
  if (/^\d{9,15}$/.test(value)) value = `+${value}`;
  return value;
}

async function main() {
  const saved = loadSessionData();

  const apiId = Number(
    await askValue("Nhap TELEGRAM_API_ID:", process.env.TELEGRAM_API_ID, saved.api_id),
  );
  const apiHash = await askValue("Nhap TELEGRAM_API_HASH:", process.env.TELEGRAM_API_HASH, saved.api_hash);
  const phone = normalizePhone(
    await askValue("Nhap so dien thoai Telegram (vd +8490xxxxxxx):", process.env.TELEGRAM_PHONE, saved.phone),
  );

  if (!apiId || !apiHash || !phone) {
    throw new Error("Thieu TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_PHONE");
  }

  const forceSMS = String(process.env.TELEGRAM_FORCE_SMS || "") === "1";

  const client = new TelegramClient(new StringSession(saved.session), apiId, apiHash, {
    connectionRetries: 5,
  });

  console.log(`[login] Dang ket noi Telegram va gui ma xac minh toi ${phone}...`);
  if (forceSMS) console.log("[login] Che do: yeu cau gui ma qua SMS (forceSMS).");

  await client.start({
    phoneNumber: async () => phone,
    forceSMS,
    password: async (hint) => {
      console.log(hint ? `Nhap mat khau 2FA (goi y: ${hint}):` : "Nhap mat khau 2FA (neu co):");
      return askLine();
    },
    phoneCode: async (isCodeViaApp) => {
      if (isCodeViaApp) {
        console.log("[login] Telegram da gui ma VAO APP TELEGRAM (chat 'Telegram'), khong phai SMS.");
        console.log("[login] Mo Telegram tren dien thoai/may tinh khac de lay ma, roi nhap vao day.");
      } else {
        console.log("[login] Telegram da gui ma qua SMS toi so dien thoai.");
      }
      console.log("Nhap ma xac minh Telegram:");
      return askLine();
    },
    onError: (err) => {
      const message = String(err?.errorMessage || err?.message || err);
      lastTelegramError = message;
      console.log(`[login] Loi Telegram: ${message}`);

      if (/PHONE_CODE_(INVALID|EMPTY)/i.test(message)) {
        console.log("[login] Ma khong dung. Nhap lai ma:");
        return false;
      }
      if (/PHONE_CODE_EXPIRED/i.test(message)) {
        console.log("[login] Ma da het han. Bam Huy roi Bat dau lai de nhan ma moi.");
        return true;
      }
      if (/FLOOD/i.test(message)) {
        console.log("[login] Telegram dang gioi han (FLOOD_WAIT). Cho 5-10 phut roi thu lai.");
        return true;
      }
      if (/API_ID_INVALID|API_ID_PUBLISHED_FLOOD/i.test(message)) {
        console.log("[login] api_id/api_hash khong hop le. Kiem tra lai tai my.telegram.org.");
        return true;
      }
      if (/PHONE_NUMBER_INVALID/i.test(message)) {
        console.log("[login] So dien thoai khong hop le. Nhap lai kem ma quoc gia, vd +8490xxxxxxx.");
        return true;
      }
      return true;
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
    const message = String(err?.message || err);
    if (message === "AUTH_USER_CANCEL" && lastTelegramError) {
      console.log(`[login] Da dung do loi: ${lastTelegramError}`);
    } else {
      console.error(`[login] That bai: ${message}`);
    }
    rl.close();
    process.exit(1);
  });
