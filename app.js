// ==============================
// Firebase / Firestore 読み込み
// ==============================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ==============================
// Firebase 初期化
// ==============================
const firebaseConfig = {
  apiKey: "AIzaSyDCNOp_Qk__5ClLSVCUwDUU6rtGKAnX2JU",
  authDomain: "training-log-27407.firebaseapp.com",
  projectId: "training-log-27407",
  storageBucket: "training-log-27407.firebasestorage.app",
  messagingSenderId: "996903584995",
  appId: "1:996903584995:web:09e63c9b6447b3952c71d6",
  measurementId: "G-LBHF20MC70",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ==============================
// Google Sheets 連携設定
// ==============================
const SHEET_WEBHOOK_URL =
  "https://script.google.com/macros/s/AKfycbwwoKPVulUclvzJ19GOTMaQXY1BMKGZtEp7QqPaizhma8clylPSqzlxmPu0KOmP84ISlw/exec";

function sendLogToSheet(log) {
  if (!SHEET_WEBHOOK_URL) {
    console.warn("SHEET_WEBHOOK_URL が設定されていません");
    return;
  }

  fetch(SHEET_WEBHOOK_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(log),
  }).catch((err) => {
    console.error("⚠ シートへの書き出し失敗:", err);
  });
}

// ==============================
// 型情報（JSDoc）
// ==============================
/**
 * @typedef {Object} TrainingLog
 * @property {string} date
 * @property {number | null} [bodyWeight]
 * @property {string} exercise
 * @property {number} setNo
 * @property {number} weight
 * @property {number} reps
 * @property {string | null} [rpe]
 * @property {string} [memo]
 */

/**
 * @typedef {Object} ExerciseSession
 * @property {string} date
 * @property {TrainingLog[]} sets
 * @property {TrainingLog} topSet
 * @property {number} top1RM
 * @property {number} volume
 */

/**
 * @typedef {Object} CustomExercise
 * @property {string} name
 * @property {string} part  // "chest" | "shoulder" | "back" | "legs" | "arms" | "other"
 */

// ==============================
// 種目マスタ
// ==============================
const BODY_PART_LABELS = {
  all: "全て",
  chest: "胸",
  shoulder: "肩",
  back: "背中",
  legs: "脚",
  arms: "腕",
  other: "その他",
};

/** @type {Record<string, string[]>} */
const BASE_EXERCISES = {
  chest: ["ベンチプレス", "インクラインダンベルプレス"],
  shoulder: ["オーバーヘッドプレス", "ダンベルショルダープレス", "サイドレイズ"],
  back: ["ラットプルダウン", "シーテッドロウ", "ローロウ", "ワイドプルダウン"],
  legs: [
    "スクワット",
    "デッドリフト",
    "ルーマニアンデッドリフト",
    "レッグプレス",
    "レッグカール",
    "レッグエクステンション",
  ],
  arms: ["ケーブルカール", "ハンマーカール", "オーバーヘッドエクステンション", "ケーブルプレスダウン"],
  other: ["リアデルトフライ", "ケーブルサイドレイズ", "ケーブルクランチ", "ロータリートルソー", "バイク", "ウォーキング"],
};

// ==============================
// ローカルストレージ関連
// ==============================
const STORAGE_KEY = "trainingLog_v2";
const CUSTOM_EXERCISE_KEY = "trainingCustomExercises_v2";

/** @type {TrainingLog[]} */
let logs = [];
/** @type {CustomExercise[]} */
let customExercises = [];
/** @type {"all" | "chest" | "shoulder" | "back" | "legs" | "arms" | "other"} */
let currentBodyPart = "all";

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("loadRecords failed:", e);
    return [];
  }
}

function saveLogsToLocal(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.error("saveLogsToLocal failed:", e);
  }
}

