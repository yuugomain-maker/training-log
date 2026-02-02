/*
  目的：
  - スプレッドシート自動反映は廃止（ネットワーク依存を減らす）
  - 代わりに CSV 出力 / CSV インポート
  - UI をスマホ寄りに（下ナビ / 履歴カード / 詳細画面）
  - RPE はスライダー廃止 → 6〜10 を 0.5刻みボタン選択
  - 履歴の並びは「入力順（createdAt）」を基準に安定化
*/

// =====================
// ストレージ
// =====================
const STORAGE_LOGS = "training_logs_v1";
const STORAGE_EX_MASTER = "training_ex_master_v1";

// =====================
// 部位・初期種目
// =====================
// ※「背中」が「戻る」になる事故を避けるため、文字列を固定
const PARTS = ["胸", "肩", "背中", "脚", "腕", "腹", "酸素あり", "その他"]; // UI表示

// マスタ上は内部キーを揃える（酸素あり → 有酸素）
const PART_KEY_MAP = {
  "胸": "胸",
  "肩": "肩",
  "背中": "背中",
  "脚": "脚",
  "腕": "腕",
  "腹": "腹",
  "酸素あり": "有酸素",
  "その他": "その他",
};

const DEFAULT_EXERCISES = [
  { name: "ベンチプレス", part: "胸", type: "筋トレ" },
  { name: "インクラインダンベルプレス", part: "胸", type: "筋トレ" },
  { name: "チェストプレス", part: "胸", type: "筋トレ" },

  { name: "オーバーヘッドプレス", part: "肩", type: "筋トレ" },
  { name: "ダンベルショルダープレス", part: "肩", type: "筋トレ" },
  { name: "サイドレイズ", part: "肩", type: "筋トレ" },

  { name: "ラットプルダウン", part: "背中", type: "筋トレ" },
  { name: "シーテッドロウ", part: "背中", type: "筋トレ" },
  { name: "リアデルトフライ", part: "背中", type: "筋トレ" },

  { name: "スクワット", part: "脚", type: "筋トレ" },
  { name: "ルーマニアンデッドリフト", part: "脚", type: "筋トレ" },
  { name: "レッグプレス", part: "脚", type: "筋トレ" },

  { name: "ケーブルカール", part: "腕", type: "筋トレ" },
  { name: "ハンマーカール", part: "腕", type: "筋トレ" },

  { name: "ケーブルクランチ", part: "腹", type: "筋トレ" },
  { name: "アブローラー", part: "腹", type: "筋トレ" },

  { name: "ウォーキングマシン", part: "有酸素", type: "有酸素" },
  { name: "ウォーキング", part: "有酸素", type: "有酸素" },
  { name: "バイク", part: "有酸素", type: "有酸素" },

  { name: "ロータリートルソー", part: "その他", type: "筋トレ" },
];

// =====================
// DOM
// =====================
const $ = (id) => document.getElementById(id);

const pageRecord = $("page-record");
const pageHistory = $("page-history");
const pageDetail = $("page-history-detail");
const pageAnalysis = $("page-analysis");
const pageSettings = $("page-settings");

const dateInput = $("date");
const partChips = $("part-chips");
const exSelect = $("exercise-select");
const setMinus = $("set-minus");
const setPlus = $("set-plus");
const setNoEl = $("set-no");

const strengthFields = $("strength-fields");
const cardioFields = $("cardio-fields");

const weightInput = $("weight");
const repsInput = $("reps");
const rpeGrid = $("rpe-grid");
const rpeClear = $("rpe-clear");

const distanceInput = $("distance");
const durationInput = $("duration");
const speedInput = $("speed");

const bodyWeightInput = $("bodyWeight");
const memoInput = $("memo");
const saveBtn = $("save-btn");
const saveHint = $("save-hint");

const recentBox = $("recent-box");
const recentList = $("recent-list");

const historyList = $("history-list");
const csvExportBtn = $("csv-export");

const detailBack = $("detail-back");
const detailCopy = $("detail-copy");
const detailTitle = $("detail-title");
const detailBody = $("detail-body");

const analysisExercise = $("analysis-exercise");
const analysisHistory = $("analysis-history");
const analysisHint = $("analysis-hint");

const csvImport = $("csv-import");
const addExerciseBtn = $("add-exercise-btn");
const exerciseMaster = $("exercise-master");

