/**
 * Test offline regex patterns tren mau tin nhan that tu bot.
 * Chay: node test_regex.js
 */

const SIGNAL_PATTERN = /Hãy đánh[\s\S]*?(NHỎ|LỚN)[\s\S]*Kỳ xổ hiện tại\s*(\d+)/iu;
const SIGNAL_PATTERN_PHASE2 = /Hãy đánh[\s\S]*?(NHỎ|LỚN)[\s\S]*?Kỳ xổ hiện tại\s*\d+/iu;
const SIGNAL_COUNT = /Hãy đánh[\s\S]*?(NHỎ|LỚN)/giu;
const RESULT_PATTERN = /Kết quả kỳ xổ\s*:\s*\d+\s*(NHỎ|LỚN)/iu;
const LOSE_PATTERN = /(THUA|LOSE|LOST)/iu;
const WIN_PATTERN = /(THẮNG|THANG|WIN)/iu;

// ============ MAU TIN NHANH THUC TE ============

const testMessages = [
  // --- TIN HIEU format cu (từng hoat dong) ---
  {
    label: "Signal cu - 1 dong",
    text: "Hãy đánh NHỎ. Kỳ xổ hiện tại 88589",
    expected: { signal: true, round: "88589", side: "NHỎ" },
  },
  {
    label: "Signal cu - NHỎ",
    text: "Hãy đánh LỚN. Kỳ xổ hiện tại 88590",
    expected: { signal: true, round: "88590", side: "LỚN" },
  },

  // --- TIN HIeu format moi (co the bot da doi) ---
  {
    label: "Signal moi - co xuong day",
    text: "📢 Hãy đánh NHỎ\nKỳ xổ hiện tại 88591",
    expected: { signal: true, round: "88591", side: "NHỎ" },
  },
  {
    label: "Signal moi - emoji + dau cham",
    text: "🎯 Hãy đánh LỚN.\nKỳ xổ hiện tại 88592",
    expected: { signal: true, round: "88592", side: "LỚN" },
  },
  {
    label: "Signal moi - tab + space",
    text: "Hãy đánh\tNHỎ\tKỳ xổ hiện tại\t88593",
    expected: { signal: true, round: "88593", side: "NHỎ" },
  },

  // --- KET QUA format cu ---
  {
    label: "Result cu - NHỎ",
    text: "Kết quả kỳ xổ: 88588 NHỎ",
    expected: { result: true, side: "NHỎ" },
  },
  {
    label: "Result cu - LỚN",
    text: "Kết quả kỳ xổ: 88587 LỚN",
    expected: { result: true, side: "LỚN" },
  },

  // --- KET QUA format moi ---
  {
    label: "Result moi - emoji",
    text: "✅ Kết quả kỳ xổ: 88586 NHỎ",
    expected: { result: true, side: "NHỎ" },
  },
  {
    label: "Result moi - khong dau cham",
    text: "Kết quả kỳ xổ : 88585 LỚN",
    expected: { result: true, side: "LỚN" },
  },
  {
    label: "Result moi - xuong dong",
    text: "Kết quả kỳ xổ:\n88584 NHỎ",
    expected: { result: true, side: "NHỎ" },
  },

  // --- TIN KHONG PHAI TIN HIU ---
  {
    label: "Khong phai tin hieu - chao mung",
    text: "Chào mừng bạn đến với group VN168!",
    expected: { signal: false, result: false },
  },
  {
    label: "Khong phai tin hieu - huong dan",
    text: "Hướng dẫn chơi: Đặt cược trước khi kỳ xổ bắt đầu",
    expected: { signal: false, result: false },
  },

  // --- TIN HIEU CO NHIEU DONG (multiline) ---
  {
    label: "Multiline - 3 dong",
    text: "📊 Báo cáo\nHãy đánh NHỎ\nKỳ xổ hiện tại 88594",
    expected: { signal: true, round: "88594", side: "NHỎ" },
  },

  // --- TIN HIEU CO 2 TIN HIU (phai bi skip) ---
  {
    label: "2 signals - phai skip",
    text: "Hãy đánh NHỎ và hãy đánh LỚN Kỳ xổ hiện tại 88595",
    expected: { signal: true, skip: true },
  },

  // --- WIN/LOSE messages ---
  {
    label: "THANG message",
    text: "Kết quả kỳ xổ: 88583 NHỎ - THẮNG",
    expected: { result: true, win: true, side: "NHỎ" },
  },
  {
    label: "THUA message",
    text: "Kết quả kỳ xổ: 88582 LỚN - THUA",
    expected: { result: true, lose: true, side: "LỚN" },
  },

  // --- FORMAT MOI: bot co the dung "danh" thay "Hãy đánh" ---
  {
    label: "Khong co 'Hay danh'",
    text: "Đánh NHỎ. Kỳ xổ hiện tại 88596",
    expected: { signal: false },
  },
  {
    label: "Viet tat: 'H.danh'",
    text: "H.danh NHỎ Kỳ xổ hiện tại 88597",
    expected: { signal: false },
  },

  // --- FORMAT MOI: so truoc, 'Hay danh' sau ---
  {
    label: "Ky xo truoc",
    text: "Kỳ xổ hiện tại 88598 Hãy đánh NHỎ",
    expected: { signal: false },
  },

  // --- UNICODE HOA/THAP PHAN BIET ---
  {
    label: "NHO khong dau",
    text: "Hãy đánh NHO. Kỳ xổ hiện tại 88599",
    expected: { signal: true, side: "NHỎ" },
  },
  {
    label: "LON khong dau",
    text: "Hãy đánh LON. Kỳ xổ hiện tại 88600",
    expected: { signal: true, side: "LỚN" },
  },

  // --- BOT DOI TEN ---
  {
    label: "Bot khac ten - vn168_command1_bot",
    text: "Hãy đánh NHỎ. Kỳ xổ hiện tại 88601",
    sender: "vn168_command1_bot",
    expected: { signal: true },
  },
  {
    label: "Bot khac ten - vn168_bot",
    text: "Hãy đánh NHỎ. Kỳ xổ hiện tại 88602",
    sender: "vn168_bot",
    expected: { signal: false, reason: "sender khac" },
  },
  {
    label: "Bot khac ten - VN168WINGOO_BOT",
    text: "Hãy đánh NHỎ. Kỳ xổ hiện tại 88603",
    sender: "VN168WINGOO_BOT",
    expected: { signal: false, reason: "sender khac" },
  },

  // --- FORMAT "Hãy đánh" + DINH KEM ---
  {
    label: "Hay danh voi so tien",
    text: "Hãy đánh NHỎ 1000đ. Kỳ xổ hiện tại 88604",
    expected: { signal: true, round: "88604" },
  },
  {
    label: "Hay danh + step",
    text: "Hãy đánh NHỎ x2. Kỳ xổ hiện tại 88605",
    expected: { signal: true, round: "88605" },
  },

  // --- KET QUA KHONG CO SO ---
  {
    label: "Result khong co so",
    text: "Kết quả kỳ xổ: NHỎ",
    expected: { result: false },
  },
];