function loadCustomExercises() {
  try {
    const raw = localStorage.getItem(CUSTOM_EXERCISE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // 旧バージョン互換（文字列だけ保存していた場合は「その他」に）
    return parsed.map(
      /** @returns {CustomExercise} */ (item) => {
        if (typeof item === "string") {
          return { name: item, part: "other" };
        }
        return item;
      },
    );
  } catch (e) {
    console.warn("loadCustomExercises failed:", e);
    return [];
  }
}

function saveCustomExercises(list) {
  try {
    localStorage.setItem(CUSTOM_EXERCISE_KEY, JSON.stringify(list));
  } catch (e) {
    console.error("saveCustomExercises failed:", e);
  }
}

// ==============================
// DOM 要素
// ==============================
const form = document.getElementById("log-form");
const list = document.getElementById("log-list");
const exerciseSelectForGraph = document.getElementById("exercise-select");
const rangeSelect = document.getElementById("range-select");
const historyDiv = document.getElementById("history");
const statsDiv = document.getElementById("stats");
const todayBtn = document.getElementById("today-btn");
const copyFirstSetBtn = document.getElementById("copy-first-set-btn");
const dateSessionSelect = document.getElementById("date-session-select");
const dateSessionSummary = document.getElementById("date-session-summary");
const exerciseSelect = /** @type {HTMLSelectElement} */ (document.getElementById("exercise"));
const customExInput = /** @type {HTMLInputElement} */ (document.getElementById("custom-ex-input"));
const addCustomExBtn = document.getElementById("add-custom-ex-btn");
const bodyPartButtons = document.querySelectorAll(".bodypart-btn");

let rmChart = null;

// ----------------------
// ユーティリティ
// ----------------------
function estimate1RM(weight, reps) {
  if (!weight || !reps) return null;
  const rm = weight * (1 + reps / 30);
  return Math.round(rm * 10) / 10;
}

function isWithinRange(dateStr, rangeValue) {
  if (!dateStr) return false;
  if (rangeValue === "all") return true;

  const days = parseInt(rangeValue, 10);
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;

  const today = new Date();
  const diffMs = today - d;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= days;
}

/**
 * @param {string} exerciseName
 * @param {string} rangeValue
 * @returns {ExerciseSession[]}
 */
function getExerciseSessions(exerciseName, rangeValue) {
  const filteredLogs = logs.filter(
    (log) => log.exercise === exerciseName && isWithinRange(log.date, rangeValue),
  );
  if (filteredLogs.length === 0) return [];

  /** @type {Record<string, TrainingLog[]>} */
  const map = {};
  filteredLogs.forEach((log) => {
    if (!map[log.date]) map[log.date] = [];
    map[log.date].push(log);
  });

  const dates = Object.keys(map).sort();

  return dates.map((date) => {
    const sets = map[date]
      .slice()
      .sort((a, b) => (a.setNo || 0) - (b.setNo || 0));

    let topSet = sets[0];
    sets.forEach((s) => {
      if (
        s.weight > topSet.weight ||
        (s.weight === topSet.weight && s.reps > topSet.reps)
      ) {
        topSet = s;
      }
    });

    const top1RM = estimate1RM(topSet.weight, topSet.reps) ?? 0;
    const volume = sets.reduce((sum, s) => sum + s.weight * s.reps, 0);

    return { date, sets, topSet, top1RM, volume };
  });
}

function getTodayString() {
  const today = new Date();
  return today.toISOString().slice(0, 10);
}

function setDefaultDate() {
  const dateInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById("date")
  );
  if (!dateInput) return;
  if (!dateInput.value) {
    dateInput.value = getTodayString();
  }
}