const modal = $("modal");
const modalClose = $("modal-close");
const modalAdd = $("modal-add");
const modalHint = $("modal-hint");
const newExName = $("new-ex-name");
const newExPart = $("new-ex-part");
const newExType = $("new-ex-type");

let rmChart = null;

// =====================
// 状態
// =====================
/** @type {Array<any>} */
let logs = loadLogs();
/** @type {Array<{name:string, part:string, type:'筋トレ'|'有酸素'}>} */
let exMaster = loadExerciseMaster();

let currentPartUi = "胸"; // UI表示
let currentSetNo = 1;
let selectedRpe = null;
let currentDetailDate = null;

// =====================
// 初期化
// =====================
init();

function init(){
  // 日付初期値
  dateInput.value = today();

  // 部位チップ描画
  renderPartChips();

  // 種目マスタ描画
  renderExerciseMaster();

  // 記録画面の種目選択
  refreshExerciseSelect();

  // RPE ボタン
  renderRpeButtons();

  // セット +/-
  setMinus.addEventListener("click", ()=>{
    currentSetNo = Math.max(1, currentSetNo - 1);
    setNoEl.textContent = String(currentSetNo);
  });
  setPlus.addEventListener("click", ()=>{
    currentSetNo += 1;
    setNoEl.textContent = String(currentSetNo);
  });

  // 種目変更で入力フィールド切替 + 直近表示
  exSelect.addEventListener("change", ()=>{
    syncFieldsByExercise();
    renderRecent();
  });

  // RPE クリア
  rpeClear.addEventListener("click", ()=>{
    selectedRpe = null;
    Array.from(document.querySelectorAll(".rpe-btn")).forEach(b=>b.classList.remove("active"));
  });

  // 保存
  saveBtn.addEventListener("click", onSave);

  // 履歴
  csvExportBtn.addEventListener("click", exportCsv);

  // 詳細
  detailBack.addEventListener("click", ()=>{
    showPage("history");
  });
  detailCopy.addEventListener("click", copyDetailText);

  // 分析
  analysisExercise.addEventListener("change", renderAnalysis);

  // 設定：CSVインポート
  csvImport.addEventListener("change", onCsvImport);

  // 種目追加
  addExerciseBtn.addEventListener("click", openModal);
  modalClose.addEventListener("click", closeModal);
  modal.addEventListener("click", (e)=>{ if(e.target === modal) closeModal(); });
  modalAdd.addEventListener("click", onAddExercise);

  // モーダルの部位選択（UI部位→内部部位キーに変換）
  newExPart.innerHTML = "";
  PARTS.forEach(p=>{
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    newExPart.appendChild(opt);
  });
  newExPart.value = "胸";

  // 下ナビ
  document.querySelectorAll(".nav-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const page = btn.dataset.page;
      showPage(page);
    });
  });

  // 初回表示
  showPage("record");
  renderHistory();
  renderAnalysisOptions();
  renderAnalysis();
  syncFieldsByExercise();
  renderRecent();
}

// =====================
// UI: ページ切替
// =====================
function showPage(page){
  pageRecord.style.display = page === "record" ? "" : "none";
  pageHistory.style.display = page === "history" ? "" : "none";
  pageDetail.style.display = page === "detail" ? "" : "none";
  pageAnalysis.style.display = page === "analysis" ? "" : "none";
  pageSettings.style.display = page === "settings" ? "" : "none";

  // ナビのactive
  document.querySelectorAll(".nav-btn").forEach(b=>{
    b.classList.toggle("active", b.dataset.page === page);
  });

  if(page === "history"){
    renderHistory();
  }
  if(page === "analysis"){
    renderAnalysisOptions();
    renderAnalysis();
  }
  if(page === "settings"){
    renderExerciseMaster();
  }
}

// =====================
// 部位チップ
// =====================
function renderPartChips(){
  partChips.innerHTML = "";

  PARTS.forEach((p)=>{
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (p === currentPartUi ? " active" : "");
    btn.textContent = p;

    btn.addEventListener("click", ()=>{
      currentPartUi = p;
      Array.from(partChips.children).forEach(x=>x.classList.remove("active"));
      btn.classList.add("active");
      refreshExerciseSelect();
      syncFieldsByExercise();
      renderRecent();
    });

    partChips.appendChild(btn);
  });
}

