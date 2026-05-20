// Men's Rise Report v2 - Front analysis tab (Step 2)

const COLORS = {
  bg: '#f8f9fa',
  surface: '#ffffff',
  border: '#e5e7eb',
  text: '#1f2937',
  textSub: '#6b7280',
  accent: '#2563eb',
  accent2: '#1d4ed8',
  good: '#16a34a',
  info: '#0891b2',
  warn: '#d97706',
  danger: '#dc2626',
};

// Chart.js global defaults
if (window.Chart) {
  Chart.defaults.color = COLORS.text;
  Chart.defaults.borderColor = COLORS.border;
  Chart.defaults.font.family = '-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif';
}

const state = {
  data: { factFront: [], factConsult: [], meta: null },
  filters: {
    period: 'all',
    date_from: '',
    date_to: '',
    source: 'all',
    age: 'all',
    occupation: 'all',
    answered: 'all',
    exclude_test: 'yes',
  },
  charts: {},
};

// --- Utility ---
function uniq(arr) {
  return [...new Set(arr)].filter(v => v != null && v !== '').sort();
}

function groupBy(items, key) {
  const map = new Map();
  for (const it of items) {
    const k = it[key];
    if (k == null || k === '') continue;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function isTestRecord(r) {
  // フロント側のテスト判定: acquisition_source が空、または明らかに少件のテスト
  // 個相側: front_source/consultation_source/concern_free/desired_future に "テスト" を含む
  const fields = [
    r.acquisition_source, r.front_source, r.consultation_source, r.referral_source,
    r.concern_free, r.desired_future, r.question, r.success_factor, r.loss_factor,
  ];
  return fields.some(v => typeof v === 'string' && /テスト/i.test(v));
}

// --- Filters ---
function matchFilters(r, isConsult = false) {
  const f = state.filters;

  // テストデータ除外
  if (f.exclude_test === 'yes' && isTestRecord(r)) return false;

  // 期間
  if (f.period !== 'all') {
    const ts = isConsult ? (r.applied_at || r.front_line_at) : r.registered_at;
    if (!ts) return false;
    const t = new Date(String(ts).replace(' ', 'T'));
    if (isNaN(t)) return false;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const DAY = 86400000;

    if (f.period === 'today') {
      if (t < today || t >= new Date(today.getTime() + DAY)) return false;
    } else if (f.period === 'yesterday') {
      const y = new Date(today.getTime() - DAY);
      if (t < y || t >= today) return false;
    } else if (f.period === '7d') {
      if (t < new Date(today.getTime() - 7 * DAY)) return false;
    } else if (f.period === '30d') {
      if (t < new Date(today.getTime() - 30 * DAY)) return false;
    } else if (f.period === '90d') {
      if (t < new Date(today.getTime() - 90 * DAY)) return false;
    } else if (f.period === 'this_week') {
      const dow = today.getDay(); // 0=Sun
      const weekStart = new Date(today.getTime() - dow * DAY);
      if (t < weekStart) return false;
    } else if (f.period === 'last_week') {
      const dow = today.getDay();
      const weekStart = new Date(today.getTime() - dow * DAY);
      const lastStart = new Date(weekStart.getTime() - 7 * DAY);
      if (t < lastStart || t >= weekStart) return false;
    } else if (f.period === 'this_month') {
      if (t.getFullYear() !== now.getFullYear() || t.getMonth() !== now.getMonth()) return false;
    } else if (f.period === 'last_month') {
      const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      if (t.getFullYear() !== last.getFullYear() || t.getMonth() !== last.getMonth()) return false;
    } else if (f.period === 'this_year') {
      if (t.getFullYear() !== now.getFullYear()) return false;
    } else if (f.period === 'custom') {
      if (f.date_from) {
        const from = new Date(f.date_from + 'T00:00:00');
        if (t < from) return false;
      }
      if (f.date_to) {
        const to = new Date(f.date_to + 'T23:59:59');
        if (t > to) return false;
      }
    }
  }

  // 経路
  if (f.source !== 'all') {
    const src = isConsult ? r.front_source : r.acquisition_source;
    if (src !== f.source) return false;
  }

  // 年代
  if (f.age !== 'all' && r.age_band !== f.age) return false;

  // 職業
  if (f.occupation !== 'all' && r.occupation !== f.occupation) return false;

  // アンケート回答（フロント専用）
  if (!isConsult) {
    if (f.answered === 'yes' && !r.has_answered_survey) return false;
    if (f.answered === 'no' && r.has_answered_survey) return false;
  }

  return true;
}

function filterFront() { return state.data.factFront.filter(r => matchFilters(r, false)); }

// --- Rendering: Front tab ---
function renderFront() {
  const all = filterFront();
  const answered = all.filter(r => r.has_answered_survey);

  // KPIs
  setText('kpi-total', all.length.toLocaleString());
  setText('kpi-answered', answered.length.toLocaleString());
  const rate = all.length ? (answered.length / all.length * 100).toFixed(1) : '0.0';
  setText('kpi-rate', rate + '%');
  const topSrc = groupBy(all, 'acquisition_source')[0];
  if (topSrc) {
    setText('kpi-top-source', topSrc[0]);
    setText('kpi-top-source-sub', `${topSrc[1].toLocaleString()}件（${(topSrc[1] / all.length * 100).toFixed(1)}%）`);
  } else {
    setText('kpi-top-source', '-');
    setText('kpi-top-source-sub', '-');
  }
  setText('kpi-answered-sub', all.length ? `全体の ${(answered.length / all.length * 100).toFixed(1)}%` : '-');

  // 経路 Top 15
  const srcTop = groupBy(all, 'acquisition_source').slice(0, 15);
  renderHBar('chart-source', srcTop, '登録経路 Top 15');

  // 属性分布（グラフ + テーブル）
  const ageBroadData = sortAgeBroad(groupBy(answered, 'age_broad'));
  renderHBar('chart-age-broad', ageBroadData, '年代（大区分）');
  renderDataTable('table-age-broad', ageBroadData, answered.length);

  const ageDataFine = sortAgeBand(groupBy(answered, 'age_band').filter(([k]) => isFineAgeBand(k)));
  const ageFineTotal = ageDataFine.reduce((s, [, v]) => s + v, 0);
  renderHBar('chart-age', ageDataFine, '年代（細区分）');
  renderDataTable('table-age', ageDataFine, ageFineTotal);

  const occupationData = groupBy(answered, 'occupation');
  renderHBar('chart-occupation', occupationData, '職業');
  renderDataTable('table-occupation', occupationData, answered.length);

  const concernData = groupBy(answered, 'top_concern');
  renderHBar('chart-concern', concernData, '悩み（選択肢）');
  renderDataTable('table-concern', concernData, answered.length);

  // クロス
  renderCross('cross-age-broad-occupation', answered, 'age_broad', 'occupation', { rowLimit: 10, colLimit: 10 });
  renderCross('cross-age-occupation', answered, 'age_band', 'occupation', { rowSort: 'age', rowKeyFilter: isFineAgeBand, colLimit: 10 });
  renderCross('cross-source-age-broad', all, 'acquisition_source', 'age_broad', { rowLimit: 15 });
  renderCross('cross-source-age', all, 'acquisition_source', 'age_band', { rowLimit: 15, colSort: 'age', colKeyFilter: isFineAgeBand });
  renderCross('cross-source-concern', answered, 'acquisition_source', 'top_concern', { rowLimit: 15 });
}

const AGE_ORDER = ['～19歳', '20歳～24歳', '25歳～29歳', '30歳～34歳', '35歳～39歳',
                   '40歳～44歳', '45歳～49歳', '50歳以上', '50歳～54歳', '55歳～59歳', '60歳以上',
                   '10代以下（～19歳）', '20代（20歳～29歳）', '30代（30歳～39歳）', '40代（40歳～49歳）', '50代（50歳～59歳）', '50歳以上',
                   '20代', '30代', '40代', '50代', '60代以上'];
const INCOME_ORDER = ['100万円以下', '100〜300万円', '100万円〜300万円', '300万円〜500万円', '500万円〜1000万円', '1000万円以上', '1000万円〜2000万円', '2000万円以上'];
const BUDGET_ORDER = ['1万円以下', '1万〜3万円', '3万〜5万円', '5万〜10万円', '10万〜20万円', 'それ以上', '20万円以上'];
const INTENT_ORDER = [
  '入会を全く考えていない',
  '入会をあまり考えていない',
  '入会するか悩んでいる',
  '入会を前向きに検討している',
  '入会をほぼ決めている',
  '入会を決めており今すぐ始めたい',
];
const RESULT_ORDER = ['成約', '言質', '検討中', '失注', '対象外'];

function sortByOrder(entries, order) {
  return entries.slice().sort((a, b) => {
    const ai = order.indexOf(a[0]);
    const bi = order.indexOf(b[0]);
    if (ai === -1 && bi === -1) return b[1] - a[1];
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function sortAgeBand(entries) { return sortByOrder(entries, AGE_ORDER); }

// 年代を大区分に正規化（細区分が混在しているため）
const AGE_BROAD_ORDER = ['10代以下', '20代', '30代', '40代', '50代以上'];
function getAgeBroad(ageBand) {
  if (!ageBand) return null;
  const s = String(ageBand);
  if (s.includes('～19歳') || s.startsWith('10代')) return '10代以下';
  if (/2\d歳/.test(s) || s.startsWith('20代')) return '20代';
  if (/3\d歳/.test(s) || s.startsWith('30代')) return '30代';
  if (/4\d歳/.test(s) || s.startsWith('40代')) return '40代';
  if (/5\d歳/.test(s) || s.startsWith('50代') || s.includes('50歳以上') || s.startsWith('60')) return '50代以上';
  return s;
}
function sortAgeBroad(entries) { return sortByOrder(entries, AGE_BROAD_ORDER); }

// 細区分として有効な値か判定（大区分のみの値=旧アンケート由来は除外）
function isFineAgeBand(s) {
  if (!s) return false;
  // "20代（20歳～29歳）" 等の大区分括弧書きを除外
  if (/^\d+代/.test(s) && s.includes('（')) return false;
  // "20代", "30代以上" のような大区分単独を除外
  if (/^\d+代(以下|以上)?$/.test(s)) return false;
  // "60代以上" を除外
  if (s === '60代以上') return false;
  return true;
}
function sortIncomeBand(entries) { return sortByOrder(entries, INCOME_ORDER); }
function sortBudget(entries) { return sortByOrder(entries, BUDGET_ORDER); }
function sortIntent(entries) { return sortByOrder(entries, INTENT_ORDER); }
function sortResult(entries) { return sortByOrder(entries, RESULT_ORDER); }

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function renderHBar(canvasId, data, title) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (state.charts[canvasId]) state.charts[canvasId].destroy();
  if (data.length === 0) {
    const c = ctx.getContext('2d');
    c.clearRect(0, 0, ctx.width, ctx.height);
    c.fillStyle = COLORS.textSub;
    c.font = '14px sans-serif';
    c.textAlign = 'center';
    c.fillText('データなし', ctx.width / 2, ctx.height / 2);
    return;
  }
  state.charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(([k]) => String(k).length > 28 ? String(k).slice(0, 26) + '…' : k),
      datasets: [{
        label: title,
        data: data.map(([, v]) => v),
        backgroundColor: COLORS.accent,
        borderColor: COLORS.accent2,
        borderWidth: 1,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: title, color: COLORS.accent2, font: { size: 13, weight: '600' } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total ? (ctx.parsed.x / total * 100).toFixed(1) : 0;
              return ` ${ctx.parsed.x.toLocaleString()} (${pct}%)`;
            },
            title: (items) => {
              // フルラベルを表示（切り詰められた場合のため）
              const idx = items[0].dataIndex;
              return data[idx][0];
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: COLORS.textSub }, grid: { color: COLORS.border } },
        y: { ticks: { color: COLORS.text, font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

function renderDataTable(containerId, entries, total) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (entries.length === 0) {
    container.innerHTML = '<div style="padding:20px;color:var(--text-sub);text-align:center;font-size:12px">データなし</div>';
    return;
  }
  let html = '<table class="data-table"><thead><tr><th>項目</th><th>件数</th><th>割合</th></tr></thead><tbody>';
  for (const [k, v] of entries) {
    const pct = total ? (v / total * 100).toFixed(1) : '0.0';
    html += `<tr><td>${escapeHtml(k)}</td><td>${v.toLocaleString()}</td><td>${pct}%</td></tr>`;
  }
  html += `<tr class="total-row"><td>合計</td><td>${total.toLocaleString()}</td><td>100.0%</td></tr>`;
  html += '</tbody></table>';
  container.innerHTML = html;
}

function renderCross(containerId, items, rowKey, colKey, opts = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // 集計
  const rowCounts = new Map();
  const colCounts = new Map();
  const cells = new Map();
  for (const it of items) {
    const r = it[rowKey] || '（未設定）';
    const c = it[colKey] || '（未設定）';
    rowCounts.set(r, (rowCounts.get(r) || 0) + 1);
    colCounts.set(c, (colCounts.get(c) || 0) + 1);
    const k = r + '' + c;
    cells.set(k, (cells.get(k) || 0) + 1);
  }

  // 行: rowSort='age' なら年代順、それ以外は件数降順
  let rows = [...rowCounts.entries()];
  if (opts.rowKeyFilter) rows = rows.filter(([k]) => opts.rowKeyFilter(k));
  if (opts.rowSort === 'age') {
    rows = sortAgeBand(rows);
  } else {
    rows = rows.sort((a, b) => b[1] - a[1]);
    if (opts.rowLimit) rows = rows.slice(0, opts.rowLimit);
  }

  // 列: colSort='age' なら年代順、それ以外は件数降順上位N件（default 8）
  let cols = [...colCounts.entries()];
  if (opts.colKeyFilter) cols = cols.filter(([k]) => opts.colKeyFilter(k));
  if (opts.colSort === 'age') {
    cols = sortAgeBand(cols);
  } else {
    cols = cols.sort((a, b) => b[1] - a[1]);
    cols = cols.slice(0, opts.colLimit || 8);
  }

  // ヒートマップ用に最大セル値を取得
  let maxCell = 0;
  for (const [r] of rows) {
    for (const [c] of cols) {
      const v = cells.get(r + '' + c) || 0;
      if (v > maxCell) maxCell = v;
    }
  }

  // テーブル生成
  let html = '<table class="cross"><thead><tr><th></th>';
  for (const [c, total] of cols) {
    html += `<th>${escapeHtml(c)}<br><span style="font-weight:400;color:${COLORS.textSub};font-size:10px">${total.toLocaleString()}</span></th>`;
  }
  html += '<th>計</th></tr></thead><tbody>';
  for (const [r, rowTotal] of rows) {
    html += `<tr><td><strong>${escapeHtml(r)}</strong></td>`;
    for (const [c] of cols) {
      const v = cells.get(r + '' + c) || 0;
      const pct = rowTotal ? (v / rowTotal * 100) : 0;
      const heat = pct > 0 ? Math.min(5, Math.max(1, Math.ceil(pct / 20))) : 0;
      const cell = v ? `${v.toLocaleString()}<br><span style="font-size:10px;color:${COLORS.textSub}">${pct.toFixed(1)}%</span>` : '';
      html += `<td class="heat-${heat}">${cell}</td>`;
    }
    html += `<td><strong>${rowTotal.toLocaleString()}</strong><br><span style="font-size:10px;color:${COLORS.textSub};font-weight:400">100%</span></td></tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

// --- Filter UI init ---
function initFilters() {
  const ff = state.data.factFront;
  const fc = state.data.factConsult;
  const fillSelect = (filterName, values) => {
    const sel = document.querySelector(`[data-filter="${filterName}"]`);
    if (!sel) return;
    for (const v of values) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = String(v).length > 40 ? String(v).slice(0, 38) + '…' : v;
      opt.title = v;
      sel.appendChild(opt);
    }
  };
  // 経路は フロント.acquisition_source ∪ 個相.front_source ∪ 個相.consultation_source
  fillSelect('source', uniq([
    ...ff.map(r => r.acquisition_source),
    ...fc.map(r => r.front_source),
    ...fc.map(r => r.consultation_source),
  ]));
  // 年代は両方を合算
  const ageValues = uniq([...ff.map(r => r.age_band), ...fc.map(r => r.age_band)]);
  fillSelect('age', sortAgeBand(ageValues.map(v => [v, 0])).map(e => e[0]));
  // 職業も両方を合算
  fillSelect('occupation', uniq([...ff.map(r => r.occupation), ...fc.map(r => r.occupation)]));

  document.querySelectorAll('.filter-bar select').forEach(sel => {
    sel.addEventListener('change', () => {
      state.filters[sel.dataset.filter] = sel.value;
      if (sel.dataset.filter === 'period') {
        document.getElementById('filter-custom-range').style.display = sel.value === 'custom' ? 'flex' : 'none';
      }
      renderActiveTab();
    });
  });

  document.querySelectorAll('.filter-bar input[type="date"]').forEach(input => {
    input.addEventListener('change', () => {
      state.filters[input.dataset.filter] = input.value;
      renderActiveTab();
    });
  });

  document.getElementById('filter-reset').addEventListener('click', () => {
    state.filters = { period: 'all', date_from: '', date_to: '', source: 'all', age: 'all', occupation: 'all', answered: 'all', exclude_test: 'yes' };
    document.querySelectorAll('.filter-bar select').forEach(sel => {
      sel.value = sel.dataset.filter === 'exclude_test' ? 'yes' : 'all';
    });
    document.querySelectorAll('.filter-bar input[type="date"]').forEach(input => {
      input.value = '';
    });
    document.getElementById('filter-custom-range').style.display = 'none';
    renderActiveTab();
  });
}

function initTabs() {
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      document.getElementById('panel-' + t.dataset.tab).classList.add('active');
      renderActiveTab();
    });
  });
}

function renderActiveTab() {
  const active = document.querySelector('.tab.active');
  if (!active) return;
  if (active.dataset.tab === 'front') renderFront();
  if (active.dataset.tab === 'consult') renderConsult();
  if (active.dataset.tab === 'pivot') renderPivot();
  if (active.dataset.tab === 'list') renderList();
}

// --- Pivot tab ---
const PIVOT_FIELDS_FRONT = [
  { key: 'age_broad', label: '年代（大区分）', sort: sortAgeBroad },
  { key: 'age_band', label: '年代（細区分）', sort: sortAgeBand, filter: isFineAgeBand },
  { key: 'occupation', label: '職業' },
  { key: 'top_concern', label: '悩み' },
  { key: 'top_interest', label: '興味ジャンル' },
  { key: 'acquisition_source', label: '経路' },
  { key: 'has_answered_survey', label: 'アンケート回答' },
  { key: 'status', label: 'ステータス' },
];
const PIVOT_FIELDS_CONSULT = [
  { key: 'age_broad', label: '年代（大区分）', sort: sortAgeBroad },
  { key: 'age_band', label: '年代（細区分）', sort: sortAgeBand, filter: isFineAgeBand },
  { key: 'occupation', label: '職業' },
  { key: 'income_band', label: '年収', sort: sortIncomeBand },
  { key: 'monthly_budget', label: '月投資額', sort: sortBudget },
  { key: 'intent_level', label: '意向度', sort: sortIntent },
  { key: 'result', label: '結果', sort: sortResult },
  { key: 'implemented', label: '実施可否' },
  { key: 'front_source', label: 'フロント経路' },
  { key: 'consultation_source', label: '個相経路' },
  { key: 'consultant', label: '担当者' },
  { key: 'plan_name', label: 'プラン名' },
  { key: 'payment_method', label: '決済手段' },
  { key: 'success_factor', label: '成約要因' },
  { key: 'loss_factor', label: '失注要因' },
];

function initPivot() {
  const sourceSel = document.getElementById('pivot-source');
  const rowSel = document.getElementById('pivot-row');
  const colSel = document.getElementById('pivot-col');
  const valueSel = document.getElementById('pivot-value');

  function rebuildFields() {
    const sourceType = sourceSel.value;
    const fields = sourceType === 'consult' ? PIVOT_FIELDS_CONSULT : PIVOT_FIELDS_FRONT;
    rowSel.innerHTML = '';
    colSel.innerHTML = '';
    for (const f of fields) {
      const r = document.createElement('option');
      r.value = f.key; r.textContent = f.label;
      rowSel.appendChild(r);
      const c = document.createElement('option');
      c.value = f.key; c.textContent = f.label;
      colSel.appendChild(c);
    }
    rowSel.value = fields[0].key;
    colSel.value = fields[1] ? fields[1].key : fields[0].key;
  }

  rebuildFields();

  for (const sel of [sourceSel, rowSel, colSel, valueSel]) {
    sel.addEventListener('change', () => {
      if (sel === sourceSel) rebuildFields();
      renderPivot();
    });
  }
}

function renderPivot() {
  const sourceType = document.getElementById('pivot-source').value;
  const rowKey = document.getElementById('pivot-row').value;
  const colKey = document.getElementById('pivot-col').value;
  const valueType = document.getElementById('pivot-value').value;

  const fields = sourceType === 'consult' ? PIVOT_FIELDS_CONSULT : PIVOT_FIELDS_FRONT;
  const rowField = fields.find(f => f.key === rowKey);
  const colField = fields.find(f => f.key === colKey);
  if (!rowField || !colField) return;

  const items = sourceType === 'consult' ? filterConsult() : filterFront();

  renderPivotTable('pivot-table', items, rowKey, colKey, valueType, {
    rowSort: rowField.sort,
    colSort: colField.sort,
    rowKeyFilter: rowField.filter,
    colKeyFilter: colField.filter,
    rowLimit: 30,
    colLimit: 15,
  });
}

function renderPivotTable(containerId, items, rowKey, colKey, valueType, opts = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // 集計：(row, col) -> [item...] のマップ
  const rowCounts = new Map();
  const colCounts = new Map();
  const cellItems = new Map();
  const SEP = '';
  for (const it of items) {
    let r = it[rowKey]; r = (r == null || r === '') ? '（未設定）' : String(r);
    let c = it[colKey]; c = (c == null || c === '') ? '（未設定）' : String(c);
    rowCounts.set(r, (rowCounts.get(r) || 0) + 1);
    colCounts.set(c, (colCounts.get(c) || 0) + 1);
    const k = r + SEP + c;
    if (!cellItems.has(k)) cellItems.set(k, []);
    cellItems.get(k).push(it);
  }

  let rows = [...rowCounts.entries()];
  if (opts.rowKeyFilter) rows = rows.filter(([k]) => opts.rowKeyFilter(k));
  rows = opts.rowSort ? opts.rowSort(rows) : rows.sort((a, b) => b[1] - a[1]);
  if (opts.rowLimit) rows = rows.slice(0, opts.rowLimit);

  let cols = [...colCounts.entries()];
  if (opts.colKeyFilter) cols = cols.filter(([k]) => opts.colKeyFilter(k));
  cols = opts.colSort ? opts.colSort(cols) : cols.sort((a, b) => b[1] - a[1]);
  if (opts.colLimit) cols = cols.slice(0, opts.colLimit);

  function calcCell(r, c, rowTotal, colTotal) {
    const list = cellItems.get(r + SEP + c) || [];
    const count = list.length;
    if (valueType === 'count') {
      const heat = rowTotal ? count / rowTotal : 0;
      return { display: count ? count.toLocaleString() : '', heat };
    }
    if (valueType === 'row_pct') {
      const pct = rowTotal ? count / rowTotal * 100 : 0;
      return { display: count ? pct.toFixed(1) + '%' : '', heat: pct / 100 };
    }
    if (valueType === 'col_pct') {
      const pct = colTotal ? count / colTotal * 100 : 0;
      return { display: count ? pct.toFixed(1) + '%' : '', heat: pct / 100 };
    }
    if (valueType === 'contract_rate') {
      const contracted = list.filter(it => it.result === '成約').length;
      const rate = count ? contracted / count * 100 : 0;
      return {
        display: count ? `${rate.toFixed(1)}%<br><span style="font-size:10px;color:${COLORS.textSub}">${contracted}/${count}</span>` : '',
        heat: rate / 100,
      };
    }
    if (valueType === 'avg_amount') {
      const amounts = list.map(it => parseAmount(it.contract_amount)).filter(n => n != null);
      const avg = amounts.length ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;
      return {
        display: amounts.length ? `¥${Math.round(avg).toLocaleString()}<br><span style="font-size:10px;color:${COLORS.textSub}">n=${amounts.length}</span>` : '',
        heat: Math.min(1, avg / 500000),
      };
    }
    return { display: '', heat: 0 };
  }

  // テーブル生成
  let html = '<table class="cross"><thead><tr><th></th>';
  for (const [c, total] of cols) {
    html += `<th>${escapeHtml(c)}<br><span style="font-weight:400;color:${COLORS.textSub};font-size:10px">${total.toLocaleString()}</span></th>`;
  }
  html += '<th>計</th></tr></thead><tbody>';
  for (const [r, rowTotal] of rows) {
    html += `<tr><td><strong>${escapeHtml(r)}</strong></td>`;
    for (const [c, colTotal] of cols) {
      const { display, heat } = calcCell(r, c, rowTotal, colTotal);
      const lvl = heat > 0 ? Math.min(5, Math.max(1, Math.ceil(heat * 5))) : 0;
      html += `<td class="heat-${lvl}">${display}</td>`;
    }
    html += `<td><strong>${rowTotal.toLocaleString()}</strong></td></tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

// --- Customer list tab ---
const LIST_COLS_FRONT = [
  { key: 'anon_id', label: '匿名ID', cls: 'id' },
  { key: 'registered_at', label: '登録日時' },
  { key: 'acquisition_source', label: '経路' },
  { key: 'age_band', label: '年代' },
  { key: 'occupation', label: '職業' },
  { key: 'top_concern', label: '悩み' },
  { key: 'top_interest', label: '興味' },
  { key: 'has_answered_survey', label: 'アンケート' },
  { key: 'status', label: 'ステータス' },
];
const LIST_COLS_CONSULT = [
  { key: 'anon_id', label: '匿名ID', cls: 'id' },
  { key: 'applied_at', label: '申込日時' },
  { key: 'front_source', label: 'フロント経路' },
  { key: 'consultation_source', label: '個相経路' },
  { key: 'age_band', label: '年代' },
  { key: 'occupation', label: '職業' },
  { key: 'income_band', label: '年収' },
  { key: 'monthly_budget', label: '月投資' },
  { key: 'intent_level', label: '意向度' },
  { key: 'implemented', label: '実施' },
  { key: 'result', label: '結果' },
  { key: 'contract_at', label: '契約日' },
  { key: 'plan_name', label: 'プラン' },
  { key: 'consultant', label: '担当' },
  { key: 'concern_free', label: '悩み（自由）', wide: true },
  { key: 'desired_future', label: '理想（自由）', wide: true },
  { key: 'question', label: '聞きたい（自由）', wide: true },
  { key: 'success_factor', label: '成約要因', wide: true },
  { key: 'loss_factor', label: '失注要因', wide: true },
];

function initList() {
  for (const id of ['list-source', 'list-limit', 'list-sort']) {
    document.getElementById(id).addEventListener('change', renderList);
  }
}

function renderList() {
  const sourceType = document.getElementById('list-source').value;
  const limitVal = document.getElementById('list-limit').value;
  const sortVal = document.getElementById('list-sort').value;

  let items = sourceType === 'consult' ? filterConsult() : filterFront();
  const dateKey = sourceType === 'consult' ? 'applied_at' : 'registered_at';

  items = items.slice().sort((a, b) => {
    const ta = a[dateKey] || '';
    const tb = b[dateKey] || '';
    return sortVal === 'date_desc' ? tb.localeCompare(ta) : ta.localeCompare(tb);
  });

  const total = items.length;
  const limit = limitVal === 'all' ? items.length : parseInt(limitVal);
  const shown = items.slice(0, limit);

  setText('list-counts', `${shown.length.toLocaleString()} / ${total.toLocaleString()} 件`);

  const cols = sourceType === 'consult' ? LIST_COLS_CONSULT : LIST_COLS_FRONT;

  let html = '<table class="list-table"><thead><tr>';
  for (const c of cols) html += `<th>${escapeHtml(c.label)}</th>`;
  html += '</tr></thead><tbody>';
  for (const it of shown) {
    html += '<tr>';
    for (const c of cols) {
      const v = it[c.key];
      const str = v == null ? '' : (typeof v === 'boolean' ? (v ? '✓' : '') : String(v));
      const classes = [c.wide ? 'wide' : null, c.cls || null].filter(Boolean).join(' ');
      const cls = classes ? ` class="${classes}"` : '';
      html += `<td${cls} title="${escapeHtml(str)}">${escapeHtml(str)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  document.getElementById('list-table-wrap').innerHTML = html;
}

// --- Consult tab helpers ---
function parseAmount(s) {
  if (s == null || s === '') return null;
  const str = String(s);
  if (/[#!]/.test(str)) return null; // #REF! などのエラー値
  const cleaned = str.replace(/[^\d.-]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function isImplemented(r) { return r.implemented === '実施'; }
function isContracted(r) { return r.result === '成約'; }

function getMonth(dateStr) {
  if (!dateStr) return null;
  const t = new Date(String(dateStr).replace(' ', 'T'));
  if (isNaN(t)) return null;
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
}

function filterConsult() { return state.data.factConsult.filter(r => matchFilters(r, true)); }

// --- Render: Consult tab ---
function renderConsult() {
  const all = filterConsult();
  const impl = all.filter(isImplemented);
  const contracted = all.filter(isContracted);
  const amounts = contracted.map(r => parseAmount(r.contract_amount)).filter(n => n != null);
  const totalRevenue = amounts.reduce((a, b) => a + b, 0);
  const arpu = amounts.length ? totalRevenue / amounts.length : 0;

  // KPI
  setText('c-kpi-total', all.length.toLocaleString());
  setText('c-kpi-implemented', impl.length.toLocaleString());
  setText('c-kpi-implemented-sub', all.length ? `実施率 ${(impl.length / all.length * 100).toFixed(1)}%` : '-');
  setText('c-kpi-contract', contracted.length.toLocaleString());
  setText('c-kpi-contract-sub', impl.length ? `実施対比 ${(contracted.length / impl.length * 100).toFixed(1)}%` : '-');
  setText('c-kpi-rate', all.length ? (contracted.length / all.length * 100).toFixed(1) + '%' : '-');
  setText('c-kpi-revenue', totalRevenue ? '¥' + Math.round(totalRevenue).toLocaleString() : '-');
  setText('c-kpi-arpu', amounts.length ? `平均 ¥${Math.round(arpu).toLocaleString()}（n=${amounts.length}）` : '金額未入力');

  // Funnel
  setText('c-funnel-applied', all.length.toLocaleString());
  setText('c-funnel-impl', impl.length.toLocaleString());
  setText('c-funnel-impl-pct', all.length ? `${(impl.length / all.length * 100).toFixed(1)}% (申込比)` : '-');
  setText('c-funnel-contract', contracted.length.toLocaleString());
  setText('c-funnel-contract-pct', impl.length ? `${(contracted.length / impl.length * 100).toFixed(1)}% (実施比)` : '-');

  // 属性分布
  const attrs = [
    { key: 'age_broad', chart: 'c-chart-age-broad', table: 'c-table-age-broad', title: '年代（大区分）', sort: sortAgeBroad },
    { key: 'age_band', chart: 'c-chart-age', table: 'c-table-age', title: '年代（細区分）', sort: sortAgeBand, filter: isFineAgeBand },
    { key: 'occupation', chart: 'c-chart-occupation', table: 'c-table-occupation', title: '職業', sort: null },
    { key: 'income_band', chart: 'c-chart-income', table: 'c-table-income', title: '年収', sort: sortIncomeBand },
    { key: 'monthly_budget', chart: 'c-chart-budget', table: 'c-table-budget', title: '月投資額', sort: sortBudget },
    { key: 'intent_level', chart: 'c-chart-intent', table: 'c-table-intent', title: '意向度', sort: sortIntent },
    { key: 'result', chart: 'c-chart-result', table: 'c-table-result', title: '結果', sort: sortResult },
  ];
  for (const a of attrs) {
    let data = groupBy(all, a.key);
    if (a.filter) data = data.filter(([k]) => a.filter(k));
    if (a.sort) data = a.sort(data);
    const localTotal = a.filter ? data.reduce((s, [, v]) => s + v, 0) : all.length;
    renderHBar(a.chart, data, a.title);
    renderDataTable(a.table, data, localTotal);
  }

  // 経路
  const frontSrc = groupBy(all, 'front_source').slice(0, 15);
  renderHBar('c-chart-front-source', frontSrc, 'フロント経路 Top 15');
  renderDataTable('c-table-front-source', frontSrc, all.length);

  const consultSrc = groupBy(all, 'consultation_source').slice(0, 15);
  renderHBar('c-chart-consult-source', consultSrc, '個相登録経路 Top 15');
  renderDataTable('c-table-consult-source', consultSrc, all.length);

  // クロス
  renderCross('c-cross-age-broad-result', all, 'age_broad', 'result', { rowLimit: 10, colLimit: 8 });
  renderCross('c-cross-age-result', all, 'age_band', 'result', { rowSort: 'age', rowKeyFilter: isFineAgeBand, colLimit: 8 });
  renderCross('c-cross-age-broad-occupation', all, 'age_broad', 'occupation', { rowLimit: 10, colLimit: 10 });
  renderCross('c-cross-age-occupation', all, 'age_band', 'occupation', { rowSort: 'age', rowKeyFilter: isFineAgeBand, colLimit: 10 });
  renderCross('c-cross-front-result', all, 'front_source', 'result', { rowLimit: 15, colLimit: 8 });

  // 月次推移
  renderMonthlyConsult('c-chart-monthly', all);
}

function renderMonthlyConsult(canvasId, items) {
  const monthMap = new Map();
  for (const r of items) {
    const m = getMonth(r.applied_at);
    if (!m) continue;
    if (!monthMap.has(m)) monthMap.set(m, { applied: 0, implemented: 0, contracted: 0 });
    const v = monthMap.get(m);
    v.applied++;
    if (isImplemented(r)) v.implemented++;
    if (isContracted(r)) v.contracted++;
  }
  const months = [...monthMap.keys()].sort();
  const applied = months.map(m => monthMap.get(m).applied);
  const implemented = months.map(m => monthMap.get(m).implemented);
  const contracted = months.map(m => monthMap.get(m).contracted);

  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (state.charts[canvasId]) state.charts[canvasId].destroy();
  if (months.length === 0) return;

  state.charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        { label: '申込', data: applied, backgroundColor: COLORS.info, borderColor: COLORS.info },
        { label: '実施', data: implemented, backgroundColor: COLORS.warn, borderColor: COLORS.warn },
        { label: '成約', data: contracted, backgroundColor: COLORS.accent, borderColor: COLORS.accent },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: COLORS.text, font: { size: 11 } } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { ticks: { color: COLORS.textSub }, grid: { color: COLORS.border } },
        y: { ticks: { color: COLORS.textSub }, grid: { color: COLORS.border }, beginAtZero: true },
      },
    },
  });
}

// --- Auth + Bootstrap ---
async function decryptJSON(enc, password) {
  const b64ToBytes = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const salt = b64ToBytes(enc.salt);
  const iv = b64ToBytes(enc.iv);
  const ct = b64ToBytes(enc.ct);
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: enc.iter || 100000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  );
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function loadData(password) {
  const [ff, fc, meta] = await Promise.all([
    fetch('./data/fact_front.json?t=' + Date.now()).then(r => r.json()),
    fetch('./data/fact_consult.json?t=' + Date.now()).then(r => r.json()),
    fetch('./data/meta.json?t=' + Date.now()).then(r => r.json()),
  ]);
  // 暗号化されているか判定
  if (ff.v && ff.alg === 'AES-GCM') {
    if (!password) throw new Error('Password required');
    return {
      factFront: await decryptJSON(ff, password),
      factConsult: await decryptJSON(fc, password),
      meta: await decryptJSON(meta, password),
    };
  }
  return { factFront: ff, factConsult: fc, meta };
}

function initApp({ factFront, factConsult, meta }) {
  factFront.forEach(r => { r.age_broad = getAgeBroad(r.age_band); });
  factConsult.forEach(r => { r.age_broad = getAgeBroad(r.age_band); });
  state.data = { factFront, factConsult, meta };

  setText('meta-updated', '最終更新: ' + new Date(meta.generated_at).toLocaleString('ja-JP'));
  setText('meta-counts', `フロント ${meta.fact_front.total.toLocaleString()}人 / 個別相談 ${meta.fact_consult.total.toLocaleString()}人`);

  initTabs();
  initFilters();
  initPivot();
  initList();
  renderFront();

  document.getElementById('loading').classList.add('hidden');
  document.getElementById('auth-overlay').style.display = 'none';
}

function showAuthOverlay() {
  document.getElementById('loading').classList.add('hidden');
  const overlay = document.getElementById('auth-overlay');
  overlay.style.display = 'flex';

  const pwInput = document.getElementById('auth-password');
  const btn = document.getElementById('auth-submit');
  const errEl = document.getElementById('auth-error');

  const submit = async () => {
    const password = pwInput.value;
    if (!password) return;
    errEl.textContent = '';
    btn.textContent = '復号中…';
    btn.disabled = true;
    try {
      const data = await loadData(password);
      localStorage.setItem('mensrise_report_password', password);
      initApp(data);
    } catch (e) {
      errEl.textContent = 'パスワードが違います';
      btn.textContent = '開く';
      btn.disabled = false;
      pwInput.select();
    }
  };
  btn.addEventListener('click', submit);
  pwInput.addEventListener('keypress', e => { if (e.key === 'Enter') submit(); });
  setTimeout(() => pwInput.focus(), 50);
}

(async () => {
  try {
    // まず平文として読めるか試す
    const ffPeek = await fetch('./data/fact_front.json?t=' + Date.now()).then(r => r.json());
    if (!(ffPeek.v && ffPeek.alg === 'AES-GCM')) {
      // 平文
      const data = await loadData(null);
      initApp(data);
      return;
    }

    // 暗号化されている → localStorage パスワードで試す
    const saved = localStorage.getItem('mensrise_report_password');
    if (saved) {
      try {
        const data = await loadData(saved);
        initApp(data);
        return;
      } catch (e) {
        localStorage.removeItem('mensrise_report_password');
      }
    }

    showAuthOverlay();
  } catch (e) {
    document.getElementById('loading').innerHTML = `<div style="color:var(--danger);text-align:center;"><div>エラー</div><div style="font-size:11px;margin-top:8px">${e.message}</div></div>`;
    console.error(e);
  }
})();