// ============ CHAY TEST ============

console.log("========================================");
console.log("  TEST REGEX OFFLINE - DEBUG TIN HIU");
console.log("========================================\n");

let pass = 0;
let fail = 0;
let warn = 0;

for (const tc of testMessages) {
  const text = tc.text;
  const sender = tc.sender || "vn168_command1_bot";

  // Phase 1: sender check
  const phase1Pass = sender === "vn168_command1_bot";

  // Phase 2: signal check
  const hasSignal_phase2 = SIGNAL_PATTERN_PHASE2.test(text);
  const hasSignal_global = SIGNAL_PATTERN.test(text);
  const hasResult = RESULT_PATTERN.test(text);

  // Phase 3: signal count
  const signalCount = (text.match(SIGNAL_COUNT) || []).length;

  // Parse signal
  const parsed = SIGNAL_PATTERN.test(text) ? text.match(SIGNAL_PATTERN) : null;

  // Win/Lose
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const isWin = WIN_PATTERN.test(text) || normalized.includes("THANG") || normalized.includes("WIN");
  const isLose = LOSE_PATTERN.test(text) || normalized.includes("THUA") || normalized.includes("LOSE") || normalized.includes("LOST");

  // Determine actual result
  const actualSignal = phase1Pass && hasSignal_global;
  const actualResult = phase1Pass && hasResult;
  const actualSkip = signalCount >= 2;

  // Compare with expected
  const exp = tc.expected;
  let status = "PASS";
  const issues = [];

  if (exp.signal !== undefined && actualSignal !== exp.signal) {
    status = "FAIL";
    issues.push(`signal: expected=${exp.signal}, actual=${actualSignal}`);
  }
  if (exp.result !== undefined && actualResult !== exp.result) {
    status = "FAIL";
    issues.push(`result: expected=${exp.result}, actual=${actualResult}`);
  }
  if (exp.round !== undefined && parsed && parsed[2] !== exp.round) {
    status = "FAIL";
    issues.push(`round: expected=${exp.round}, actual=${parsed[2]}`);
  }
  if (exp.side !== undefined && parsed && parsed[1] !== exp.side) {
    // Check result pattern too
    const resultMatch = text.match(RESULT_PATTERN);
    const actualSide = parsed?.[1] || resultMatch?.[1];
    if (actualSide !== exp.side) {
      status = "FAIL";
      issues.push(`side: expected=${exp.side}, actual=${actualSide}`);
    }
  }
  if (exp.win && !isWin) {
    status = "FAIL";
    issues.push(`expected WIN but not detected`);
  }
  if (exp.lose && !isLose) {
    status = "FAIL";
    issues.push(`expected LOSE but not detected`);
  }
  if (exp.skip && !actualSkip) {
    status = "FAIL";
    issues.push(`expected skip (>=2 signals) but count=${signalCount}`);
  }

  if (status === "PASS") pass++;
  else fail++;

  // Print result
  const icon = status === "PASS" ? "✅" : "❌";
  console.log(`${icon} [${tc.label}]`);
  console.log(`   Text: "${text.replace(/\n/g, "\\n")}"`);
  console.log(`   Sender: @${sender}`);
  console.log(`   Phase1: ${phase1Pass ? "PASS" : "SKIP"}`);
  console.log(`   Phase2 local: ${hasSignal_phase2}, global: ${hasSignal_global}, result: ${hasResult}`);
  console.log(`   Signal count: ${signalCount}`);
  if (parsed) console.log(`   Parsed: signal=${parsed[1]}, round=${parsed[2]}`);
  if (isWin) console.log(`   Detected: WIN`);
  if (isLose) console.log(`   Detected: LOSE`);
  if (issues.length > 0) {
    console.log(`   ❌ ISSUES: ${issues.join("; ")}`);
  }

  // WARNING: mismatch between phase2 and global
  if (hasSignal_phase2 !== hasSignal_global) {
    warn++;
    console.log("  ⚠️  CAUTION: Phase2 pattern vs SIGNAL_PATTERN mismatch!");
    console.log(`     Phase2=${hasSignal_phase2}, SIGNAL_PATTERN=${hasSignal_global}`);
  }

  console.log("");
}

console.log("========================================");
console.log(`  KET QUA: ${pass} PASS, ${fail} FAIL, ${warn} WARN`);
console.log("========================================");

if (fail > 0) {
  console.log("\n⚠️  CO TIN NHAN KHONG MATCH - KIEM TRA LOGIC REGEX!");
}
if (warn > 0) {
  console.log("\n⚠️  CO SU KHAC BIET GIUA PHASE2 va SIGNAL_PATTERN!");
}