// =====================
// 種目セレクト
// =====================
function refreshExerciseSelect(){
  const internalPart = PART_KEY_MAP[currentPartUi] || currentPartUi;

  const list = exMaster
    .filter(x=>x.part === internalPart)
    .map(x=>x.name)
    .sort((a,b)=>a.localeCompare(b, "ja"));

  exSelect.innerHTML = "";
  if(list.length === 0){
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "種目がありません（設定で追加）";
    exSelect.appendChild(opt);
    return;
  }

  list.forEach(name=>{
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    exSelect.appendChild(opt);
  });

  // 可能なら直前の選択を維持
  const prev = localStorage.getItem("_last_exercise") || "";
  if(prev && list.includes(prev)) exSelect.value = prev;

  // それでも空なら先頭
  if(!exSelect.value) exSelect.value = list[0];

  localStorage.setItem("_last_exercise", exSelect.value);
}

function getExerciseMeta(name){
  return exMaster.find(x=>x.name === name) || null;
}

function syncFieldsByExercise(){
  const meta = getExerciseMeta(exSelect.value);
  const isCardio = meta?.type === "有酸素";

  strengthFields.style.display = isCardio ? "none" : "";
  cardioFields.style.display = isCardio ? "" : "none";
}

// =====================
// RPE
// =====================
function renderRpeButtons(){
  rpeGrid.innerHTML = "";
  for(let r=6; r<=10.0001; r+=0.5){
    const val = Math.round(r*10)/10;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rpe-btn";
    btn.textContent = String(val);
    btn.addEventListener("click", ()=>{
      selectedRpe = val;
      Array.from(document.querySelectorAll(".rpe-btn")).forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
    });
    rpeGrid.appendChild(btn);
  }
}

// =====================
// 保存
// =====================
function onSave(){
  saveHint.textContent = "";

  const date = dateInput.value || today();
  const internalPart = PART_KEY_MAP[currentPartUi] || currentPartUi;
  const exercise = exSelect.value;
  const meta = getExerciseMeta(exercise);
  const type = meta?.type || "筋トレ";

  if(!exercise){
    alert("種目を選択してください");
    return;
  }

  const createdAt = Date.now();

  /** @type {any} */
  const log = {
    id: cryptoRandomId(),
    createdAt,
    date,
    part: internalPart,
    type,
    exercise,
    setNo: currentSetNo,
    bodyWeight: bodyWeightInput.value ? Number(bodyWeightInput.value) : null,
    memo: memoInput.value ? String(memoInput.value) : "",
    weight: null,
    reps: null,
    rpe: null,
    distance: null,
    duration: null,
    speed: null,
  };

  if(type === "有酸素"){
    // 有酸素
    const dist = distanceInput.value ? Number(distanceInput.value) : null;
    const dur = durationInput.value ? Number(durationInput.value) : null;
    const spd = speedInput.value ? String(speedInput.value).trim() : "";

    // 有酸素は「距離or時間」どちらかは欲しい
    if(dist == null && dur == null){
      alert("有酸素は距離(km)か時間(分)のどちらかを入力してください");
      return;
    }

    log.distance = dist;
    log.duration = dur;
    log.speed = spd || null;

    // 筋トレ欄は 0 扱いにしない（CSVや表示で混乱する）
    log.weight = null;
    log.reps = null;
    log.rpe = null;

  } else {
    // 筋トレ
    const w = weightInput.value ? Number(weightInput.value) : null;
    const r = repsInput.value ? Number(repsInput.value) : null;

    if(w == null || r == null || !w || !r){
      alert("筋トレは重量と回数を入力してください");
      return;
    }

    log.weight = w;
    log.reps = r;
    log.rpe = selectedRpe;

    // 有酸素欄は null
    log.distance = null;
    log.duration = null;
    log.speed = null;
  }

  logs.push(log);
  persistLogs();

  // 次セットへ
  currentSetNo += 1;
  setNoEl.textContent = String(currentSetNo);

  // 入力の一部だけクリア（体重は残す）
  weightInput.value = "";
  repsInput.value = "";
  distanceInput.value = "";
  durationInput.value = "";
  speedInput.value = "";

  selectedRpe = null;
  Array.from(document.querySelectorAll(".rpe-btn")).forEach(b=>b.classList.remove("active"));

  saveHint.textContent = "✅ 記録しました";

  // 履歴・分析更新
  renderHistory();
  renderAnalysisOptions();
  renderAnalysis();
  renderRecent();
}