// ==============================
// 種目セレクトまわり
// ==============================
/** 現在の部位に応じてセレクトボックスを組み立て */
function renderExerciseSelect() {
  const currentValue = exerciseSelect.value;

  exerciseSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "選択してください";
  exerciseSelect.appendChild(placeholder);

  /** @type {string[]} */
  const parts =
    currentBodyPart === "all"
      ? ["chest", "shoulder", "back", "legs", "arms", "other"]
      : [currentBodyPart];

  parts.forEach((part) => {
    const allForPart = [
      ...(BASE_EXERCISES[part] || []),
      ...customExercises.filter((c) => c.part === part).map((c) => c.name),
    ];

    if (allForPart.length === 0) return;

    const group = document.createElement("optgroup");
    group.label = BODY_PART_LABELS[part];

    allForPart.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      group.appendChild(opt);
    });

    exerciseSelect.appendChild(group);
  });

  // 以前選んでいた種目がまだ表示対象なら復元
  if (currentValue) {
    const option = Array.from(exerciseSelect.options).find((o) => o.value === currentValue);
    if (option) {
      exerciseSelect.value = currentValue;
    }
  }
}

/** すべての種目名を取得（重複なし） */
function getAllExerciseNamesFromSelect() {
  const names = [];
  for (const opt of exerciseSelect.options) {
    if (opt.value) names.push(opt.value);
  }
  return names;
}

// ==============================
// 保存＆再描画
// ==============================
function renderAll() {
  renderList();
  updateExerciseOptionsForGraph();
  updateTrainingDateOptions();

  const ex = /** @type {HTMLSelectElement} */ (exerciseSelectForGraph).value;
  const range = /** @type {HTMLSelectElement} */ (rangeSelect).value;

  if (ex) {
    updateRmChart(ex, range);
    renderStats(ex, range);
    renderHistory(ex, range);
  } else {
    if (rmChart) {
      rmChart.destroy();
      rmChart = null;
    }
    statsDiv.textContent = "種目を選択すると統計が表示されます。";
    historyDiv.textContent = "種目を選択すると履歴が表示されます。";
  }

  const selectedDate = /** @type {HTMLSelectElement} */ (dateSessionSelect).value;
  if (selectedDate) {
    renderSessionByDate(selectedDate);
  } else {
    dateSessionSummary.textContent = "記録がある日付から選択してください。";
  }
}

// ----------------------
// 記録一覧
// ----------------------
function renderList() {
  list.innerHTML = "";

  const sorted = logs.slice().sort((a, b) => {
    if (a.date === b.date) return (a.setNo || 0) - (b.setNo || 0);
    return a.date.localeCompare(b.date);
  });

  sorted.forEach((log) => {
    const li = document.createElement("li");

    const main = document.createElement("span");
    main.className = "log-main-text";

    let text = `${log.date} / ${log.exercise} / ${log.setNo}セット目 / ${log.weight}kg × ${log.reps}回`;
    if (log.rpe) {
      text += ` (RPE ${log.rpe})`;
    }
    if (log.bodyWeight != null) {
      text += ` / 体重 ${log.bodyWeight}kg`;
    }
    if (log.memo) {
      text += ` - ${log.memo}`;
    }
    main.textContent = text;

    const hint = document.createElement("span");
    hint.className = "log-delete-hint";
    hint.textContent = "タップで削除";

    li.appendChild(main);
    li.appendChild(hint);

    li.addEventListener("click", () => {
      if (confirm("この記録を削除しますか？")) {
        const originalIndex = logs.findIndex(
          (l) =>
            l.date === log.date &&
            l.exercise === log.exercise &&
            l.setNo === log.setNo &&
            l.weight === log.weight &&
            l.reps === log.reps &&
            l.rpe === log.rpe &&
            l.memo === log.memo &&
            (l.bodyWeight ?? null) === (log.bodyWeight ?? null),
        );
        if (originalIndex !== -1) {
          logs.splice(originalIndex, 1);
          saveLogsToLocal(logs);
          renderAll();
        }
      }
    });

    list.appendChild(li);
  });
}

