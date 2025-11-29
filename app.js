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
  })
    .then(() => {
      console.log("📄 シートへ送信完了");
    })
    .catch((err) => {
      console.error("⚠ シートへの書き出し失敗:", err);
    });
}

// ==============================
// 型情報（JSDoc）
// ==============================
/**
 * @typedef {Object} TrainingLog
 * @property {string} date - YYYY-MM-DD
 * @property {number | null} [bodyWeight]
 * @property {string} exercise
 * @property {number} setNo
 * @property {number} weight
 * @property {number} reps
 * @property {string | null} [rpe]
 * @property {string} [memo]
 * @property {number | null} [distance]
 * @property {number | null} [duration]
 * @property {string | null} [speed]
 */

/**
 * @typedef {Object} ExerciseSession
 * @property {string} date
 * @property {TrainingLog[]} sets
 * @property {TrainingLog} topSet
 * @property {number} top1RM
 * @property {number} volume
 */

// ==============================
// 種目マスタ（カテゴリごと）
// ==============================
const BODY_PARTS = ["胸", "肩", "背中", "脚・下半身", "腕", "腹", "有酸素", "その他"];

const DEFAULT_EXERCISES = {
  胸: ["ベンチプレス", "インクラインダンベルプレス", "チェストプレス"],
  肩: ["オーバーヘッドプレス", "ダンベルショルダープレス", "サイドレイズ"],
  背中: ["ラットプルダウン", "シーテッドロウ", "ローロウ", "リアデルトフライ"],
  "脚・下半身": [
    "スクワット",
    "デッドリフト",
    "ルーマニアンデッドリフト",
    "レッグプレス",
    "レッグカール",
    "レッグエクステンション",
  ],
  腕: ["ケーブルカール", "ハンマーカール", "オーバーヘッドエクステンション"],
  腹: ["ケーブルクランチ", "アブローラー"],
  有酸素: ["ウォーキング", "バイク"],
  その他: ["ロータリートルソー"],
};

const CARDIO_BODY_PART = "有酸素";

// ==============================
// ローカルストレージ関連
// ==============================
const STORAGE_KEY = "trainingLog_v3";
const CUSTOM_EXERCISE_KEY = "trainingCustomExercises_v3";

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (e) {
    console.warn("loadRecords failed:", e);
    return [];
  }
}

function saveLogsToLocal(logs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch (e) {
    console.error("saveLogsToLocal failed:", e);
  }
}

/** @typedef {{ name: string; bodyPart: string }} CustomExercise */