// =====================
// 直近表示（同種目）
// =====================
function renderRecent(){
  const ex = exSelect.value;
  if(!ex){
    recentBox.style.display = "none";
    return;
  }

  // 同種目の直近（今選択日以前で、createdAt降順）
  const list = logs
    .filter(l=>l.exercise === ex)
    .slice()
    .sort((a,b)=> (b.createdAt||0) - (a.createdAt||0))
    .slice(0, 1);

  if(list.length === 0){
    recentBox.style.display = "none";
    return;
  }

  recentBox.style.display = "";
  recentList.innerHTML = "";
  const l = list[0];

  const box = document.createElement("div");
  box.className = "exercise-card";
  const left = `${l.date} / ${l.exercise}`;
  let mid = "";
  if(l.type === "有酸素"){
    const parts = [];
    if(l.distance != null) parts.push(`${l.distance}km`);
    if(l.duration != null) parts.push(`${l.duration}分`);
    if(l.speed) parts.push(`速度 ${l.speed}`);
    mid = parts.join(" / ");
  } else {
    mid = `${l.weight}kg × ${l.reps}回` + (l.rpe != null ? `  (RPE ${l.rpe})` : "");
  }

  box.innerHTML = `<div class="exercise-head"><div>${left}</div><span class="pill">直近</span></div><div style="font-weight:900">${mid}</div>`;
  recentList.appendChild(box);
}

// =====================
// 履歴（一覧）
// =====================
function renderHistory(){
  // 日付ごとに集計
  const byDate = new Map();
  for(const l of logs){
    if(!l.date) continue;
    if(!byDate.has(l.date)) byDate.set(l.date, []);
    byDate.get(l.date).push(l);
  }

  const dates = Array.from(byDate.keys()).sort((a,b)=> b.localeCompare(a));

  historyList.innerHTML = "";
  if(dates.length === 0){
    historyList.innerHTML = `<div class="hint">まだ記録がありません。</div>`;
    return;
  }

  for(const d of dates){
    const items = byDate.get(d)
      .slice()
      // 同日内は入力順（createdAt昇順）→ setNo昇順で安定
      .sort((a,b)=>{
        const ca = a.createdAt || 0;
        const cb = b.createdAt || 0;
        if(ca !== cb) return ca - cb;
        return (a.setNo||0) - (b.setNo||0);
      });

    const setCount = items.length;
    const cardioCount = items.filter(x=>x.type === "有酸素").length;

    const card = document.createElement("div");
    card.className = "card";

    card.innerHTML = `
      <div class="card-left">
        <div class="cal">📅</div>
        <div style="min-width:0">
          <div class="card-title">${formatDateJp(d)}</div>
          <div class="card-sub">${setCount} セット${cardioCount ? ` / 有酸素 ${cardioCount}件` : ""}</div>
        </div>
      </div>
      <div class="chev">›</div>
    `;

    card.addEventListener("click", ()=>{
      openDetail(d);
    });

    historyList.appendChild(card);
  }
}