// ----------------------
// グラフ用セレクト更新
// ----------------------
function updateExerciseOptionsForGraph() {
  const exercises = [
    ...new Set(logs.map((log) => log.exercise).filter((name) => !!name)),
  ];

  const current = /** @type {HTMLSelectElement} */ (exerciseSelectForGraph).value;
  exerciseSelectForGraph.innerHTML = "";

  if (exercises.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "まだ記録がありません";
    exerciseSelectForGraph.appendChild(option);
    return;
  }

  exercises.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    exerciseSelectForGraph.appendChild(option);
  });

  if (current && exercises.includes(current)) {
    exerciseSelectForGraph.value = current;
  } else if (!exerciseSelectForGraph.value && exercises.length > 0) {
    exerciseSelectForGraph.value = exercises[0];
  }
}

// ----------------------
// トレーニング日セレクト更新
// ----------------------
function updateTrainingDateOptions() {
  const dates = [
    ...new Set(logs.map((log) => log.date).filter((d) => !!d)),
  ].sort((a, b) => b.localeCompare(a));

  const selectEl = /** @type {HTMLSelectElement} */ (dateSessionSelect);
  const current = selectEl.value;

  selectEl.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = dates.length ? "日付を選択" : "まだ記録がありません";
  selectEl.appendChild(placeholder);

  dates.forEach((d) => {
    const option = document.createElement("option");
    option.value = d;
    option.textContent = d;
    selectEl.appendChild(option);
  });

  if (current && dates.includes(current)) {
    selectEl.value = current;
  } else if (!current && dates.length > 0) {
    selectEl.value = dates[0];
  }
}

// ----------------------
// 推定 1RM グラフ
// ----------------------
function updateRmChart(exerciseName, rangeValue) {
  if (!exerciseName) return;

  const sessions = getExerciseSessions(exerciseName, rangeValue);
  const logsForChart = sessions.flatMap((s) =>
    s.sets.map((set) => ({
      label: `${s.date} (${set.setNo}セット目)`,
      rm: estimate1RM(set.weight, set.reps),
    })),
  );

  const labels = logsForChart.map((x) => x.label);
  const data = logsForChart.map((x) => x.rm);

  const ctx = document.getElementById("rmChart").getContext("2d");

  if (rmChart) {
    rmChart.destroy();
  }

  rmChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `${exerciseName} の推定 1RM`,
          data,
          tension: 0.2,
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          labels: {
            boxWidth: 16,
          },
        },
      },
      scales: {
        y: {
          title: {
            display: true,
            text: "推定 1RM (kg)",
          },
        },
        x: {
          title: {
            display: true,
            text: "日付 / セット",
          },
        },
      },
    },
  });
}

// ----------------------
// 統計
// ----------------------
function renderStats(exerciseName, rangeValue) {
  statsDiv.innerHTML = "";

  if (!exerciseName) {
    statsDiv.textContent = "種目を選択すると統計が表示されます。";
    return;
  }

  const sessions = getExerciseSessions(exerciseName, rangeValue);
  if (sessions.length === 0) {
    statsDiv.textContent = "選択中の期間に記録がありません。";
    return;
  }

  const max1RM = Math.max(...sessions.map((s) => s.top1RM));
  const avg1RM =
    Math.round(
      (sessions.reduce((sum, s) => sum + s.top1RM, 0) / sessions.length) * 10,
    ) / 10;

  const avgVolume = Math.round(
    sessions.reduce((sum, s) => sum + s.volume, 0) / sessions.length,
  );

  const p1 = document.createElement("p");
  p1.textContent = `最大 1RM：${max1RM} kg`;

  const p2 = document.createElement("p");
  p2.textContent = `平均 1RM（トップセット）：${avg1RM} kg`;

  const p3 = document.createElement("p");
  p3.textContent = `平均ボリューム（1 セッションあたり）：${avgVolume} kg×rep`;

  statsDiv.appendChild(p1);
  statsDiv.appendChild(p2);
  statsDiv.appendChild(p3);
}

