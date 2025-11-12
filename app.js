// === 永続化関連 ==========================
const STORAGE_KEY = 'trainingLog_v2';     // お好みで名前変更OK

// ローカルストレージから既存データをロード（なければ空配列）
function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('loadRecords failed:', e);
    return [];
  }
}

// 変更があったら毎回呼ぶ

// =======================================


// 要素の取得
const form = document.getElementById("log-form");
const list = document.getElementById("log-list");
const exerciseSelectForGraph = document.getElementById("exercise-select");
const rangeSelect = document.getElementById("range-select");
const historyDiv = document.getElementById("history");
const statsDiv = document.getElementById("stats");

let rmChart = null;

// localStorage（STORAGE_KEY）から既存ログを読み込み
let logs = loadRecords();


// ----------------------
// ユーティリティ
// ----------------------
function estimate1RM(weight, reps) {
  if (!weight || !reps) return null;
  const rm = weight * (1 + reps / 30);  // Epleyの式
  return Math.round(rm * 10) / 10;      // 小数1桁で丸める
}

// 期間フィルタ（all / 30 / 90 日）
function isWithinRange(dateStr, rangeValue) {
  if (!dateStr) return false;
  if (rangeValue === "all") return true;

  const days = parseInt(rangeValue, 10);
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;

  const today = new Date();
  const diffMs = today - d;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= days;
}

// 種目ごとのセッション（=トレーニング日）一覧を取得
function getExerciseSessions(exerciseName, rangeValue) {
  const filteredLogs = logs.filter(
    log => log.exercise === exerciseName && isWithinRange(log.date, rangeValue)
  );

  if (filteredLogs.length === 0) return [];

  // 日付ごとにグループ化
  const map = {};
  filteredLogs.forEach(log => {
    if (!map[log.date]) map[log.date] = [];
    map[log.date].push(log);
  });

  const dates = Object.keys(map).sort(); // 昇順（古い→新しい）

  return dates.map(date => {
    const sets = map[date].slice().sort((a, b) => (a.setNo || 0) - (b.setNo || 0));

    // トップセット（重量優先・同じなら回数多い方）
    let topSet = sets[0];
    sets.forEach(s => {
      if (
        s.weight > topSet.weight ||
        (s.weight === topSet.weight && s.reps > topSet.reps)
      ) {
        topSet = s;
      }
    });

    const top1RM = estimate1RM(topSet.weight, topSet.reps);
    const volume = sets.reduce((sum, s) => sum + s.weight * s.reps, 0);

    return { date, sets, topSet, top1RM, volume };
  });
}

// ----------------------
// 保存＆再描画
// ----------------------
function saveLogs() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
}


function renderAll() {
  renderList();
  updateExerciseOptionsForGraph();

  const ex = exerciseSelectForGraph.value;
  const range = rangeSelect.value;

  if (ex) {
    updateRmChart(ex, range);
    renderStats(ex, range);
    renderHistory(ex, range);
  } else {
    statsDiv.textContent = "種目を選択すると統計が表示されます。";
    renderHistory("", range);
  }
}

// ----------------------
// 記録一覧を描画
// ----------------------
function renderList() {
  list.innerHTML = "";

  logs.forEach((log, index) => {
    const li = document.createElement("li");

    let text = `${log.date} / ${log.exercise} / ${log.setNo}セット目 / ${log.weight}kg × ${log.reps}回`;
    if (log.rpe) {
      text += ` (RPE ${log.rpe})`;
    }
    if (log.memo) {
      text += ` - ${log.memo}`;
    }

    li.textContent = text;

    // クリックで削除
    li.addEventListener("click", () => {
      if (confirm("この記録を削除しますか？")) {
        logs.splice(index, 1);
        saveLogs();
        renderAll();
      }
    });

    list.appendChild(li);
  });
}

// ----------------------
// グラフ用セレクト更新
// ----------------------
function updateExerciseOptionsForGraph() {
  const exercises = [...new Set(
    logs.map(log => log.exercise).filter(name => !!name)
  )];

  exerciseSelectForGraph.innerHTML = "";

  if (exercises.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "まだ記録がありません";
    exerciseSelectForGraph.appendChild(option);
    return;
  }

  exercises.forEach(name => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    exerciseSelectForGraph.appendChild(option);
  });

  if (!exerciseSelectForGraph.value && exercises.length > 0) {
    exerciseSelectForGraph.value = exercises[0];
  }
}