// =====================
// 履歴（詳細）
// =====================
function openDetail(date){
  currentDetailDate = date;
  detailTitle.textContent = formatDateJp(date);

  // 同日のログを入力順に並べる（筋トレ/有酸素混在でも順序は崩さない）
  const items = logs
    .filter(l=>l.date === date)
    .slice()
    .sort((a,b)=>{
      const ca = a.createdAt || 0;
      const cb = b.createdAt || 0;
      if(ca !== cb) return ca - cb;
      return (a.setNo||0) - (b.setNo||0);
    });

  // 種目ごと（ただし順序は最初に出現した順）
  const order = [];
  const map = new Map();
  for(const l of items){
    if(!map.has(l.exercise)){
      map.set(l.exercise, []);
      order.push(l.exercise);
    }
    map.get(l.exercise).push(l);
  }

  detailBody.innerHTML = "";

  // 体重（あれば最初の1件から）
  const bw = items.find(x=>x.bodyWeight != null)?.bodyWeight ?? null;
  if(bw != null){
    const p = document.createElement("div");
    p.className = "pill";
    p.textContent = `体重 ${bw} kg`;
    p.style.margin = "0 0 10px";
    detailBody.appendChild(p);
  }

  for(const ex of order){
    const sets = map.get(ex)
      .slice()
      .sort((a,b)=>{
        const ca = a.createdAt || 0;
        const cb = b.createdAt || 0;
        if(ca !== cb) return ca - cb;
        return (a.setNo||0) - (b.setNo||0);
      });

    const box = document.createElement("div");
    box.className = "exercise-card";

    const head = document.createElement("div");
    head.className = "exercise-head";
    head.innerHTML = `<div>${ex}</div><span class="pill">${sets[0]?.type || ""}</span>`;
    box.appendChild(head);

    // 表示（入力順）
    for(const s of sets){
      const row = document.createElement("div");
      row.className = "set-row-view";

      const left = document.createElement("div");
      left.className = "set-left";
      left.textContent = s.type === "有酸素" ? "—" : `セット${s.setNo}`;

      const mid = document.createElement("div");
      mid.className = "set-mid";
      if(s.type === "有酸素"){
        const parts = [];
        if(s.distance != null) parts.push(`${s.distance}km`);
        if(s.duration != null) parts.push(`${s.duration}分`);
        if(s.speed) parts.push(`速度 ${s.speed}`);
        mid.textContent = parts.join("  ");
      } else {
        mid.textContent = `${s.weight}kg × ${s.reps}回`;
      }

      const right = document.createElement("div");
      right.className = "set-right";
      if(s.type === "有酸素"){
        right.textContent = "";
      } else {
        right.textContent = s.rpe != null ? `RPE ${s.rpe}` : "";
      }

      row.appendChild(left);
      row.appendChild(mid);
      row.appendChild(right);
      box.appendChild(row);

      if(s.memo){
        const memo = document.createElement("div");
        memo.style.color = "#94a3b8";
        memo.style.fontWeight = "800";
        memo.style.marginTop = "6px";
        memo.textContent = `メモ: ${s.memo}`;
        box.appendChild(memo);
      }
    }

    detailBody.appendChild(box);
  }

  showPage("detail");
}