// ----------------------
// 種目別履歴
// ----------------------
function formatDiff(value, unit) {
  if (value > 0) return `+${value}${unit}`;
  if (value < 0) return `${value}${unit}`;
  return `±0${unit}`;
}

function renderHistory(exerciseName, rangeValue) {
  historyDiv.innerHTML = "";

  if (!exerciseName) {
    historyDiv.textContent = "種目を選択すると履歴が表示されます。";
    return;
  }

  const sessions = getExerciseSessions(exerciseName, rangeValue);
  if (sessions.length === 0) {
    historyDiv.textContent = "この期間には記録がありません。";
    return;
  }

  let shown = 0;
  for (let i = sessions.length - 1; i >= 0 && shown < 3; i--, shown++) {
    const s = sessions[i];
    const prev = i > 0 ? sessions[i - 1] : null;

    const title = document.createElement("h3");
    title.textContent = s.date;
    historyDiv.appendChild(title);

    const ul = document.createElement("ul");
    s.sets.forEach((log) => {
      let text = `${log.setNo}セット目: ${log.weight}kg × ${log.reps}回`;
      if (log.rpe) text += ` (RPE ${log.rpe})`;
      if (log.memo) text += ` - ${log.memo}`;
      const li = document.createElement("li");
      li.textContent = text;
      ul.appendChild(li);
    });
    historyDiv.appendChild(ul);

    const p = document.createElement("p");
    if (prev) {
      const diffW = s.topSet.weight - prev.topSet.weight;
      const diffR = s.topSet.reps - prev.topSet.reps;
      const diffRM = Math.round((s.top1RM - prev.top1RM) * 10) / 10;
      const diffVol = s.volume - prev.volume;

      p.textContent =
        `前回比（トップセット基準）: ` +
        `重量 ${formatDiff(diffW, "kg")} / ` +
        `回数 ${formatDiff(diffR, "回")} / ` +
        `1RM ${formatDiff(diffRM, "kg")} / ` +
        `ボリューム ${formatDiff(diffVol, "kg×rep")}`;
    } else {
      p.textContent = "この種目の初回セッションです。";
    }
    historyDiv.appendChild(p);
  }
}

// ----------------------
// トレ日別一覧
// ----------------------
function renderSessionByDate(dateStr) {
  dateSessionSummary.innerHTML = "";
  if (!dateStr) {
    dateSessionSummary.textContent = "記録がある日付から選択してください。";
    return;
  }

  const logsForDate = logs
    .filter((l) => l.date === dateStr)
    .sort((a, b) => {
      if (a.exercise === b.exercise) return (a.setNo || 0) - (b.setNo || 0);
      return a.exercise.localeCompare(b.exercise);
    });

  if (logsForDate.length === 0) {
    dateSessionSummary.textContent = "この日付の記録はありません。";
    return;
  }

  const bwLog = logsForDate.find((l) => l.bodyWeight != null);
  if (bwLog && bwLog.bodyWeight != null) {
    const pBw = document.createElement("p");
    pBw.textContent = `体重: ${bwLog.bodyWeight} kg`;
    dateSessionSummary.appendChild(pBw);
  }

  /** @type {Record<string, TrainingLog[]>} */
  const map = {};
  logsForDate.forEach((log) => {
    if (!map[log.exercise]) map[log.exercise] = [];
    map[log.exercise].push(log);
  });

  Object.keys(map)
    .sort()
    .forEach((exercise) => {
      const h3 = document.createElement("h3");
      h3.textContent = exercise;
      dateSessionSummary.appendChild(h3);

      const ul = document.createElement("ul");
      map[exercise]
        .slice()
        .sort((a, b) => (a.setNo || 0) - (b.setNo || 0))
        .forEach((log) => {
          let text = `${log.setNo}セット目: ${log.weight}kg × ${log.reps}回`;
          if (log.rpe) text += ` (RPE ${log.rpe})`;
          if (log.memo) text += ` - ${log.memo}`;
          const li = document.createElement("li");
          li.textContent = text;
          ul.appendChild(li);
        });
      dateSessionSummary.appendChild(ul);
    });
}