// ----------------------
// 推定1RMグラフ更新
// ----------------------
function updateRmChart(exerciseName, rangeValue) {
  if (!exerciseName) return;

  const sessions = getExerciseSessions(exerciseName, rangeValue);
  const logsForChart = sessions.flatMap(s =>
    s.sets.map(set => ({
      label: `${s.date} (${set.setNo}セット目)`,
      rm: estimate1RM(set.weight, set.reps)
    }))
  );

  const labels = logsForChart.map(x => x.label);
  const data = logsForChart.map(x => x.rm);

  const ctx = document.getElementById("rmChart").getContext("2d");

  if (rmChart) {
    rmChart.destroy();
  }

  rmChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: `${exerciseName} の推定1RM`,
        data,
        tension: 0.2,
        pointRadius: 3,
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          title: {
            display: true,
            text: "推定1RM (kg)"
          }
        },
        x: {
          title: {
            display: true,
            text: "日付 / セット"
          }
        }
      }
    }
  });
}

// ----------------------
// 統計表示（最大1RM・平均1RM・平均ボリューム）
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

  const max1RM = Math.max(...sessions.map(s => s.top1RM));
  const avg1RM = Math.round(
    (sessions.reduce((sum, s) => sum + s.top1RM, 0) / sessions.length) * 10
  ) / 10;

  const avgVolume = Math.round(
    sessions.reduce((sum, s) => sum + s.volume, 0) / sessions.length
  );

  const p1 = document.createElement("p");
  p1.textContent = `最大1RM：${max1RM} kg`;

  const p2 = document.createElement("p");
  p2.textContent = `平均1RM（トップセット）：${avg1RM} kg`;

  const p3 = document.createElement("p");
  p3.textContent = `平均ボリューム（1セッションあたり）：${avgVolume} kg×rep`;

  statsDiv.appendChild(p1);
  statsDiv.appendChild(p2);
  statsDiv.appendChild(p3);
}

// ----------------------
// 種目別履歴（最近3回のトレ日 + 前回比）
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

  // 最新から3セッション分を表示
  let shown = 0;
  for (let i = sessions.length - 1; i >= 0 && shown < 3; i--, shown++) {
    const s = sessions[i];
    const prev = i > 0 ? sessions[i - 1] : null;

    const title = document.createElement("h3");
    title.textContent = s.date;
    historyDiv.appendChild(title);

    // セットごとの一覧
    const ul = document.createElement("ul");
    s.sets.forEach(log => {
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
// フォーム送信
// ----------------------
form.addEventListener("submit", (e) => {
  e.preventDefault();

  const date = document.getElementById("date").value;
  const exercise = document.getElementById("exercise").value;
  const setNo = Number(document.getElementById("setNo").value) || 1;
  const weight = Number(document.getElementById("weight").value);
  const reps = Number(document.getElementById("reps").value);
  const rpe = document.getElementById("rpe").value;
  const memo = document.getElementById("memo").value;

  if (!date || !exercise || !weight || !reps) {
    alert("日付・種目・重量・回数は必須です。");
    return;
  }

  const newLog = {
    date,
    exercise,
    setNo,
    weight,
    reps,
    rpe: rpe || null,
    memo: memo || ""
  };

  logs.push(newLog);
  saveLogs();

  // 次セット入力をしやすくする
  document.getElementById("setNo").value = setNo + 1;
  document.getElementById("weight").value = "";
  document.getElementById("reps").value = "";
  document.getElementById("rpe").value = "";
  document.getElementById("memo").value = "";

  renderAll();
});

// グラフ用セレクト変更時
exerciseSelectForGraph.addEventListener("change", () => {
  const ex = exerciseSelectForGraph.value;
  const range = rangeSelect.value;
  if (ex) {
    updateRmChart(ex, range);
    renderStats(ex, range);
    renderHistory(ex, range);
  } else {
    statsDiv.textContent = "種目を選択すると統計が表示されます。";
    renderHistory("", range);
  }
});

// 期間変更時
rangeSelect.addEventListener("change", () => {
  renderAll();
});

// 初期表示
renderAll();