function copyDetailText(){
  if(!currentDetailDate) return;

  const items = logs
    .filter(l=>l.date === currentDetailDate)
    .slice()
    .sort((a,b)=>{
      const ca = a.createdAt || 0;
      const cb = b.createdAt || 0;
      if(ca !== cb) return ca - cb;
      return (a.setNo||0) - (b.setNo||0);
    });

  const lines = [];
  lines.push(formatDateJp(currentDetailDate));

  const bw = items.find(x=>x.bodyWeight != null)?.bodyWeight ?? null;
  if(bw != null) lines.push(`体重: ${bw}kg`);

  // 種目ごと（最初に出現した順）
  const order = [];
  const map = new Map();
  for(const l of items){
    if(!map.has(l.exercise)){
      map.set(l.exercise, []);
      order.push(l.exercise);
    }
    map.get(l.exercise).push(l);
  }

  for(const ex of order){
    lines.push("");
    lines.push(`■ ${ex}`);

    const sets = map.get(ex)
      .slice()
      .sort((a,b)=>{
        const ca = a.createdAt || 0;
        const cb = b.createdAt || 0;
        if(ca !== cb) return ca - cb;
        return (a.setNo||0) - (b.setNo||0);
      });

    for(const s of sets){
      if(s.type === "有酸素"){
        const parts = [];
        if(s.distance != null) parts.push(`${s.distance}km`);
        if(s.duration != null) parts.push(`${s.duration}分`);
        if(s.speed) parts.push(`速度 ${s.speed}`);
        lines.push(`- 有酸素: ${parts.join(" / ")}`);
      } else {
        lines.push(`- セット${s.setNo}: ${s.weight}kg×${s.reps}回${s.rpe!=null?` (RPE ${s.rpe})`:""}`);
      }
      if(s.memo) lines.push(`  メモ: ${s.memo}`);
    }
  }

  navigator.clipboard.writeText(lines.join("
"))
    .then(()=> alert("コピーしました"))
    .catch(()=> alert("コピーに失敗しました（ブラウザ権限を確認）"));
}

// =====================
// 分析
// =====================
function renderAnalysisOptions(){
  // 筋トレ種目のみ
  const exSet = new Set();
  logs.forEach(l=>{
    if(l.type === "筋トレ" && l.exercise) exSet.add(l.exercise);
  });

  const list = Array.from(exSet).sort((a,b)=>a.localeCompare(b, "ja"));
  const prev = analysisExercise.value;

  analysisExercise.innerHTML = "";

  if(list.length === 0){
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "筋トレ記録がありません";
    analysisExercise.appendChild(opt);
    return;
  }

  list.forEach(name=>{
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    analysisExercise.appendChild(opt);
  });

  if(prev && list.includes(prev)){
    analysisExercise.value = prev;
  }
}

function renderAnalysis(){
  const ex = analysisExercise.value;
  analysisHistory.innerHTML = "";

  if(!ex){
    analysisHint.textContent = "筋トレ記録がありません。";
    destroyChart();
    return;
  }

  const items = logs
    .filter(l=>l.exercise === ex && l.type === "筋トレ")
    .slice()
    .sort((a,b)=>{
      // 日付→入力順
      if(a.date !== b.date) return a.date.localeCompare(b.date);
      const ca = a.createdAt || 0;
      const cb = b.createdAt || 0;
      if(ca !== cb) return ca - cb;
      return (a.setNo||0) - (b.setNo||0);
    });

  if(items.length === 0){
    analysisHint.textContent = "この種目の記録がありません。";
    destroyChart();
    return;
  }

  // セッション（同日まとめ、トップセットは最大重量→同重量なら回数）
  const byDate = new Map();
  for(const l of items){
    if(!byDate.has(l.date)) byDate.set(l.date, []);
    byDate.get(l.date).push(l);
  }

  const dates = Array.from(byDate.keys()).sort((a,b)=>a.localeCompare(b));
  const sessions = dates.map(d=>{
    const sets = byDate.get(d).slice().sort((a,b)=>{
      const ca = a.createdAt || 0;
      const cb = b.createdAt || 0;
      if(ca !== cb) return ca - cb;
      return (a.setNo||0) - (b.setNo||0);
    });

    let top = sets[0];
    for(const s of sets){
      if(s.weight > top.weight || (s.weight === top.weight && s.reps > top.reps)) top = s;
    }

    const top1rm = estimate1RM(top.weight, top.reps);
    return { date:d, top, top1rm, sets };
  });

  // グラフ
  const labels = sessions.map(s=>s.date);
  const data = sessions.map(s=>s.top1rm);

  drawChart(labels, data, `${ex} 推定1RM（トップセット）`);
  analysisHint.textContent = `直近 ${Math.min(8, sessions.length)} セッションを表示（トップセット）`;

  // 直近履歴
  const recent = sessions.slice().reverse().slice(0, 8);
  for(const s of recent){
    const box = document.createElement("div");
    box.className = "exercise-card";

    const head = document.createElement("div");
    head.className = "exercise-head";
    head.innerHTML = `<div>${s.date}</div><span class="pill">1RM ${s.top1rm}kg</span>`;
    box.appendChild(head);

    s.sets.forEach(x=>{
      const row = document.createElement("div");
      row.className = "set-row-view";

      row.innerHTML = `
        <div class="set-left">セット${x.setNo}</div>
        <div class="set-mid">${x.weight}kg × ${x.reps}回</div>
        <div class="set-right">${x.rpe!=null?`RPE ${x.rpe}`:""}</div>
      `;
      box.appendChild(row);
    });

    analysisHistory.appendChild(box);
  }
}

function estimate1RM(weight, reps){
  if(!weight || !reps) return 0;
  const rm = weight * (1 + reps/30);
  return Math.round(rm*10)/10;
}

function drawChart(labels, data, title){
  const ctx = document.getElementById("rmChart").getContext("2d");
  destroyChart();

  rmChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: title,
        data,
        tension: 0.2,
        pointRadius: 3,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { boxWidth: 14 } },
      },
      scales: {
        y: { title: { display:true, text:"推定1RM (kg)" } },
        x: { title: { display:true, text:"日付" } },
      }
    }
  });
}

function destroyChart(){
  if(rmChart){
    rmChart.destroy();
    rmChart = null;
  }
}