// ==============================
// Firestore I/O
// ==============================
async function saveLogToCloud(log) {
  try {
    await addDoc(collection(db, "trainingLogs"), log);
    console.log("🔥 Firestore に保存成功:", log);
  } catch (e) {
    console.error("❌ Firestore 保存失敗:", e);
  }
}

async function loadLogsFromCloud() {
  try {
    const querySnapshot = await getDocs(collection(db, "trainingLogs"));
    const loadedLogs = querySnapshot.docs.map((doc) => doc.data());
    console.log("✅ Firestore から読み込み成功:", loadedLogs);
    return loadedLogs;
  } catch (e) {
    console.error("❌ Firestore 読み込み失敗:", e);
    return [];
  }
}

// ----------------------
// フォーム送信
// ----------------------
form.addEventListener("submit", (e) => {
  e.preventDefault();

  const date = /** @type {HTMLInputElement} */ (
    document.getElementById("date")
  ).value;
  const bodyWeightRaw = /** @type {HTMLInputElement} */ (
    document.getElementById("bodyWeight")
  ).value;
  const exercise = /** @type {HTMLSelectElement} */ (
    document.getElementById("exercise")
  ).value;
  const setNo = Number(
    /** @type {HTMLInputElement} */ (document.getElementById("setNo")).value,
  ) || 1;
  const weight = Number(
    /** @type {HTMLInputElement} */ (document.getElementById("weight")).value,
  );
  const reps = Number(
    /** @type {HTMLInputElement} */ (document.getElementById("reps")).value,
  );
  const rpe = /** @type {HTMLInputElement} */ (
    document.getElementById("rpe")
  ).value;
  const memo = /** @type {HTMLInputElement} */ (
    document.getElementById("memo")
  ).value;

  if (!date || !exercise || !weight || !reps) {
    alert("日付・種目・重量・回数は必須です。");
    return;
  }

  const bodyWeight = bodyWeightRaw ? Number(bodyWeightRaw) : null;

  /** @type {TrainingLog} */
  const newLog = {
    date,
    bodyWeight,
    exercise,
    setNo,
    weight,
    reps,
    rpe: rpe || null,
    memo: memo || "",
  };

  logs.push(newLog);
  saveLogsToLocal(logs);
  saveLogToCloud(newLog);
  sendLogToSheet(newLog);

  const setNoInput = /** @type {HTMLInputElement} */ (
    document.getElementById("setNo")
  );
  setNoInput.value = String(setNo + 1);

  /** @type {HTMLInputElement} */ (document.getElementById("weight")).value = "";
  /** @type {HTMLInputElement} */ (document.getElementById("reps")).value = "";
  /** @type {HTMLInputElement} */ (document.getElementById("rpe")).value = "";
  /** @type {HTMLInputElement} */ (document.getElementById("memo")).value = "";

  renderAll();
});

// ----------------------
// ボタン類
// ----------------------
if (todayBtn) {
  todayBtn.addEventListener("click", () => {
    const dateInput = /** @type {HTMLInputElement} */ (
      document.getElementById("date")
    );
    dateInput.value = getTodayString();
  });
}

