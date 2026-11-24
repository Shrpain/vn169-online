import fs from "node:fs";
import path from "node:path";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";

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
    // Format cu: file chi chua session string.
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

async function askConfig() {
  const saved = loadSessionData();
  const apiId = Number(process.env.TELEGRAM_API_ID || saved.api_id || (await input.text("Nhap TELEGRAM_API_ID: ")));
  const apiHash = process.env.TELEGRAM_API_HASH || saved.api_hash || (await input.password("Nhap TELEGRAM_API_HASH: "));
  const phone = process.env.TELEGRAM_PHONE || saved.phone || (await input.text("Nhap so dien thoai Telegram (vd +8490xxxxxxx): "));
  const session = process.env.TELEGRAM_SESSION || saved.session || "";

  if (!apiId || !apiHash || !phone) {
    throw new Error("Thieu TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_PHONE");
  }

  return { api_id: apiId, api_hash: apiHash, phone, session };
}

async function main() {
  const config = await askConfig();
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
    api_id: config.api_id,
    api_hash: config.api_hash,
    phone: config.phone,
  });
  if (currentSession && currentSession !== config.session) {
    console.log(`Da cap nhat session dang nhap 1 lan vao ${SESSION_PATH}\n`);
  }

  const dialogs = await client.getDialogs({});
  const groups = [];

  for (const dialog of dialogs) {
    const entity = dialog.entity;
    const isGroup = Boolean(dialog.isGroup);
    const isSupergroup = Boolean(entity?.megagroup);
    if (!isGroup && !isSupergroup) continue;

    groups.push({
      name: dialog.title || "",
      id: dialog.id?.toString?.() ?? "",
      username: entity?.username || "",
      type: isSupergroup ? "supergroup" : "group",
    });
  }

  console.log("\nDanh sach group Telegram:\n");
  for (const g of groups) {
    const usernameText = g.username ? `@${g.username}` : "";
    console.log(`${g.name} | id=${g.id} | type=${g.type} | ${usernameText}`);
  }

  console.log(`\nTong cong: ${groups.length} group`);
  console.log(`Chi luu 1 file session: ${SESSION_PATH}`);

  await client.disconnect();
}

main().catch((err) => {
  console.error("Loi:", err?.message || err);
  process.exit(1);
});