// =====================
// 設定：種目マスタ
// =====================
function renderExerciseMaster(){
  exerciseMaster.innerHTML = "";

  // 部位ごと
  const groups = new Map();
  for(const ex of exMaster){
    if(!groups.has(ex.part)) groups.set(ex.part, []);
    groups.get(ex.part).push(ex);
  }

  const parts = Array.from(groups.keys()).sort((a,b)=>a.localeCompare(b, "ja"));

  for(const part of parts){
    const section = document.createElement("div");
    section.className = "exercise-card";

    const head = document.createElement("div");
    head.className = "exercise-head";
    head.innerHTML = `<div>${part}</div><span class="pill">${groups.get(part).length}種目</span>`;
    section.appendChild(head);

    const list = groups.get(part).slice().sort((a,b)=>a.name.localeCompare(b.name, "ja"));

    for(const item of list){
      const row = document.createElement("div");
      row.className = "set-row-view";

      const left = document.createElement("div");
      left.className = "set-mid";
      left.textContent = item.name;

      const right = document.createElement("button");
      right.type = "button";
      right.className = "link-btn";
      right.style.color = "#ef4444";
      right.textContent = "削除";

      right.addEventListener("click", (e)=>{
        e.stopPropagation();
        if(!confirm(`「${item.name}」を削除しますか？`)) return;

        // マスタから削除
        exMaster = exMaster.filter(x=>x.name !== item.name);
        saveExerciseMaster();

        // 既存ログの種目名は残す（過去参照のため）。
        // ここでログまで消すのは危険なのでやらない。

        renderExerciseMaster();
        refreshExerciseSelect();
        renderAnalysisOptions();
        renderAnalysis();
      });

      row.innerHTML = "";
      const leftWrap = document.createElement("div");
      leftWrap.style.display = "flex";
      leftWrap.style.flexDirection = "column";
      leftWrap.style.gap = "2px";
      leftWrap.appendChild(left);

      const sub = document.createElement("div");
      sub.style.color = "#94a3b8";
      sub.style.fontWeight = "800";
      sub.style.fontSize = ".85rem";
      sub.textContent = item.type;
      leftWrap.appendChild(sub);

      row.appendChild(leftWrap);
      row.appendChild(right);
      section.appendChild(row);
    }

    exerciseMaster.appendChild(section);
  }
}

function openModal(){
  modalHint.textContent = "";
  newExName.value = "";
  newExPart.value = currentPartUi;
  newExType.value = (PART_KEY_MAP[currentPartUi] === "有酸素") ? "有酸素" : "筋トレ";
  modal.style.display = "";
}

function closeModal(){
  modal.style.display = "none";
}

function onAddExercise(){
  modalHint.textContent = "";
  const name = String(newExName.value || "").trim();
  const partUi = newExPart.value;
  const part = PART_KEY_MAP[partUi] || partUi;
  const type = newExType.value;

  if(!name){
    modalHint.textContent = "種目名を入力してください";
    return;
  }

  if(exMaster.some(x=>x.name === name)){
    modalHint.textContent = "その種目名はすでに存在します";
    return;
  }

  exMaster.push({ name, part, type });
  saveExerciseMaster();

  closeModal();

  // UI反映
  renderExerciseMaster();
  refreshExerciseSelect();
  renderAnalysisOptions();
  renderAnalysis();
}

