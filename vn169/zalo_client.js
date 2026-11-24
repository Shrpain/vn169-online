import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const ZALO_TOKEN_PATH = path.resolve("zalo.txt");
const ZALO_USER_PATH = path.resolve("zalo_user.json");
const ZALO_SEND_URL = "https://openapi.zalo.me/v3.0/oa/message/cs";

function readTextFile(filePath) {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8").trim();
}

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

function loadZaloAccessToken() {
  const raw = readTextFile(ZALO_TOKEN_PATH);
  if (!raw) return "";

  const parts = raw.split(":");
  if (parts.length >= 2 && parts.at(-1)?.trim().length > 20) {
    return parts.at(-1).trim();
  }

  return raw;
}

function loadSavedUserId() {
  return readJsonFile(ZALO_USER_PATH, {}).user_id || "";
}

function saveUserId(userId) {
  writeJsonFile(ZALO_USER_PATH, { user_id: String(userId) });
}

function formatMoney(amount) {
  return `${Number(amount || 0).toLocaleString("vi-VN")} đ`;
}

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function firstId(...values) {
  const value = values.find((item) => item !== null && item !== undefined && String(item).trim());
  return value === undefined ? "" : String(value).trim();
}

function extractZaloMessage(payload) {
  const message = payload?.message || {};
  const sender = payload?.sender || {};

  const text = firstString(
    message.text,
    message.msg?.text,
    payload?.text,
    payload?.data?.text,
    payload?.event_data?.text,
    payload?.event_data?.content,
  );

  const userId = firstId(
    sender.id,
    sender.user_id,
    payload?.user_id_by_app,
    payload?.user_id,
    payload?.fromuid,
    payload?.from_id,
    message.from_id,
  );

  return { text, userId };
}

class ZaloService {
  constructor(accessToken, onBalanceRequest) {
    this.accessToken = accessToken;
    this.onBalanceRequest = onBalanceRequest;
    this.userId = loadSavedUserId();
    this.server = null;
  }

  setUserId(userId) {
    if (!userId) return;
    if (this.userId !== String(userId)) {
      this.userId = String(userId);
      saveUserId(this.userId);
      console.log(`[Zalo] Saved user_id ${this.userId}`);
    }
  }

  async sendText(userId, text) {
    if (!userId) return null;

    const response = await fetch(ZALO_SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        access_token: this.accessToken,
      },
      body: JSON.stringify({
        recipient: { user_id: String(userId) },
        message: { text },
      }),
    });

    const json = await response.json().catch(() => null);
    if (!response.ok || (json?.error && json.error !== 0)) {
      throw new Error(json?.message || json?.error_name || `Zalo HTTP ${response.status}`);
    }

    return json;
  }

  async notifyBetUpdate({ multiplier, betMoney, betStatus, balanceText }) {
    if (!this.userId) {
      console.log("[Zalo] Skip bet notify: no saved user_id yet. Send /sd to the OA first.");
      return;
    }

    await this.sendText(
      this.userId,
      [
        `Da dat cuoc muc x${multiplier}`,
        `Bet Money: ${formatMoney(betMoney)}`,
        `Bet: ${betStatus}`,
        `So du con lai: ${balanceText}`,
      ].join("\n"),
    );
  }

  async handleIncoming(payload) {
    const { text, userId } = extractZaloMessage(payload);
    if (!text || !userId) return;

    this.setUserId(userId);

    if (text.trim().toLowerCase() !== "/sd") return;

    try {
      const balance = await this.onBalanceRequest();
      await this.sendText(userId, `So du hien tai: ${formatMoney(balance)}`);
    } catch (err) {
      await this.sendText(userId, `Khong lay duoc so du: ${err?.message || err}`);
    }
  }

  startWebhookServer(port) {
    if (this.server) return;

    this.server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method !== "POST" || req.url !== "/zalo/webhook") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false }));
        return;
      }

      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1024 * 1024) req.destroy();
      });

      req.on("end", () => {
        let payload = null;
        try {
          payload = JSON.parse(body || "{}");
        } catch {
          payload = null;
        }

        if (payload) {
          void this.handleIncoming(payload).catch((err) => {
            console.error("[Zalo] Webhook handler error:", err?.message || err);
          });
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    this.server.listen(port, () => {
      console.log(`[Zalo] Webhook listening on http://localhost:${port}/zalo/webhook`);
    });
  }
}

export async function startZaloService({ onBalanceRequest }) {
  const accessToken = loadZaloAccessToken();
  if (!accessToken) {
    console.log("[Zalo] Skip: zalo.txt is missing or empty");
    return null;
  }

  const service = new ZaloService(accessToken, onBalanceRequest);
  const port = Number(process.env.ZALO_WEBHOOK_PORT || 8787);

  if (process.env.ZALO_WEBHOOK_ENABLED !== "0") {
    service.startWebhookServer(port);
  }

  return service;
}
