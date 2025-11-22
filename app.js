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
// ★ここを自分の Web アプリ URL に置き換える（すでにあなたの URL を設定済み）
const SHEET_WEBHOOK_URL =
  "https://script.google.com/macros/s/AKfycbwwoKPVulUclvzJ19GOTMaQXY1BMKGZtEp7QqPaizhma8clylPSqzlxmPu0KOmP84ISlw/exec";

/**
 * ログ 1 件をスプレッドシートに送信
 * @param {TrainingLog} log
 */
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
// ローカルストレージ関連
// ==============================
const STORAGE_KEY = "trainingLog_v2"; // お好みで名前変更 OK

/** ローカルストレージから既存データをロード（なければ空配列） */
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

/** ローカルストレージへ保存 */
function saveLogsToLocal(logs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch (e) {
    console.error("saveLogsToLocal failed:", e);
  }
}

// ==============================
// DOM 要素の取得
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

let rmChart = null;

// ローカルストレージから既存ログを読み込み
/** @type {TrainingLog[]} */
let logs = loadRecords();

// ----------------------
// ユーティリティ
// ----------------------
/** 推定 1RM (Epley の式) */
function estimate1RM(weight, reps) {
  if (!weight || !reps) return null;
  const rm = weight * (1 + reps / 30);
  return Math.round(rm * 10) / 10; // 小数 1 桁で丸める
}

/** 期間フィルタ（all / 30 / 90 日） */
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
 * 種目ごとのセッション（=トレーニング日）一覧を取得
 * @param {string} exerciseName
 * @param {string} rangeValue
 * @returns {ExerciseSession[]}
 */
function getExerciseSessions(exerciseName, rangeValue) {
  const filteredLogs = logs.filter(
    (log) => log.exercise === exerciseName && isWithinRange(log.date, rangeValue),
  );

  if (filteredLogs.length === 0) return [];

  // 日付ごとにグループ化
  const map = /** @type {Record<string, TrainingLog[]>} */ ({});
  filteredLogs.forEach((log) => {
    if (!map[log.date]) map[log.date] = [];
    map[log.date].push(log);
  });

  const dates = Object.keys(map).sort(); // 昇順（古い → 新しい）

  return dates.map((date) => {
    const sets = map[date]
      .slice()
      .sort((a, b) => (a.setNo || 0) - (b.setNo || 0));

    // トップセット（重量優先・同じなら回数多い方）
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

/** 今日の日付文字列 (YYYY-MM-DD) を取得 */
function getTodayString() {
  const today = new Date();
  return today.toISOString().slice(0, 10);
}

/** 今日の日付を date input に自動セット */
function setDefaultDate() {
  const dateInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById("date")
  );
  if (!dateInput) return;
  if (!dateInput.value) {
    dateInput.value = getTodayString();
  }
}

// ----------------------
// 保存＆再描画
// ----------------------
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

  const selectedDate = /** @type {HTMLSelectElement} */ (
    dateSessionSelect
  ).value;
  if (selectedDate) {
    renderSessionByDate(selectedDate);
  } else {
    dateSessionSummary.textContent = "記録がある日付から選択してください。";
  }
}

// ----------------------
// 記録一覧を描画
// ----------------------
function renderList() {
  list.innerHTML = "";

  // 日付昇順 → セット番号昇順で並べ替え
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

    // クリックで削除
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

  // 直前に選んでいた種目がまだ存在すればそれを維持
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
  ].sort((a, b) => b.localeCompare(a)); // 新しい日付から

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
    // デフォルトで最新の日付を選択
    selectEl.value = dates[0];
  }
}

// ----------------------
// 推定 1RM グラフ更新
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
// 統計表示（最大 1RM・平均 1RM・平均ボリューム）
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
// 種目別履歴（最近 3 回のトレ日 + 前回比）
// ----------------------
function formatDiff(value, unit) {
  if (value > 0) return `+${value}${unit}`;
  if (value < 0) return `${value}${unit}`; // マイナスはそのまま
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

  // 最新から 3 セッション分を表示
  let shown = 0;
  for (let i = sessions.length - 1; i >= 0 && shown < 3; i--, shown++) {
    const s = sessions[i];
    const prev = i > 0 ? sessions[i - 1] : null;

    const title = document.createElement("h3");
    title.textContent = s.date;
    historyDiv.appendChild(title);

    // セットごとの一覧
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

    // 前回比
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
// トレーニング日別の一覧表示
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

  // 種目ごとにグルーピング
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
// Firestore に 1 件のログを保存する
// ==============================
async function saveLogToCloud(log) {
  try {
    await addDoc(collection(db, "trainingLogs"), log);
    console.log("🔥 Firestore に保存成功:", log);
  } catch (e) {
    console.error("❌ Firestore 保存失敗:", e);
  }
}

// ==============================
// Firestore から全データを読み込む
// ==============================
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

  // ローカル / Firestore / シートの 3 か所に保存
  logs.push(newLog);
  saveLogsToLocal(logs); // localStorage
  saveLogToCloud(newLog); // Firestore
  sendLogToSheet(newLog); // Google スプレッドシート

  // 次セット入力をしやすくする（体重はそのまま残す）
  const setNoInput = /** @type {HTMLInputElement} */ (
    document.getElementById("setNo")
  );
  setNoInput.value = String(setNo + 1);

  /** @type {HTMLInputElement} */ (document.getElementById("weight")).value =
    "";
  /** @type {HTMLInputElement} */ (document.getElementById("reps")).value =
    "";
  /** @type {HTMLInputElement} */ (document.getElementById("rpe")).value =
    "";
  /** @type {HTMLInputElement} */ (document.getElementById("memo")).value =
    "";

  renderAll();
});

// ----------------------
// ボタン類のイベント
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

// ----------------------
// セレクト変更時の再描画
// ----------------------
exerciseSelectForGraph.addEventListener("change", () => {
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
});

rangeSelect.addEventListener("change", () => {
  const ex = /** @type {HTMLSelectElement} */ (exerciseSelectForGraph).value;
  const range = /** @type {HTMLSelectElement} */ (rangeSelect).value;
  if (ex) {
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

// ----------------------
// 初期表示：Firestore から読み込み → ローカルにも同期
// ----------------------
(async () => {
  setDefaultDate();

  const cloudLogs = await loadLogsFromCloud();
  if (cloudLogs.length > 0) {
    logs = cloudLogs;
    saveLogsToLocal(logs); // ローカルにも同期
    console.log(`🔥 ${cloudLogs.length}件のログを Firestore から読み込みました`);
  } else {
    console.log("ℹ️ Firestore にログがありません（ローカルのみ表示）");
  }

  renderAll();
})();