// =====================
// CSV
// =====================
function exportCsv(){
  const header = [
    "createdAt",
    "date",
    "part",
    "type",
    "exercise",
    "setNo",
    "weight",
    "reps",
    "rpe",
    "distance",
    "duration",
    "speed",
    "bodyWeight",
    "memo",
  ];

  // createdAt昇順（入力順）
  const rows = logs
    .slice()
    .sort((a,b)=>(a.createdAt||0)-(b.createdAt||0))
    .map(l=>[
      l.createdAt ?? "",
      l.date ?? "",
      l.part ?? "",
      l.type ?? "",
      l.exercise ?? "",
      l.setNo ?? "",
      l.weight ?? "",
      l.reps ?? "",
      l.rpe ?? "",
      l.distance ?? "",
      l.duration ?? "",
      l.speed ?? "",
      l.bodyWeight ?? "",
      (l.memo ?? "").replace(/
?
/g, " "),
    ]);

  const csv = [header, ...rows]
    .map(r=>r.map(escapeCsv).join(","))
    .join("
");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `training_logs_${today().replaceAll("-", "")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function escapeCsv(v){
  const s = String(v ?? "");
  if(/[",
]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

async function onCsvImport(){
  const file = csvImport.files?.[0];
  if(!file) return;

  const text = await file.text();
  const parsed = parseCsv(text);
  if(parsed.length < 2){
    alert("CSVの内容が不足しています");
    csvImport.value = "";
    return;
  }

  const header = parsed[0].map(x=>x.trim());
  const idx = (name) => header.indexOf(name);

  // 必須っぽい列
  const iDate = idx("date");
  const iExercise = idx("exercise");
  if(iDate === -1 || iExercise === -1){
    alert("CSVに date / exercise 列がありません");
    csvImport.value = "";
    return;
  }

  // 取り込み
  let imported = 0;

  for(let r=1; r<parsed.length; r++){
    const row = parsed[r];
    if(row.length === 0) continue;

    const createdAt = Number(row[idx("createdAt")]) || Date.now();
    const date = row[iDate] || "";
    const exercise = row[iExercise] || "";

    if(!date || !exercise) continue;

    const log = {
      id: cryptoRandomId(),
      createdAt,
      date,
      part: row[idx("part")] || "",
      type: row[idx("type")] || "筋トレ",
      exercise,
      setNo: Number(row[idx("setNo")]) || 1,
      weight: toNullableNumber(row[idx("weight")]),
      reps: toNullableNumber(row[idx("reps")]),
      rpe: toNullableNumber(row[idx("rpe")]),
      distance: toNullableNumber(row[idx("distance")]),
      duration: toNullableNumber(row[idx("duration")]),
      speed: row[idx("speed")] || null,
      bodyWeight: toNullableNumber(row[idx("bodyWeight")]),
      memo: row[idx("memo")] || "",
    };

    logs.push(log);
    imported++;
  }

  persistLogs();
  alert(`CSVを取り込みました：${imported}件`);
  csvImport.value = "";

  renderHistory();
  renderAnalysisOptions();
  renderAnalysis();
}

function toNullableNumber(v){
  if(v == null) return null;
  const s = String(v).trim();
  if(!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ざっくりCSVパーサ（ダブルクォート対応）
function parseCsv(text){
  const rows = [];
  let row = [];
  let cur = "";
  let inQ = false;

  for(let i=0;i<text.length;i++){
    const ch = text[i];

    if(inQ){
      if(ch === '"'){
        const next = text[i+1];
        if(next === '"'){
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }

    if(ch === '"'){
      inQ = true;
      continue;
    }

    if(ch === ','){
      row.push(cur);
      cur = "";
      continue;
    }

    if(ch === '
'){
      row.push(cur.replace(/
/g, ""));
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }

    cur += ch;
  }

  // last
  row.push(cur.replace(/
/g, ""));
  rows.push(row);

  // 空行削除
  return rows.filter(r=>!(r.length===1 && r[0].trim()===""));
}

// =====================
// 永続化
// =====================
function loadLogs(){
  try{
    const raw = localStorage.getItem(STORAGE_LOGS);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  }catch{
    return [];
  }
}

function persistLogs(){
  localStorage.setItem(STORAGE_LOGS, JSON.stringify(logs));
}

function loadExerciseMaster(){
  try{
    const raw = localStorage.getItem(STORAGE_EX_MASTER);
    const parsed = raw ? JSON.parse(raw) : null;
    if(Array.isArray(parsed) && parsed.length){
      return parsed;
    }
  }catch{}

  // 初期投入
  localStorage.setItem(STORAGE_EX_MASTER, JSON.stringify(DEFAULT_EXERCISES));
  return DEFAULT_EXERCISES.slice();
}

function saveExerciseMaster(){
  localStorage.setItem(STORAGE_EX_MASTER, JSON.stringify(exMaster));
}

// =====================
// util
// =====================
function today(){
  return new Date().toISOString().slice(0,10);
}

function formatDateJp(dateStr){
  // YYYY-MM-DD -> M月D日（曜）
  const d = new Date(dateStr + "T00:00:00");
  if(Number.isNaN(d.getTime())) return dateStr;

  const w = ["日","月","火","水","木","金","土"][d.getDay()];
  return `${d.getMonth()+1}月${d.getDate()}日（${w}）`;
}

function cryptoRandomId(){
  if(typeof crypto !== "undefined" && crypto.getRandomValues){
    const a = new Uint32Array(4);
    crypto.getRandomValues(a);
    return Array.from(a).map(x=>x.toString(16)).join("");
  }
  return String(Date.now()) + "_" + Math.random().toString(16).slice(2);
}