function loadCustomExercises() {
  try {
    const raw = localStorage.getItem(CUSTOM_EXERCISE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
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

function getCustomExercisesFor(bodyPart) {
  const all = loadCustomExercises();
  return all.filter((c) => c.bodyPart === bodyPart).map((c) => c.name);
}

function getAllExerciseNames() {
  const set = new Set();
  BODY_PARTS.forEach((bp) => {
    (DEFAULT_EXERCISES[bp] || []).forEach((name) => set.add(name));
  });
  loadCustomExercises().forEach((c) => set.add(c.name));
  return Array.from(set);
}

function getCardioExerciseNames() {
  const defaults = DEFAULT_EXERCISES[CARDIO_BODY_PART] || [];
  const customs = getCustomExercisesFor(CARDIO_BODY_PART);
  return [...defaults, ...customs];
}

function isCardioExercise(exerciseName) {
  return getCardioExerciseNames().includes(exerciseName);
}

// ==============================
// ユーティリティ
// ==============================
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

function getExerciseSessions(exerciseName, rangeValue) {
  // 有酸素は 1RM グラフ・統計の対象外
  if (isCardioExercise(exerciseName)) return [];

  const filteredLogs = logs.filter(
    (log) => log.exercise === exerciseName && isWithinRange(log.date, rangeValue),
  );

  if (filteredLogs.length === 0) return [];

  const map = /** @type {Record<string, TrainingLog[]>} */ ({});
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
const exerciseSelect = document.getElementById("exercise");
const customExInput = document.getElementById("custom-ex-input");
const addCustomExBtn = document.getElementById("add-custom-ex-btn");
const bodyPartButtons = document.querySelectorAll(".body-part-btn");
const strengthFields = document.querySelectorAll(".strength-field");
const cardioFields = document.querySelectorAll(".cardio-field");

let currentBodyPart = "胸";
let rmChart = null;
let logs = loadRecords();

// ==============================
// フォーム用 種目セレクト描画
// ==============================
function renderExerciseOptionsForForm() {
  const select = /** @type {HTMLSelectElement} */ (exerciseSelect);
  if (!select) return;

  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "種目を選択";
  select.appendChild(placeholder);

  const defaults = DEFAULT_EXERCISES[currentBodyPart] || [];
  const customs = getCustomExercisesFor(currentBodyPart);
  const all = [...defaults, ...customs];

  all.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });

  updateFieldVisibilityByExercise(select.value);
}

function updateFieldVisibilityByExercise(exName) {
  const cardio = isCardioExercise(exName);

  strengthFields.forEach((el) => {
    el.style.display = cardio ? "none" : "";
  });

  cardioFields.forEach((el) => {
    el.style.display = cardio ? "" : "none";
  });
}

// ==============================
// 一覧・グラフなどの再描画
// ==============================
function renderAll() {
  renderList();
  updateExerciseOptionsForGraph();
  updateTrainingDateOptions();

  const ex = /** @type {HTMLSelectElement} */ (exerciseSelectForGraph).value;
  const range = /** @type {HTMLSelectElement} */ (rangeSelect).value;

  if (ex && !isCardioExercise(ex)) {
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

  const selectedDate = /** @type {HTMLSelectElement} */ (
    dateSessionSelect
  ).value;
  if (selectedDate) {
    renderSessionByDate(selectedDate);
  } else {
    dateSessionSummary.textContent = "記録がある日付から選択してください。";
  }
}

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

    let text;
    if (isCardioExercise(log.exercise)) {
      const parts = [];
      if (log.distance) parts.push(`${log.distance}km`);
      if (log.duration) parts.push(`${log.duration}分`);
      if (log.speed) parts.push(`${log.speed}`);
      text = `${log.date} / ${log.exercise} / ${parts.join(" / ")}`;
    } else {
      text = `${log.date} / ${log.exercise} / ${log.setNo}セット目 / ${log.weight}kg × ${log.reps}回`;
      if (log.rpe) {
        text += ` (RPE ${log.rpe})`;
      }
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
            (l.bodyWeight ?? null) === (log.bodyWeight ?? null) &&
            (l.distance ?? null) === (log.distance ?? null) &&
            (l.duration ?? null) === (log.duration ?? null) &&
            (l.speed ?? null) === (log.speed ?? null),
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

function updateExerciseOptionsForGraph() {
  const exercises = [
    ...new Set(
      logs
        .filter((log) => !isCardioExercise(log.exercise))
        .map((log) => log.exercise)
        .filter((name) => !!name),
    ),
  ];

  const current = /** @type {HTMLSelectElement} */ (
    exerciseSelectForGraph
  ).value;
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

function updateRmChart(exerciseName, rangeValue) {
  if (!exerciseName || isCardioExercise(exerciseName)) return;

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

function renderStats(exerciseName, rangeValue) {
  statsDiv.innerHTML = "";

  if (!exerciseName || isCardioExercise(exerciseName)) {
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

function formatDiff(value, unit) {
  if (value > 0) return `+${value}${unit}`;
  if (value < 0) return `${value}${unit}`;
  return `±0${unit}`;
}

function renderHistory(exerciseName, rangeValue) {
  historyDiv.innerHTML = "";

  if (!exerciseName || isCardioExercise(exerciseName)) {
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

  const map = /** @type {Record<string, TrainingLog[]>} */ ({});
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
      const isCardio = isCardioExercise(exercise);

      map[exercise]
        .slice()
        .sort((a, b) => (a.setNo || 0) - (b.setNo || 0))
        .forEach((log) => {
          let text;
          if (isCardio) {
            const parts = [];
            if (log.distance) parts.push(`${log.distance}km`);
            if (log.duration) parts.push(`${log.duration}分`);
            if (log.speed) parts.push(`${log.speed}`);
            text = parts.join(" / ");
          } else {
            text = `${log.setNo}セット目: ${log.weight}kg × ${log.reps}回`;
            if (log.rpe) text += ` (RPE ${log.rpe})`;
          }
          if (log.memo) text += ` - ${log.memo}`;
          const li = document.createElement("li");
          li.textContent = text;
          ul.appendChild(li);
        });
      dateSessionSummary.appendChild(ul);
    });
}

// ==============================
// Firestore 連携
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

// ==============================
// イベント: フォーム送信
// ==============================
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
  const setNo =
    Number(
      /** @type {HTMLInputElement} */ (document.getElementById("setNo")).value,
    ) || 1;
  const weightInput = /** @type {HTMLInputElement} */ (
    document.getElementById("weight")
  );
  const repsInput = /** @type {HTMLInputElement} */ (
    document.getElementById("reps")
  );
  const weight = Number(weightInput.value);
  const reps = Number(repsInput.value);
  const rpe = /** @type {HTMLInputElement} */ (
    document.getElementById("rpe")
  ).value;
  const memo = /** @type {HTMLInputElement} */ (
    document.getElementById("memo")
  ).value;

  // 部位ボタンから有酸素かどうか判定
  const activeBodypartBtn = /** @type {HTMLButtonElement | null} */ (
    document.querySelector(".bodypart-btn.is-active")
  );
  const bodypart = activeBodypartBtn?.dataset.bodypart || "";
  const isCardio = bodypart === "有酸素";

  // 有酸素用入力欄（存在しない場合もあるので ? 付きで取得）
  const cardioDistanceInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById("cardio-distance")
  );
  const cardioTimeInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById("cardio-time")
  );
  const cardioSpeedInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById("cardio-speed")
  );

  const cardioDistanceRaw = cardioDistanceInput?.value ?? "";
  const cardioTimeRaw = cardioTimeInput?.value ?? "";
  const cardioSpeedRaw = cardioSpeedInput?.value ?? "";

  // ---- 必須チェック ----
  if (!date || !exercise) {
    if (isCardio) {
      alert("日付・種目・時間は必須です。");
    } else {
      alert("日付・種目・重量・回数は必須です。");
    }
    return;
  }

  if (isCardio) {
    // 有酸素：時間だけ必須（距離・速度は空欄OK）
    if (cardioTimeRaw.trim() === "") {
      alert("日付・種目・時間は必須です。");
      return;
    }
  } else {
    // 通常の筋トレ：重量・回数は必須
    if (!date || !exercise) {
  alert("日付・種目は必須です。");
  return;
}
  }

  const bodyWeight = bodyWeightRaw ? Number(bodyWeightRaw) : null;

  const cardioDistance =
    isCardio && cardioDistanceRaw.trim() !== ""
      ? Number(cardioDistanceRaw)
      : null;
  const cardioTime =
    isCardio && cardioTimeRaw.trim() !== "" ? Number(cardioTimeRaw) : null;
  const cardioSpeed =
    isCardio && cardioSpeedRaw.trim() !== "" ? Number(cardioSpeedRaw) : null;

  // 有酸素のときは RM 計算に影響しないよう重量・回数は 0 を入れておく
  const logWeight = isCardio ? 0 : weight;
  const logReps = isCardio ? 0 : reps;

  /** @type {TrainingLog} */
  const newLog = {
    date,
    bodyWeight,
    exercise,
    setNo,
    weight: logWeight,
    reps: logReps,
    rpe: rpe || null,
    memo: memo || "",
    // 有酸素用フィールド（存在しない場合は無視される）
    cardioDistance,
    cardioTime,
    cardioSpeed,
    isCardio,
  };

  // ローカル / Firestore / シートの 3 か所に保存
  logs.push(newLog);
  saveLogsToLocal(logs);
  saveLogToCloud(newLog);
  sendLogToSheet(newLog);

  // 次セット入力をしやすくする（体重はそのまま残す）
  const setNoInput = /** @type {HTMLInputElement} */ (
    document.getElementById("setNo")
  );
  setNoInput.value = String(setNo + 1);

  if (isCardio) {
    if (cardioDistanceInput) cardioDistanceInput.value = "";
    if (cardioTimeInput) cardioTimeInput.value = "";
    if (cardioSpeedInput) cardioSpeedInput.value = "";
  } else {
    weightInput.value = "";
    repsInput.value = "";
    /** @type {HTMLInputElement} */ (document.getElementById("rpe")).value = "";
  }

  /** @type {HTMLInputElement} */ (document.getElementById("memo")).value = "";

  renderAll();
});

// ==============================
// イベント: ボタン類
// ==============================
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

    if (isCardioExercise(exercise)) {
      alert("有酸素種目では 1 セット目コピー機能は使用しません。");
      return;
    }

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

if (addCustomExBtn && customExInput && exerciseSelect) {
  addCustomExBtn.addEventListener("click", () => {
    const input = /** @type {HTMLInputElement} */ (customExInput);
    const select = /** @type {HTMLSelectElement} */ (exerciseSelect);
    const name = input.value.trim();
    if (!name) {
      alert("新しい種目名を入力してください。");
      return;
    }

    const existing = getAllExerciseNames();
    if (existing.includes(name)) {
      alert("その種目はすでに登録されています。");
      select.value = name;
      input.value = "";
      updateFieldVisibilityByExercise(name);
      return;
    }

    const stored = loadCustomExercises();
    stored.push({ name, bodyPart: currentBodyPart });
    saveCustomExercises(stored);

    renderExerciseOptionsForForm();
    select.value = name;
    input.value = "";
    updateFieldVisibilityByExercise(name);
  });
}

bodyPartButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const bodyPart = btn.getAttribute("data-body-part");
    if (!bodyPart) return;
    currentBodyPart = bodyPart;

    bodyPartButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    renderExerciseOptionsForForm();
  });
});

rangeSelect.addEventListener("change", () => {
  const ex = /** @type {HTMLSelectElement} */ (exerciseSelectForGraph).value;
  const range = /** @type {HTMLSelectElement} */ (rangeSelect).value;
  if (ex && !isCardioExercise(ex)) {
    updateRmChart(ex, range);
    renderStats(ex, range);
    renderHistory(ex, range);
  }
});

if (dateSessionSelect) {
  dateSessionSelect.addEventListener("change", () => {
    const selected = /** @type {HTMLSelectElement} */ (
      dateSessionSelect
    ).value;
    renderSessionByDate(selected);
  });
}

// 種目プルダウン変更時に筋トレ／有酸素のフィールド切り替え
if (exerciseSel