if (copyFirstSetBtn) {
  copyFirstSetBtn.addEventListener("click", () => {
    const dateInput = /** @type {HTMLInputElement} */ (
      document.getElementById("date")
    );
    const exerciseInput = /** @type {HTMLSelectElement} */ (
      document.getElementById("exercise")
    );
    const setNoInput = /** @type {HTMLInputElement} */ (
      document.getElementById("setNo")
    );
    const weightInput = /** @type {HTMLInputElement} */ (
      document.getElementById("weight")
    );
    const repsInput = /** @type {HTMLInputElement} */ (
      document.getElementById("reps")
    );
    const rpeInput = /** @type {HTMLInputElement} */ (
      document.getElementById("rpe")
    );
    const memoInput = /** @type {HTMLInputElement} */ (
      document.getElementById("memo")
    );
    const bwInput = /** @type {HTMLInputElement} */ (
      document.getElementById("bodyWeight")
    );

    const date = dateInput.value;
    const exercise = exerciseInput.value;

    if (!date || !exercise) {
      alert("先に日付と種目を選択し、1セット目を登録してください。");
      return;
    }

    const sameLogs = logs.filter(
      (l) => l.date === date && l.exercise === exercise,
    );
    if (sameLogs.length === 0) {
      alert("この日付・種目の記録がまだありません。まず 1 セット目を追加してください。");
      return;
    }

    const firstSet =
      sameLogs.find((l) => l.setNo === 1) ||
      sameLogs.reduce((min, l) => (l.setNo < min.setNo ? l : min), sameLogs[0]);

    const nextSetNo =
      sameLogs.reduce((max, l) => Math.max(max, l.setNo || 0), 0) + 1;

    setNoInput.value = String(nextSetNo);
    weightInput.value = String(firstSet.weight ?? "");
    repsInput.value = String(firstSet.reps ?? "");
    rpeInput.value = firstSet.rpe ?? "";
    memoInput.value = firstSet.memo ?? "";
    if (firstSet.bodyWeight != null) {
      bwInput.value = String(firstSet.bodyWeight);
    }
  });
}

// 部位ボタン
bodyPartButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    bodyPartButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const part = btn.getAttribute("data-part");
    currentBodyPart =
      part === "chest" ||
      part === "shoulder" ||
      part === "back" ||
      part === "legs" ||
      part === "arms" ||
      part === "other"
        ? part
        : "all";
    renderExerciseSelect();
  });
});

// カスタム種目追加
if (addCustomExBtn) {
  addCustomExBtn.addEventListener("click", () => {
    const name = customExInput.value.trim();
    if (!name) {
      alert("新しい種目名を入力してください。");
      return;
    }

    const allNames = getAllExerciseNamesFromSelect();
    if (allNames.includes(name)) {
      alert("その種目はすでに登録されています。");
      exerciseSelect.value = name;
      customExInput.value = "";
      return;
    }

    if (currentBodyPart === "all") {
      alert("先に部位（胸・肩・背中・脚・腕・その他）のどれかを選んでください。");
      return;
    }

    const newCustom = /** @type {CustomExercise} */ ({
      name,
      part: currentBodyPart,
    });

    customExercises.push(newCustom);
    saveCustomExercises(customExercises);
    customExInput.value = "";

    renderExerciseSelect();
    exerciseSelect.value = name;
  });
}

// 範囲セレクト
rangeSelect.addEventListener("change", () => {
  const ex = /** @type {HTMLSelectElement} */ (exerciseSelectForGraph).value;
  const range = /** @type {HTMLSelectElement} */ (rangeSelect).value;
  if (ex) {
    updateRmChart(ex, range);
    renderStats(ex, range);
    renderHistory(ex, range);
  }
});

// トレ日セレクト
if (dateSessionSelect) {
  dateSessionSelect.addEventListener("change", () => {
    const selected = /** @type {HTMLSelectElement} */ (dateSessionSelect).value;
    renderSessionByDate(selected);
  });
}

// ==============================
// 初期化
// ==============================
(async () => {
  setDefaultDate();

  customExercises = loadCustomExercises();
  renderExerciseSelect();

  logs = loadRecords();
  const cloudLogs = await loadLogsFromCloud();
  if (cloudLogs.length > 0) {
    logs = cloudLogs;
    saveLogsToLocal(logs);
    console.log(`🔥 ${cloudLogs.length}件のログを Firestore から読み込みました`);
  } else {
    console.log("ℹ️ Firestore にログがありません（ローカルのみ表示）");
  }

  renderAll();
})();
