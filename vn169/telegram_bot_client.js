import fs from "node:fs";
import path from "node:path";

const BOT_TOKEN_PATH = path.resolve("bot.txt");
const BOT_CHAT_PATH = path.resolve("bot_chat.json");
const BOT_POLL_LOCK_PATH = path.resolve("bot_poll.lock");
const POLL_INTERVAL_MS = 1000;

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

function loadBotToken() {
  return process.env.BOT_TOKEN || readTextFile(BOT_TOKEN_PATH);
}

function loadSavedChatId() {
  return readJsonFile(BOT_CHAT_PATH, {}).chat_id || "";
}

function saveChatId(chatId) {
  writeJsonFile(BOT_CHAT_PATH, { chat_id: String(chatId) });
}

function formatMoney(amount) {
  return `${Number(amount || 0).toLocaleString("vi-VN")} đ`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

class TelegramBotService {
  constructor(token, { onBalanceRequest, onStartBetting, onStopBetting, onSetBetSteps, onSetLimits, getLoginPaused, getBettingEnabled, getBetSteps, getMartingaleStep, getDayTargetProfit, getHourTargetProfit, getDayLossLimit, getHourLossLimit, getDayProfit, getHourProfit, getPauseReason, getPauseUntil, getHourPauseMinutes, getCycleStartBalance }) {
    this.token = token;
    this.onBalanceRequest = onBalanceRequest;
    this.onStartBetting = onStartBetting;
    this.onStopBetting = onStopBetting;
    this.onSetBetSteps = onSetBetSteps;
    this.onSetLimits = onSetLimits;
    this.getLoginPaused = getLoginPaused;
    this.getBettingEnabled = getBettingEnabled;
    this.getBetSteps = getBetSteps;
    this.getMartingaleStep = getMartingaleStep;
    this.getDayTargetProfit = getDayTargetProfit;
    this.getHourTargetProfit = getHourTargetProfit;
    this.getDayLossLimit = getDayLossLimit;
    this.getHourLossLimit = getHourLossLimit;
    this.getDayProfit = getDayProfit;
    this.getHourProfit = getHourProfit;
    this.getPauseReason = getPauseReason;
    this.getPauseUntil = getPauseUntil;
    this.getHourPauseMinutes = getHourPauseMinutes;
    this.getCycleStartBalance = getCycleStartBalance;
    this.chatId = loadSavedChatId();
    this.updateOffset = 0;
    this.running = false;
    this.lockOwned = false;
  }

  shutdown() {
    this.running = false;
    this.releasePollLock();
  }

  apiUrl(method) {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  setChatId(chatId) {
    if (!chatId) return;
    if (this.chatId !== String(chatId)) {
      this.chatId = String(chatId);
      saveChatId(this.chatId);
      console.log(`[Bot] Đã lưu chat_id ${this.chatId}`);
    }
  }

  async callBotApi(method, body) {
    const response = await fetch(this.apiUrl(method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) {
      throw new Error(json?.description || `Telegram HTTP ${response.status}`);
    }

    return json.result;
  }

  async sendText(chatId, text) {
    if (!chatId) return null;
    return this.callBotApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    });
  }

  acquirePollLock() {
    const currentPid = process.pid;
    const existing = readJsonFile(BOT_POLL_LOCK_PATH, {});

    if (existing?.pid && Number(existing.pid) !== currentPid && isProcessAlive(Number(existing.pid))) {
      return false;
    }

    writeJsonFile(BOT_POLL_LOCK_PATH, { pid: currentPid, started_at: new Date().toISOString() });
    this.lockOwned = true;
    return true;
  }

  releasePollLock() {
    if (!this.lockOwned) return;

    const existing = readJsonFile(BOT_POLL_LOCK_PATH, {});
    if (Number(existing?.pid) === process.pid && fs.existsSync(BOT_POLL_LOCK_PATH)) {
      fs.unlinkSync(BOT_POLL_LOCK_PATH);
    }

    this.lockOwned = false;
  }

  describePause() {
    const reason = this.getPauseReason?.() ?? null;
    const until = Number(this.getPauseUntil?.() || 0);
    if (!reason) return null;
    if (reason === "DAY_TARGET") return "Đã đạt mục tiêu lãi ngày, dừng đến hết ngày";
    if (reason === "DAY_LOSS") return "Chạm giới hạn lỗ ngày, dừng hẳn (cần /start để gỡ)";
    const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60000));
    return reason === "HOUR_TARGET"
      ? `Đã đạt mục tiêu lãi giờ, nghỉ còn ~${minutes} phút`
      : `Chạm giới hạn lỗ giờ, nghỉ còn ~${minutes} phút`;
  }

  async setCommandMenu() {
    try {
      await this.callBotApi("setMyCommands", {
        commands: [
          { command: "start", description: "Bat dat cuoc tu dong" },
          { command: "stop", description: "Dung dat cuoc tu dong" },
          { command: "restart", description: "Reset chu ky von va bat lai" },
          { command: "cn", description: "Cap nhat he so, vd /cn 1-1-2-3" },
          { command: "hs", description: "Reset he so mac dinh" },
          { command: "mt", description: "Muc tieu lai ngay/gio, vd /mt 299000 30000" },
          { command: "sl", description: "Gioi han lo ngay/gio, vd /sl 100000 10000" },
          { command: "status", description: "Xem trang thai chi tiet" },
          { command: "sd", description: "Xem so du hien tai" }
        ],
      });
    } catch (err) {
      console.error("[Bot] Không đặt được menu lệnh:", err?.message || err);
    }
  }

  async notifyBetUpdate({ multiplier, betMoney, betStatus, balanceText, resultText = null, dayProfit = null, hourProfit = null, pauseReason = null, pauseUntil = null }) {
    if (!this.chatId) {
      console.log("[Bot] Bỏ qua gửi thông báo cược: chưa có chat_id. Hãy nhắn /sd cho bot trước.");
      return;
    }

    const success = String(betStatus).toLowerCase().includes("success");
    const statusIcon = success ? "✅" : "❌";
    const statusTitle = success ? "Thành công" : "Thất bại";
    const pauseText = this.describePause();

    await this.sendText(
      this.chatId,
      [
        "🎯 <b>Cập nhật lệnh cược</b>",
        `• Mức cược: <b>x${multiplier}</b>`,
        `• Bet Money: <b>${formatMoney(betMoney)}</b>`,
        `• Trạng thái: ${statusIcon} <b>${statusTitle}</b>`,
        `• Chi tiết: <code>${betStatus}</code>`,
        ...(resultText ? [`• Kết quả gần nhất: <b>${resultText}</b>`] : []),
        ...(dayProfit !== null ? [`• Lãi hôm nay: <b>${formatMoney(dayProfit)}</b> / <b>${formatMoney(this.getDayTargetProfit?.() ?? 0)}</b>`] : []),
        ...(hourProfit !== null ? [`• Lãi giờ này: <b>${formatMoney(hourProfit)}</b> / <b>${formatMoney(this.getHourTargetProfit?.() ?? 0)}</b>`] : []),
        ...(pauseText ? [`⏸️ Tạm dừng: <b>${pauseText}</b>`] : []),
        `• Số dư còn lại: <b>${balanceText}</b>`,
      ].join("\n"),
    );
  }

  async notifyResult({ resultType, newStep, multiplier, dayProfit = null, hourProfit = null }) {
    if (!this.chatId) return;

    const isWin = resultType === "WIN";
    const icon = isWin ? "🎉" : "😭";
    const title = isWin ? "THẮNG" : "THUA";

    await this.sendText(
      this.chatId,
      [
        `${icon} <b>Kết quả phiên trước: ${title}</b>`,
        `• Bậc cược mới: <b>Bậc ${newStep + 1}</b> (x${multiplier})`,
        ...(dayProfit !== null ? [`• Lãi hôm nay: <b>${formatMoney(dayProfit)}</b> / <b>${formatMoney(this.getDayTargetProfit?.() ?? 0)}</b>`] : []),
        ...(hourProfit !== null ? [`• Lãi giờ này: <b>${formatMoney(hourProfit)}</b> / <b>${formatMoney(this.getHourTargetProfit?.() ?? 0)}</b>`] : []),
      ].join("\n"),
    );
  }

  async notifyLimitsPause({ reason, dayProfit = null, hourProfit = null }) {
    if (!this.chatId) return;

    const reasonText = {
      DAY_TARGET: "🎯 Đã đạt mục tiêu lãi NGÀY",
      DAY_LOSS: "🛑 Chạm giới hạn lỗ NGÀY",
      HOUR_TARGET: "⏱️ Đã đạt mục tiêu lãi GIỜ",
      HOUR_LOSS: "⏱️ Chạm giới hạn lỗ GIỜ",
    }[reason] || reason;
    const isDay = reason === "DAY_TARGET" || reason === "DAY_LOSS";

    await this.sendText(
      this.chatId,
      [
        `<b>${reasonText}</b>`,
        `• Lãi hôm nay: <b>${formatMoney(dayProfit)}</b> / <b>${formatMoney(this.getDayTargetProfit?.() ?? 0)}</b>`,
        `• Lãi giờ này: <b>${formatMoney(hourProfit)}</b> / <b>${formatMoney(this.getHourTargetProfit?.() ?? 0)}</b>`,
        isDay
          ? "• Tool dừng đặt cược. Gửi /start để vào sớm hơn (mốc ngày mới sẽ reset lúc 00:00)."
          : `• Tool nghỉ ${this.getHourPauseMinutes?.() ?? 30} phút rồi tự quay lại.`,
      ].join("\n"),
    );
  }

  async notifyLimitsResume({ dayProfit = null, hourProfit = null }) {
    if (!this.chatId) return;

    await this.sendText(
      this.chatId,
      [
        "▶️ <b>Hết thời gian nghỉ, quay lại đặt cược</b>",
        ...(dayProfit !== null ? [`• Lãi hôm nay: <b>${formatMoney(dayProfit)}</b>`] : []),
        ...(hourProfit !== null ? [`• Lãi giờ này: <b>${formatMoney(hourProfit)}</b>`] : []),
      ].join("\n"),
    );
  }

  async notifyStartupSuccess() {
    if (!this.chatId) return;

    const loginPaused = this.getLoginPaused?.() === true;
    const enabled = this.getBettingEnabled?.() === true;
    const steps = this.getBetSteps?.() || [];
    const step = Number(this.getMartingaleStep?.() || 0);
    const currentMultiplier = steps[step] ?? 1;
    const dayTarget = this.getDayTargetProfit?.() ?? null;
    const hourTarget = this.getHourTargetProfit?.() ?? null;
    const dayLoss = this.getDayLossLimit?.() ?? null;
    const hourLoss = this.getHourLossLimit?.() ?? null;
    const dayProfit = this.getDayProfit?.() ?? null;
    const hourProfit = this.getHourProfit?.() ?? null;
    const pauseText = this.describePause();

    await this.sendText(
      this.chatId,
      [
        "✅ <b>Khởi động lại tool thành công</b>",
        `• Đăng nhập game: <b>${loginPaused ? "ĐANG TẮT" : "ĐANG BẬT"}</b>`,
        `• Auto bet: <b>${enabled ? "ĐANG BẬT" : "ĐANG TẮT"}</b>`,
        `• Bậc hiện tại: <b>Bậc ${step + 1}</b> (x${currentMultiplier})`,
        `• Logic cược: <b>THẮNG 2 kỳ liên tiếp +1 bậc, THẮNG 3 kỳ về bậc 1, THUA về bậc 1</b>`,
        `• Dãy hệ số: <code>${steps.join("-")}</code>`,
        ...(dayTarget !== null && hourTarget !== null && dayLoss !== null && hourLoss !== null ? [
          `• Mục tiêu lãi: <b>${formatMoney(hourTarget)}</b>/giờ · <b>${formatMoney(dayTarget)}</b>/ngày`,
          `• Giới hạn lỗ: <b>-${formatMoney(hourLoss)}</b>/giờ · <b>-${formatMoney(dayLoss)}</b>/ngày`,
        ] : []),
        ...(dayProfit !== null ? [`• Lãi hôm nay: <b>${formatMoney(dayProfit)}</b>`] : []),
        ...(hourProfit !== null ? [`• Lãi giờ này: <b>${formatMoney(hourProfit)}</b>`] : []),
        ...(pauseText ? [`⏸️ Trạng thái: <b>${pauseText}</b>`] : []),
      ].join("\n"),
    );
  }

  async handleUpdate(update) {
    const message = update.message || update.edited_message;
    if (!message?.chat?.id || typeof message.text !== "string") return;

    const text = message.text.trim().toLowerCase();
    const chatId = message.chat.id;

    this.setChatId(chatId);

    if (text.startsWith("/start")) {
      try {
        await this.onStartBetting?.();
        const enabled = this.getBettingEnabled?.() !== false;
        await this.sendText(
          chatId,
          [
            "▶️ <b>Bật đặt cược tự động</b>",
            "• Đã đăng nhập game lại và cập nhật vốn chu kỳ.",
            `• Trạng thái hiện tại: <b>${enabled ? "ĐANG BẬT" : "ĐANG TẮT"}</b>`,
          ].join("\n"),
        );
      } catch (err) {
        await this.sendText(chatId, `⚠️ Không bật được auto bet: <code>${err?.message || err}</code>`);
      }
      return;
    }

    if (text.startsWith("/stop")) {
      try {
        await this.onStopBetting?.();
        const enabled = this.getBettingEnabled?.() === true;
        await this.sendText(
          chatId,
          [
            "⏹️ <b>Đã dừng và logout</b>",
            "• Đã logout khỏi game (token DropAPI đã bị xóa).",
            "• Tool không nhận tín hiệu, không làm gì cho đến khi gửi /start.",
            `• Trạng thái hiện tại: <b>${enabled ? "ĐANG BẬT" : "ĐANG TẮT"}</b>`,
          ].join("\n"),
        );
      } catch (err) {
        await this.sendText(chatId, `⚠️ Không dừng được auto bet: <code>${err?.message || err}</code>`);
      }
      return;
    }

    if (text.startsWith("/restart")) {
      try {
        await this.onStopBetting?.();
        await this.onStartBetting?.({ reset: true });
        const enabled = this.getBettingEnabled?.() === true;
        await this.sendText(
          chatId,
          [
            "🔄 <b>Đã restart chu kỳ vốn</b>",
            `• Trạng thái hiện tại: <b>${enabled ? "ĐANG BẬT" : "ĐANG TẮT"}</b>`,
            "• Chu kỳ vốn đã về mức đầu (x1)",
          ].join("\n"),
        );
      } catch (err) {
        await this.sendText(chatId, `⚠️ Không restart được: <code>${err?.message || err}</code>`);
      }
      return;
    }

    if (text.startsWith("/cn")) {
      const raw = text.replace("/cn", "").trim();
      const steps = raw
        .split(/[-,\s]+/)
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v));

      if (!raw || steps.length === 0 || steps.some((v) => v <= 0)) {
        await this.sendText(
          chatId,
          [
            "⚙️ <b>Cập nhật hệ số cược</b>",
            "• Dùng: <code>/cn 1-1-2-3-5-8-13-21-34</code>",
            "• Chỉ nhận số dương, cách nhau bằng dấu -, dấu , hoặc khoảng trắng.",
          ].join("\n"),
        );
        return;
      }

      try {
        await this.onSetBetSteps?.(steps);
        await this.sendText(
          chatId,
          [
            "✅ <b>Đã cập nhật hệ số cược</b>",
            `• Dãy mới: <code>${steps.join("-")}</code>`,
            "• Chu kỳ đã reset về mức đầu.",
          ].join("\n"),
        );
      } catch (err) {
        await this.sendText(chatId, `⚠️ Không cập nhật được hệ số: <code>${err?.message || err}</code>`);
      }
      return;
    }

    if (text.startsWith("/hs")) {
      try {
        await this.onSetBetSteps?.();
        const steps = this.getBetSteps?.() || [];
        await this.sendText(
          chatId,
          [
            "✅ <b>Đã reset hệ số mặc định</b>",
            `• Dãy mặc định: <code>${steps.join("-")}</code>`,
            "• Chu kỳ đã reset về mức đầu.",
          ].join("\n"),
        );
      } catch (err) {
        await this.sendText(chatId, `⚠️ Không reset được hệ số: <code>${err?.message || err}</code>`);
      }
      return;
    }

    if (text.startsWith("/mt")) {
      const raw = text.replace("/mt", "").trim();
      const usage = [
        "🎯 <b>Đặt mục tiêu lãi</b>",
        "• Dùng: <code>/mt &lt;lãi ngày&gt; &lt;lãi giờ&gt;</code>",
        "• Ví dụ: <code>/mt 299000 30000</code>",
        "• Reset mặc định: <code>/mt reset</code>",
      ];

      if (raw === "reset") {
        try {
          const next = await this.onSetLimits?.({ reset: true });
          await this.sendText(
            chatId,
            [
              "✅ <b>Đã reset mục tiêu lãi mặc định</b>",
              `• Lãi ngày: <b>${formatMoney(next?.targetDayProfit)}</b>`,
              `• Lãi giờ: <b>${formatMoney(next?.targetHourProfit)}</b>`,
            ].join("\n"),
          );
        } catch (err) {
          await this.sendText(chatId, `⚠️ Không reset được mục tiêu: <code>${err?.message || err}</code>`);
        }
        return;
      }

      const parts = raw.split(/[-,\s]+/).map((v) => Number(v));
      if (parts.length < 2 || parts.some((v) => !Number.isFinite(v) || v <= 0)) {
        await this.sendText(chatId, usage.join("\n"));
        return;
      }

      const [targetDay, targetHour] = parts;
      try {
        const next = await this.onSetLimits?.({ targetDayProfit: targetDay, targetHourProfit: targetHour });
        await this.sendText(
          chatId,
          [
            "✅ <b>Đã cập nhật mục tiêu lãi</b>",
            `• Lãi ngày: <b>${formatMoney(next?.targetDayProfit)}</b>`,
            `• Lãi giờ: <b>${formatMoney(next?.targetHourProfit)}</b>`,
          ].join("\n"),
        );
      } catch (err) {
        await this.sendText(chatId, `⚠️ Không cập nhật được mục tiêu: <code>${err?.message || err}</code>`);
      }
      return;
    }

    if (text.startsWith("/sl")) {
      const raw = text.replace("/sl", "").trim();
      const usage = [
        "⛔ <b>Đặt giới hạn lỗ</b>",
        "• Dùng: <code>/sl &lt;lỗ ngày&gt; &lt;lỗ giờ&gt;</code>",
        "• Ví dụ: <code>/sl 100000 10000</code>",
        "• Reset mặc định: <code>/sl reset</code>",
      ];

      if (raw === "reset") {
        try {
          const next = await this.onSetLimits?.({ reset: true });
          await this.sendText(
            chatId,
            [
              "✅ <b>Đã reset giới hạn lỗ mặc định</b>",
              `• Lỗ ngày: <b>-${formatMoney(next?.dayLossLimit)}</b>`,
              `• Lỗ giờ: <b>-${formatMoney(next?.hourLossLimit)}</b>`,
            ].join("\n"),
          );
        } catch (err) {
          await this.sendText(chatId, `⚠️ Không reset được giới hạn lỗ: <code>${err?.message || err}</code>`);
        }
        return;
      }

      const parts = raw.split(/[-,\s]+/).map((v) => Number(v));
      if (parts.length < 2 || parts.some((v) => !Number.isFinite(v) || v <= 0)) {
        await this.sendText(chatId, usage.join("\n"));
        return;
      }

      const [lossDay, lossHour] = parts;
      try {
        const next = await this.onSetLimits?.({ dayLossLimit: lossDay, hourLossLimit: lossHour });
        await this.sendText(
          chatId,
          [
            "✅ <b>Đã cập nhật giới hạn lỗ</b>",
            `• Lỗ ngày: <b>-${formatMoney(next?.dayLossLimit)}</b>`,
            `• Lỗ giờ: <b>-${formatMoney(next?.hourLossLimit)}</b>`,
          ].join("\n"),
        );
      } catch (err) {
        await this.sendText(chatId, `⚠️ Không cập nhật được giới hạn lỗ: <code>${err?.message || err}</code>`);
      }
      return;
    }

    if (text.startsWith("/status")) {
      try {
        const loginPaused = this.getLoginPaused?.() === true;
        const enabled = this.getBettingEnabled?.() === true;
        const steps = this.getBetSteps?.() || [];
        const step = Number(this.getMartingaleStep?.() || 0);
        const currentMultiplier = steps[step] ?? 1;
        const dayTarget = this.getDayTargetProfit?.() ?? null;
        const hourTarget = this.getHourTargetProfit?.() ?? null;
        const dayLoss = this.getDayLossLimit?.() ?? null;
        const hourLoss = this.getHourLossLimit?.() ?? null;
        const dayProfit = this.getDayProfit?.() ?? null;
        const hourProfit = this.getHourProfit?.() ?? null;
        const cycleStartBalance = this.getCycleStartBalance?.() ?? null;
        const pauseText = this.describePause();

        await this.sendText(
          chatId,
          [
            "📊 <b>Trạng thái bot</b>",
            `• Đăng nhập game: <b>${loginPaused ? "ĐANG TẮT" : "ĐANG BẬT"}</b>`,
            `• Auto bet: <b>${enabled ? "ĐANG BẬT" : "ĐANG TẮT"}</b>`,
            `• Bậc hiện tại: <b>${step + 1}</b>`,
            `• Hệ số hiện tại: <b>x${currentMultiplier}</b>`,
            `• Dãy hệ số: <code>${steps.join("-")}</code>`,
            ...(dayTarget !== null && hourTarget !== null && dayLoss !== null && hourLoss !== null ? [
              `• Mục tiêu lãi: <b>${formatMoney(hourTarget)}</b>/giờ · <b>${formatMoney(dayTarget)}</b>/ngày`,
              `• Giới hạn lỗ: <b>-${formatMoney(hourLoss)}</b>/giờ · <b>-${formatMoney(dayLoss)}</b>/ngày`,
            ] : []),
            ...(dayProfit !== null ? [`• Lãi hôm nay: <b>${formatMoney(dayProfit)}</b>`] : []),
            ...(hourProfit !== null ? [`• Lãi giờ này: <b>${formatMoney(hourProfit)}</b>`] : []),
            ...(pauseText ? [`⏸️ Tạm dừng: <b>${pauseText}</b>`] : []),
            ...(cycleStartBalance !== null ? [`• Vốn đầu chu kỳ: <b>${formatMoney(cycleStartBalance)}</b>`] : []),
          ].join("\n"),
        );
      } catch (err) {
        await this.sendText(chatId, `⚠️ Không lấy được trạng thái: <code>${err?.message || err}</code>`);
      }
      return;
    }

    if (!text.startsWith("/sd")) return;

    try {
      const balance = await this.onBalanceRequest();
      await this.sendText(
        chatId,
        [
          "💰 <b>Số dư hiện tại</b>",
          `• Tài khoản: <b>${formatMoney(balance)}</b>`,
          "• Lệnh: <code>/sd</code>",
        ].join("\n"),
      );
    } catch (err) {
      await this.sendText(
        chatId,
        [
          "⚠️ <b>Không lấy được số dư</b>",
          `• Lỗi: <code>${err?.message || err}</code>`,
        ].join("\n"),
      );
    }
  }

  async pollLoop() {
    if (!this.acquirePollLock()) {
      console.warn("[Bot] Đã có một instance bot khác đang polling. Instance này sẽ không poll để tránh lỗi 409.");
      return;
    }

    this.running = true;
    console.log("[Bot] Bot Telegram đã khởi động. Hãy nhắn /sd để liên kết chat nhận thông báo.");

    while (this.running) {
      try {
        const updates = await this.callBotApi("getUpdates", {
          offset: this.updateOffset,
          timeout: 25,
          allowed_updates: ["message", "edited_message"],
        });

        for (const update of updates) {
          this.updateOffset = Math.max(this.updateOffset, update.update_id + 1);
          await this.handleUpdate(update);
        }
      } catch (err) {
        const isConflict = err?.message?.includes("Conflict") || String(err).includes("Conflict");
        if (isConflict) {
          console.warn("[Bot] Phát hiện Conflict (409). Đang đợi 5s trước khi thử lại...");
          await sleep(5000);
        } else {
          console.error("[Bot] Lỗi polling:", err?.message || err);
          await sleep(POLL_INTERVAL_MS);
        }
      }
    }
  }

  start() {
    void this.pollLoop();
  }
}

export async function startTelegramBotService({ onBalanceRequest, onStartBetting, onStopBetting, onSetBetSteps, onSetLimits, getLoginPaused, getBettingEnabled, getBetSteps, getMartingaleStep, getDayTargetProfit, getHourTargetProfit, getDayLossLimit, getHourLossLimit, getDayProfit, getHourProfit, getPauseReason, getPauseUntil, getHourPauseMinutes, getCycleStartBalance }) {
  const token = loadBotToken();
  if (!token) {
    console.log("[Bot] Bỏ qua khởi động bot: thiếu token trong bot.txt");
    return null;
  }

  const service = new TelegramBotService(token, {
    onBalanceRequest,
    onStartBetting,
    onStopBetting,
    onSetBetSteps,
    onSetLimits,
    getLoginPaused,
    getBettingEnabled,
    getBetSteps,
    getMartingaleStep,
    getDayTargetProfit,
    getHourTargetProfit,
    getDayLossLimit,
    getHourLossLimit,
    getDayProfit,
    getHourProfit,
    getPauseReason,
    getPauseUntil,
    getHourPauseMinutes,
    getCycleStartBalance,
  });
  await service.setCommandMenu();
  service.start();
  return service;
}
