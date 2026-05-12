'use strict';

/* ===================================================================
 * Basketball Scoreboard & Stats — renderer
 * Local-only (no database). State is mirrored to localStorage so an
 * accidental window close does not lose an in-progress game.
 * =================================================================== */

const RULES = {
  quarterSeconds: 12 * 60,
  overtimeSeconds: 5 * 60,
  timeoutSeconds: 60,
  halftimeBreak: 5 * 60,
  shortBreak: 2 * 60,
  preOtBreak: 60,
  maxOvertimes: 2,
  maxRoster: 15,
  bonusFouls: 4,
  foulOut: 5
};
const STORE_KEY = 'biba-scoreboard-v2';
const EDIT_FIELDS = ['points', 'assists', 'rebounds', 'steals', 'blocks', 'fouls'];
const STAT_LABELS = { points: '得分', assists: '助攻', rebounds: '篮板', steals: '抢断', blocks: '盖帽', fouls: '犯规' };

const state = {
  setup: { homeName: '', awayName: '', home: [], away: [] }, // rosters: [{number:Number, name:String}]
  game: null,
  undoStack: [],
  console: { team: 'home', number: '' }
};
let activeEdit = null;

/* ---------------- DOM ---------------- */
const $ = (id) => document.getElementById(id);
const el = {
  bannerContainer: $('banner-container'),
  setupScreen: $('setup-screen'),
  gameScreen: $('game-screen'),
  // setup
  homeName: $('home-name'),
  awayName: $('away-name'),
  homeRoster: $('home-roster'),
  awayRoster: $('away-roster'),
  homeCount: $('home-count'),
  awayCount: $('away-count'),
  startGame: $('start-game'),
  clearSaved: $('clear-saved'),
  resumeGame: $('resume-game'),
  // scoreboard
  sbHomeName: $('sb-home-name'), sbHomeScore: $('sb-home-score'),
  sbHomeFouls: $('sb-home-fouls'), sbHomeTO: $('sb-home-to'), sbHomeBonus: $('sb-home-bonus'),
  sbAwayName: $('sb-away-name'), sbAwayScore: $('sb-away-score'),
  sbAwayFouls: $('sb-away-fouls'), sbAwayTO: $('sb-away-to'), sbAwayBonus: $('sb-away-bonus'),
  periodLabel: $('period-label'), clockLabel: $('clock-label'), stateLabel: $('state-label'), sbExtra: $('sb-extra'),
  // console
  ctHome: $('ct-home'), ctAway: $('ct-away'),
  consoleNumber: $('console-number'), consoleFeedback: $('console-feedback'),
  // controls
  startResume: $('start-resume'), pauseGame: $('pause-game'), undoAction: $('undo-action'),
  endGame: $('end-game'), copyExport: $('copy-export'), backToSetup: $('back-to-setup'),
  // stats / overlays
  statsGrid: $('stats-grid'),
  transitionCard: $('transition-card'), transitionTitle: $('transition-title'), transitionText: $('transition-text'), confirmTransition: $('confirm-transition'),
  editModal: $('edit-modal'), editTitle: $('edit-title'), saveEdit: $('save-edit'), cancelEdit: $('cancel-edit')
};

/* ---------------- helpers ---------------- */
function disp(name) {
  // show only the first 3 code points; the full name stays stored
  const arr = Array.from(String(name == null ? '' : name));
  return arr.slice(0, 3).join('') || '?';
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function isValidNumber(n) { return Number.isInteger(n) && n >= 0 && n <= 99; }
function getRoster(side) { return side === 'home' ? state.setup.home : state.setup.away; }
function sideLabel(side) { return side === 'home' ? '主队' : '客队'; }

/* short beep to catch the referee's attention; no-ops if audio is unavailable */
let audioCtx = null;
function beep(times = 2) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    let t = audioCtx.currentTime;
    for (let i = 0; i < Math.max(1, times); i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
      t += 0.26;
    }
  } catch { /* ignore */ }
}

/* ---------------- banner notifications ---------------- */
function notify(message, type = 'info', ms = 7000) {
  const row = document.createElement('div');
  row.className = `banner ${type}`;
  const text = document.createElement('span');
  text.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '✕';
  close.addEventListener('click', () => row.remove());
  row.append(text, close);
  el.bannerContainer.prepend(row);
  while (el.bannerContainer.children.length > 4) el.bannerContainer.lastElementChild.remove();
  if (ms > 0) setTimeout(() => { if (row.isConnected) row.remove(); }, ms);
}

/* ---------------- persistence ---------------- */
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ setup: state.setup, game: state.game })); }
    catch { /* storage full or disabled — ignore */ }
  }, 200);
}
function clearPersisted() { try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ } }
function loadPersisted() {
  let raw;
  try { raw = localStorage.getItem(STORE_KEY); } catch { return; }
  if (!raw) return;
  let data;
  try { data = JSON.parse(raw); } catch { return; }
  if (data && data.setup) {
    const s = data.setup;
    state.setup.homeName = typeof s.homeName === 'string' ? s.homeName : '';
    state.setup.awayName = typeof s.awayName === 'string' ? s.awayName : '';
    const norm = (arr) => Array.isArray(arr)
      ? arr.filter((p) => p && typeof p === 'object' && typeof p.name === 'string')
           .map((p) => ({ number: Number(p.number), name: p.name }))
      : [];
    state.setup.home = norm(s.home);
    state.setup.away = norm(s.away);
  }
  if (data && data.game && data.game.home && data.game.away &&
      Array.isArray(data.game.home.players) && Array.isArray(data.game.away.players)) {
    state.game = data.game;
  }
}

/* ====================================================== */
/* SETUP SCREEN                                            */
/* ====================================================== */
function hasDuplicateNumbers(side) {
  const seen = new Set();
  for (const p of getRoster(side)) {
    if (!Number.isFinite(p.number)) continue;
    if (seen.has(p.number)) return true;
    seen.add(p.number);
  }
  return false;
}
function duplicateSet(side) {
  const seen = new Set(), dup = new Set();
  for (const p of getRoster(side)) {
    if (!Number.isFinite(p.number)) continue;
    if (seen.has(p.number)) dup.add(p.number); else seen.add(p.number);
  }
  return dup;
}

function renderRosterTable(side) {
  const tbody = side === 'home' ? el.homeRoster : el.awayRoster;
  const roster = getRoster(side);
  const dup = duplicateSet(side);
  tbody.innerHTML = '';
  if (!roster.length) {
    const tr = document.createElement('tr');
    tr.className = 'roster-empty';
    tr.innerHTML = '<td colspan="3">还没有球员 — 用上方添加，或下方批量粘贴名单</td>';
    tbody.appendChild(tr);
  } else {
    roster.forEach((p, idx) => {
      const tr = document.createElement('tr');
      const numCls = 'row-num' + (Number.isFinite(p.number) && dup.has(p.number) ? ' dup' : '');
      const numVal = Number.isFinite(p.number) ? p.number : '';
      tr.innerHTML =
        `<td class="col-num"><input class="${numCls}" data-row-number="${side}:${idx}" type="number" min="0" max="99" inputmode="numeric" value="${esc(numVal)}" /></td>` +
        `<td><input data-row-name="${side}:${idx}" type="text" maxlength="20" value="${esc(p.name)}" placeholder="球员姓名" /></td>` +
        `<td class="col-act"><button class="row-remove" type="button" data-row-remove="${side}:${idx}" title="删除">✕</button></td>`;
      tbody.appendChild(tr);
    });
  }
  updateRosterCount(side);
}

function refreshRowNumberClasses(side) {
  const dup = duplicateSet(side);
  const tbody = side === 'home' ? el.homeRoster : el.awayRoster;
  tbody.querySelectorAll('[data-row-number]').forEach((inp) => {
    const v = inp.value === '' ? NaN : Number(inp.value);
    inp.classList.toggle('dup', Number.isFinite(v) && dup.has(v));
  });
}

function updateRosterCount(side) {
  const roster = getRoster(side);
  const node = side === 'home' ? el.homeCount : el.awayCount;
  const n = roster.length;
  const blanks = roster.filter((p) => !p.name || !String(p.name).trim() || !isValidNumber(p.number)).length;
  const dup = hasDuplicateNumbers(side);
  let msg = `${n} 名球员 · 需要 1–${RULES.maxRoster} 名`;
  let bad = false;
  if (n < 1 || n > RULES.maxRoster) bad = true;
  if (dup) { msg += ' · 号码重复'; bad = true; }
  if (blanks) { msg += ` · ${blanks} 行号码/姓名无效`; bad = true; }
  node.textContent = msg;
  node.classList.toggle('bad', bad);
}

function addPlayerRow(side) {
  const numInput = document.querySelector(`[data-add-number="${side}"]`);
  const nameInput = document.querySelector(`[data-add-name="${side}"]`);
  const name = nameInput.value.trim();
  const num = Number(numInput.value);
  const roster = getRoster(side);
  if (numInput.value === '' || !isValidNumber(num)) { notify('球衣号码必须是 0–99 的整数。', 'warn'); numInput.focus(); return; }
  if (!name) { notify('请填写球员姓名。', 'warn'); nameInput.focus(); return; }
  if (roster.length >= RULES.maxRoster) { notify(`每队最多 ${RULES.maxRoster} 名球员。`, 'warn'); return; }
  if (roster.some((p) => p.number === num)) { notify(`本队已经有 #${num} 号了。`, 'warn'); numInput.focus(); return; }
  roster.push({ number: num, name });
  numInput.value = '';
  nameInput.value = '';
  renderRosterTable(side);
  persist();
  numInput.focus();
}

function parseBatch(text) {
  const ok = [], errors = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    const m = t.match(/^(\d{1,2})(?!\d)[\s,;:.\-]*(.*\S)\s*$/);
    if (!m) { errors.push(`第 ${i + 1} 行：无法识别（需要『号码 姓名』，例如 23 张伟）`); return; }
    const num = Number(m[1]);
    const name = m[2].trim();
    if (!isValidNumber(num)) { errors.push(`第 ${i + 1} 行：号码「${m[1]}」不是 0–99 的整数`); return; }
    if (!name) { errors.push(`第 ${i + 1} 行：缺少姓名`); return; }
    ok.push({ number: num, name });
  });
  return { ok, errors };
}

function importBatch(side, replace) {
  const ta = document.querySelector(`[data-batch-text="${side}"]`);
  const { ok, errors } = parseBatch(ta.value);
  if (!ok.length && !errors.length) { notify('批量导入框是空的。', 'warn'); return; }
  const roster = getRoster(side);
  if (replace) roster.length = 0;
  let added = 0, dup = 0, overflow = 0;
  for (const p of ok) {
    if (roster.length >= RULES.maxRoster) { overflow++; continue; }
    if (roster.some((q) => q.number === p.number)) { dup++; continue; }
    roster.push({ number: p.number, name: p.name });
    added++;
  }
  renderRosterTable(side);
  persist();
  const parts = [`导入 ${added} 名球员`];
  if (dup) parts.push(`${dup} 个号码重复已跳过`);
  if (overflow) parts.push(`超出 ${RULES.maxRoster} 人上限的 ${overflow} 行已跳过`);
  if (errors.length) parts.push(`${errors.length} 行格式错误`);
  notify(parts.join('，') + '。', (dup || overflow || errors.length) ? 'warn' : 'info');
  errors.slice(0, 5).forEach((e) => notify(e, 'warn', 9000));
  if (added && !errors.length) ta.value = '';
}

function hydrateSetupForm() {
  el.homeName.value = state.setup.homeName || '';
  el.awayName.value = state.setup.awayName || '';
  renderRosterTable('home');
  renderRosterTable('away');
}

/* event wiring — setup */
['home', 'away'].forEach((side) => {
  const tbody = side === 'home' ? el.homeRoster : el.awayRoster;
  tbody.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.rowNumber) {
      const idx = Number(t.dataset.rowNumber.split(':')[1]);
      const roster = getRoster(side);
      if (!roster[idx]) return;
      roster[idx].number = t.value === '' ? NaN : Number(t.value);
      refreshRowNumberClasses(side);
      updateRosterCount(side);
      persist();
    } else if (t.dataset.rowName) {
      const idx = Number(t.dataset.rowName.split(':')[1]);
      const roster = getRoster(side);
      if (!roster[idx]) return;
      roster[idx].name = t.value;
      updateRosterCount(side);
      persist();
    }
  });
  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-row-remove]');
    if (!btn) return;
    const idx = Number(btn.dataset.rowRemove.split(':')[1]);
    getRoster(side).splice(idx, 1);
    renderRosterTable(side);
    persist();
  });
});
document.querySelectorAll('[data-add-player]').forEach((b) => b.addEventListener('click', () => addPlayerRow(b.dataset.addPlayer)));
document.querySelectorAll('[data-batch-append]').forEach((b) => b.addEventListener('click', () => importBatch(b.dataset.batchAppend, false)));
document.querySelectorAll('[data-batch-replace]').forEach((b) => b.addEventListener('click', () => importBatch(b.dataset.batchReplace, true)));
document.querySelectorAll('[data-add-name]').forEach((inp) => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addPlayerRow(inp.dataset.addName); } }));
document.querySelectorAll('[data-add-number]').forEach((inp) => inp.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); const n = document.querySelector(`[data-add-name="${inp.dataset.addNumber}"]`); if (n) n.focus(); }
}));
el.homeName.addEventListener('input', () => { state.setup.homeName = el.homeName.value; persist(); });
el.awayName.addEventListener('input', () => { state.setup.awayName = el.awayName.value; persist(); });
el.clearSaved.addEventListener('click', () => {
  if (!confirm('确定清除本地保存的名单和未结束的比赛？此操作不可撤销。')) return;
  clearPersisted();
  state.setup = { homeName: '', awayName: '', home: [], away: [] };
  state.game = null;
  hydrateSetupForm();
  updateResumeButton();
  showSetup();
  notify('已清除本地数据。', 'info');
});
el.resumeGame.addEventListener('click', () => { if (state.game) { showGame(); renderGame(); } });

/* ====================================================== */
/* GAME — model                                            */
/* ====================================================== */
function buildTeam(name, roster) {
  return {
    name, score: 0, timeouts: 1, fouls: 0,
    players: roster.map((p) => ({ number: p.number, name: p.name, points: 0, assists: 0, rebounds: 0, steals: 0, blocks: 0, fouls: 0 }))
  };
}
function buildGame(homeName, awayName, homeRoster, awayRoster) {
  return {
    periodType: 'Q', periodIndex: 1,
    secondsLeft: RULES.quarterSeconds,
    running: false, status: 'paused',
    timeout: null, break: null, pendingTransition: null, finished: false,
    home: buildTeam(homeName, homeRoster),
    away: buildTeam(awayName, awayRoster)
  };
}
function periodName(g = state.game) {
  if (!g) return '';
  if (g.periodType === 'Q') return `Q${g.periodIndex}`;
  if (g.periodType === 'OT') return `OT${g.periodIndex}`;
  return '加时绝杀';
}
function isStopClockPeriod(g = state.game) {
  return g.periodType === 'OT' || g.periodType === 'GP' || (g.periodType === 'Q' && g.periodIndex === 4);
}
function setTeamTimeoutsForContext(g) {
  if (g.periodType === 'Q' && g.periodIndex === 3) { g.home.timeouts = 2; g.away.timeouts = 2; notify('下半场暂停次数重置为每队 2 次。', 'info'); }
  if (g.periodType === 'OT') { g.home.timeouts = 1; g.away.timeouts = 1; notify('加时赛暂停次数为每队 1 次。', 'info'); }
}
function findPlayer(side, number) {
  const g = state.game;
  return (g && g[side]) ? g[side].players.find((p) => p.number === number) : null;
}
function pushUndo() {
  try {
    state.undoStack.push(JSON.parse(JSON.stringify(state.game)));
    if (state.undoStack.length > 100) state.undoStack.shift();
  } catch { /* ignore */ }
}

/* ====================================================== */
/* GAME — clock / breaks / timeout                         */
/* Each step returns: 0 = nothing changed, 1 = a plain tick */
/* (clock/break/timeout countdown), 2 = a structural change */
/* (period expired / break ended / timeout ended).          */
/* ====================================================== */
function stepClock(g) {
  if (g.finished || !g.running || g.timeout || g.pendingTransition || g.break != null || g.periodType === 'GP') return 0;
  g.secondsLeft -= 1;
  if (g.secondsLeft <= 0) { g.secondsLeft = 0; g.running = false; onPeriodExpired(); return 2; }
  return 1;
}
function stepBreak(g) {
  if (g.break == null || !g.running) return 0;
  g.break -= 1;
  if (g.break <= 0) { g.break = null; advancePeriodAfterBreak(g); return 2; }
  return 1;
}
function stepTimeout(g) {
  if (!g.timeout) return 0;
  g.timeout.left -= 1;
  if (g.timeout.left <= 0) {
    g.timeout = null;
    g.status = 'paused';
    notify('暂停时间到。', 'warn', 14000);
    beep(3);
    return 2;
  }
  return 1;
}
function onPeriodExpired() {
  const g = state.game;
  notify(`${periodName(g)} 时间到。`, 'warn', 14000);
  beep(3);
  if (g.periodType === 'Q' && g.periodIndex < 4) {
    const halftime = g.periodIndex === 2;
    g.pendingTransition = {
      title: `${periodName(g)} 结束`,
      text: halftime ? '确认进入中场休息（5:00），结束后开始第三节。' : '确认进入节间休息（2:00），结束后开始下一节。',
      breakSeconds: halftime ? RULES.halftimeBreak : RULES.shortBreak
    };
  } else if (g.periodType === 'Q' && g.periodIndex === 4) {
    if (g.home.score === g.away.score) {
      g.pendingTransition = { title: 'Q4 结束 — 平局', text: '确认进入加时赛（先 1:00 准备时间）。', breakSeconds: RULES.preOtBreak };
    } else {
      finishGame('常规时间结束。');
    }
  } else if (g.periodType === 'OT') {
    if (g.home.score === g.away.score && g.periodIndex < RULES.maxOvertimes) {
      g.pendingTransition = { title: `OT${g.periodIndex} 结束 — 仍平局`, text: '确认进入下一个加时赛（先 1:00 准备时间）。', breakSeconds: RULES.preOtBreak };
    } else if (g.home.score === g.away.score) {
      g.periodType = 'GP';
      g.status = 'golden-point';
      notify('进入「加时绝杀」：下一个进球获胜。', 'warn', 14000);
      beep(3);
    } else {
      finishGame('加时赛结束。');
    }
  }
}
function advancePeriodAfterBreak(g) {
  if (g.periodType === 'Q' && g.periodIndex < 4) {
    g.periodIndex += 1;
    g.secondsLeft = RULES.quarterSeconds;
    if (g.periodIndex !== 4) { g.home.fouls = 0; g.away.fouls = 0; }
  } else if (g.periodType === 'Q' && g.periodIndex === 4) {
    g.periodType = 'OT'; g.periodIndex = 1; g.secondsLeft = RULES.overtimeSeconds;
  } else if (g.periodType === 'OT') {
    g.periodIndex += 1; g.secondsLeft = RULES.overtimeSeconds;
  }
  g.status = 'paused';
  g.running = false;
  setTeamTimeoutsForContext(g);
  notify(`休息结束 — ${periodName(g)} 准备开始，点「开始 / 继续」。`, 'info');
  beep(2);
}
setInterval(() => {
  const g = state.game;
  if (!g) return;
  const level = Math.max(stepClock(g), stepBreak(g), stepTimeout(g));
  if (level === 2) { renderGame(); persist(); }       // structural change → full render
  else if (level === 1) { renderClock(); persist(); } // plain countdown → cheap render only
}, 1000);

/* ====================================================== */
/* GAME — scoring console                                  */
/* ====================================================== */
function consoleSay(msg, cls) {
  el.consoleFeedback.textContent = msg;
  el.consoleFeedback.className = 'console-feedback' + (cls ? ' ' + cls : '');
}
function setConsoleTeam(team) {
  state.console.team = team;
  el.ctHome.classList.toggle('active', team === 'home');
  el.ctAway.classList.toggle('active', team === 'away');
  refreshRowSelection();
}
function refreshRowSelection() {
  const team = state.console.team;
  const num = state.console.number === '' ? null : Number(state.console.number);
  document.querySelectorAll('#stats-grid tr.row').forEach((tr) => {
    const parts = (tr.dataset.row || '').split(':');
    tr.classList.toggle('selected', parts[0] === team && num !== null && Number(parts[1]) === num);
  });
}
function consoleApply(kind) {
  const g = state.game;
  if (!g) return;
  if (g.finished) { consoleSay('比赛已结束。', 'err'); return; }
  const numStr = el.consoleNumber.value;
  if (numStr === '') { consoleSay('请先输入球衣号码（也可点下方表格里的球员）。', 'err'); el.consoleNumber.focus(); return; }
  const num = Number(numStr);
  if (!isValidNumber(num)) { consoleSay('球衣号码无效（0–99 的整数）。', 'err'); return; }
  state.console.number = numStr;
  const team = state.console.team;
  const teamObj = g[team];
  const player = teamObj.players.find((p) => p.number === num);
  if (!player) { consoleSay(`${teamObj.name} 没有 #${num} 号球员。`, 'err'); return; }

  pushUndo();
  let detail = '';
  if (kind === 's1' || kind === 's2' || kind === 's3') {
    const pts = Number(kind[1]);
    player.points += pts;
    teamObj.score += pts;
    detail = `+${pts} 分`;
    if (g.periodType === 'GP' && g.home.score !== g.away.score) finishGame('「加时绝杀」决出胜负。');
  } else {
    const field = kind; // assists | rebounds | steals | blocks | fouls
    player[field] = (player[field] || 0) + 1;
    detail = `${STAT_LABELS[field] || field} +1`;
    if (field === 'fouls') {
      teamObj.fouls += 1;
      if (teamObj.fouls === RULES.bonusFouls) { notify(`${teamObj.name} 进入全队犯规罚球（BONUS）。`, 'warn', 14000); beep(2); }
      if (player.fouls === RULES.foulOut - 1) notify(`#${player.number} ${disp(player.name)} 已 ${player.fouls} 次犯规，再犯一次将被罚下。`, 'warn', 12000);
      if (player.fouls === RULES.foulOut) { notify(`#${player.number} ${disp(player.name)} 已满 ${RULES.foulOut} 次犯规，罚下场！`, 'error', 16000); beep(4); }
      if (player.fouls > RULES.foulOut) notify(`#${player.number} ${disp(player.name)} 已被罚下（${player.fouls} 次犯规）。`, 'error', 8000);
    }
  }
  renderGame();
  persist();
  consoleSay(`✓ ${teamObj.name} #${num} ${disp(player.name)} — ${detail}　|　${g.home.name} ${g.home.score} : ${g.away.score} ${g.away.name}`, 'ok');
}

/* ====================================================== */
/* GAME — render                                           */
/* ====================================================== */
function stateText(g) {
  if (g.finished) return '比赛结束';
  if (g.break != null) return '休息中';
  if (g.timeout) return '暂停中';
  if (g.pendingTransition) return '待确认';
  if (g.running) return isStopClockPeriod(g) ? '进行中 · 停表' : '进行中';
  return '已暂停';
}

/* ---- flip-board score (split-flap style per-digit animation) ---- */
const REDUCE_MOTION = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const flipTimers = new WeakMap();   // .flip-digit -> timeout id
const scoredTimers = new WeakMap(); // .sb-team -> timeout id
const FLIP_MS = 320;
function makeFlipCell(d) {
  const cell = document.createElement('span');
  cell.className = 'flip-digit';
  const back = document.createElement('b'); back.className = 'fd-back'; back.textContent = d;
  const front = document.createElement('b'); front.className = 'fd-front'; front.textContent = d;
  cell.append(back, front);
  return cell;
}
function flipDigitCell(cell, d) {
  const front = cell.querySelector('.fd-front');
  const back = cell.querySelector('.fd-back');
  if (!front || !back) { cell.textContent = d; return false; }
  const flipping = cell.classList.contains('flipping');
  const showing = flipping ? back.textContent : front.textContent;
  if (showing === d) {
    // already on this value; if a flip was still mid-air toward it, settle cleanly
    if (flipping) {
      const t = flipTimers.get(cell); if (t) { clearTimeout(t); flipTimers.delete(cell); }
      front.textContent = d; back.textContent = d; cell.classList.remove('flipping');
    }
    return false;
  }
  const prev = flipTimers.get(cell); if (prev) { clearTimeout(prev); flipTimers.delete(cell); }
  if (REDUCE_MOTION) { front.textContent = d; back.textContent = d; cell.classList.remove('flipping'); return true; }
  back.textContent = d;                       // the layer that gets revealed as the front flips away
  cell.classList.remove('flipping'); void cell.offsetWidth; cell.classList.add('flipping');
  flipTimers.set(cell, setTimeout(() => {
    front.textContent = d; cell.classList.remove('flipping'); flipTimers.delete(cell);
  }, FLIP_MS + 30));
  return true;
}
function pulseTeamCard(flipNumEl) {
  const card = flipNumEl && flipNumEl.closest ? flipNumEl.closest('.sb-team') : null;
  if (!card || REDUCE_MOTION) return;
  card.classList.add('scored');
  const prev = scoredTimers.get(card); if (prev) clearTimeout(prev);
  scoredTimers.set(card, setTimeout(() => { card.classList.remove('scored'); scoredTimers.delete(card); }, 750));
}
function rebuildFlipCells(container, target) {
  container.querySelectorAll('.flip-digit').forEach((c) => { const t = flipTimers.get(c); if (t) { clearTimeout(t); flipTimers.delete(c); } });
  container.innerHTML = '';
  for (const d of target) container.appendChild(makeFlipCell(d));
}
function setFlipScore(container, value) {
  try {
    const target = String(value);
    let cells = Array.from(container.querySelectorAll('.flip-digit'));
    if (cells.length !== target.length) {
      if (target.length === cells.length + 1 && cells.length > 0) {
        // grew by exactly one digit (e.g. 8 -> 11): prepend a fresh cell so the change still flips
        const c = makeFlipCell('0');
        container.insertBefore(c, container.firstChild);
        cells = [c, ...cells];
      } else {
        // first paint / restore / large jump / shrink: just show it, no flip
        rebuildFlipCells(container, target);
        return;
      }
    }
    let changed = false;
    target.split('').forEach((d, i) => { if (flipDigitCell(cells[i], d)) changed = true; });
    if (changed) pulseTeamCard(container);
  } catch {
    container.textContent = String(value); // never let the animation break the score display
  }
}
function statsTeamHTML(side, team) {
  const sorted = team.players.slice().sort((a, b) => a.number - b.number);
  let totalPts = 0;
  for (const p of team.players) totalPts += p.points;
  const consoleNum = state.console.number === '' ? null : Number(state.console.number);
  const rows = sorted.map((p) => {
    const out = p.fouls >= RULES.foulOut;
    const warn = p.fouls === RULES.foulOut - 1;
    const selected = state.console.team === side && consoleNum !== null && consoleNum === p.number;
    const foulCls = 'c-foul' + (out ? ' out' : warn ? ' warn' : '');
    return `<tr class="row${out ? ' fouled-out' : ''}${selected ? ' selected' : ''}" data-row="${side}:${p.number}">` +
      `<td class="c-num">${p.number}</td>` +
      `<td class="c-name" title="${esc(p.name)}">${esc(disp(p.name))}</td>` +
      `<td>${p.points}</td><td>${p.assists}</td><td>${p.rebounds}</td><td>${p.steals}</td><td>${p.blocks}</td>` +
      `<td class="${foulCls}">${p.fouls}</td>` +
      `<td class="c-act"><button class="row-edit" type="button" data-edit="${side}:${p.number}" title="手动修正">✎</button></td>` +
    `</tr>`;
  }).join('');
  const body = sorted.length ? rows : '<tr class="stats-empty"><td colspan="9">（无球员）</td></tr>';
  return `<div class="stats-team">
    <div class="st-head"><h3>${esc(team.name)}</h3><span class="st-sub">总得分 ${totalPts} · 全队犯规 ${team.fouls}${team.fouls >= RULES.bonusFouls ? ' · BONUS' : ''}</span></div>
    <div class="stats-scroll"><table>
      <thead><tr><th class="c-num">#</th><th class="c-name">姓名</th><th>得分</th><th>助攻</th><th>篮板</th><th>抢断</th><th>盖帽</th><th>犯规</th><th class="c-act"></th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </div>`;
}
// Cheap render: only the clock / period / state / countdown / control-enabled bits.
// Called on every plain clock tick so the read-only stats tables are NOT rebuilt
// (which would reset their scroll position and could swallow a click in progress).
function renderClock() {
  const g = state.game;
  if (!g) return;
  el.periodLabel.textContent = periodName(g);
  if (g.periodType === 'GP') {
    el.clockLabel.textContent = 'SUDDEN DEATH';
    el.clockLabel.classList.add('gp');
  } else {
    el.clockLabel.textContent = fmt(g.break != null ? g.break : g.secondsLeft);
    el.clockLabel.classList.remove('gp');
  }
  el.stateLabel.textContent = stateText(g);
  if (g.timeout) {
    el.sbExtra.textContent = `${(g.timeout.team === 'home' ? g.home.name : g.away.name)} 暂停 ${fmt(g.timeout.left)}`;
    el.sbExtra.classList.remove('hidden');
  } else if (g.break != null) {
    el.sbExtra.textContent = `休息倒计时 ${fmt(g.break)}`;
    el.sbExtra.classList.remove('hidden');
  } else {
    el.sbExtra.textContent = '';
    el.sbExtra.classList.add('hidden');
  }
  document.querySelectorAll('[data-timeout]').forEach((b) => b.classList.toggle('active-timeout', !!(g.timeout && g.timeout.team === b.dataset.timeout)));
  const fin = !!g.finished;
  el.startResume.disabled = fin || !!g.pendingTransition || g.break != null || !!g.timeout;
  el.pauseGame.disabled = fin || !g.running || g.break != null;
  el.endGame.disabled = fin;
  el.confirmTransition.disabled = !g.pendingTransition;
  el.consoleNumber.disabled = fin;
  document.querySelectorAll('.console .big').forEach((b) => { b.disabled = fin; });
  document.querySelectorAll('[data-timeout]').forEach((b) => { b.disabled = fin || g.break != null || !!g.pendingTransition; });
}
function renderGame() {
  const g = state.game;
  if (!g) return;
  el.sbHomeName.textContent = g.home.name;
  el.sbAwayName.textContent = g.away.name;
  setFlipScore(el.sbHomeScore, g.home.score);
  setFlipScore(el.sbAwayScore, g.away.score);
  el.sbHomeFouls.textContent = `犯规 ${g.home.fouls}`;
  el.sbAwayFouls.textContent = `犯规 ${g.away.fouls}`;
  el.sbHomeTO.textContent = `暂停 ${g.home.timeouts}`;
  el.sbAwayTO.textContent = `暂停 ${g.away.timeouts}`;
  el.sbHomeBonus.classList.toggle('hidden', g.home.fouls < RULES.bonusFouls);
  el.sbAwayBonus.classList.toggle('hidden', g.away.fouls < RULES.bonusFouls);
  el.ctHome.classList.toggle('active', state.console.team === 'home');
  el.ctAway.classList.toggle('active', state.console.team === 'away');
  // stats tables — preserve scroll positions across the rebuild
  const before = el.statsGrid.querySelectorAll('.stats-scroll');
  const keep = [before[0] ? before[0].scrollTop : null, before[1] ? before[1].scrollTop : null];
  el.statsGrid.innerHTML = statsTeamHTML('home', g.home) + statsTeamHTML('away', g.away);
  const after = el.statsGrid.querySelectorAll('.stats-scroll');
  if (after[0] && keep[0] != null) after[0].scrollTop = keep[0];
  if (after[1] && keep[1] != null) after[1].scrollTop = keep[1];
  // transition bar
  if (g.pendingTransition) {
    el.transitionCard.classList.remove('hidden');
    el.transitionTitle.textContent = g.pendingTransition.title;
    el.transitionText.textContent = g.pendingTransition.text;
  } else {
    el.transitionCard.classList.add('hidden');
  }
  renderClock();
}

/* ====================================================== */
/* GAME — actions                                          */
/* ====================================================== */
function finishGame(msg) {
  const g = state.game;
  if (!g) return;
  g.finished = true; g.running = false; g.status = 'ended';
  g.timeout = null; g.break = null; g.pendingTransition = null;
  renderGame();
  persist();
  notify(`${msg}　终场比分：${g.home.name} ${g.home.score} : ${g.away.score} ${g.away.name}`, 'info', 20000);
  beep(2);
}
function showSetup() {
  el.gameScreen.classList.remove('active');
  el.setupScreen.classList.add('active');
  updateResumeButton();
}
function showGame() {
  el.setupScreen.classList.remove('active');
  el.gameScreen.classList.add('active');
}
function updateResumeButton() {
  el.resumeGame.classList.toggle('hidden', !(state.game && !state.game.finished));
}
function startGame() {
  const homeName = (el.homeName.value || '').trim() || 'Home';
  const awayName = (el.awayName.value || '').trim() || 'Away';
  state.setup.homeName = homeName;
  state.setup.awayName = awayName;
  for (const side of ['home', 'away']) {
    const roster = getRoster(side);
    roster.forEach((p) => { if (typeof p.name === 'string') p.name = p.name.trim(); });
    if (roster.length < 1 || roster.length > RULES.maxRoster) {
      notify(`${sideLabel(side)}需要 1–${RULES.maxRoster} 名球员（当前 ${roster.length}）。`, 'error');
      return;
    }
    for (const p of roster) {
      if (!isValidNumber(p.number)) { notify(`${sideLabel(side)}有球员的球衣号码无效（必须是 0–99 的整数）。`, 'error'); return; }
      if (!p.name) { notify(`${sideLabel(side)}有球员没有填姓名。`, 'error'); return; }
    }
    if (hasDuplicateNumbers(side)) { notify(`${sideLabel(side)}存在重复的球衣号码。`, 'error'); return; }
  }
  state.game = buildGame(homeName, awayName, getRoster('home'), getRoster('away'));
  state.undoStack = [];
  state.console = { team: 'home', number: '' };
  el.consoleNumber.value = '';
  consoleSay('选择球队并输入球衣号码（也可点下方表格里的球员）');
  rebuildFlipCells(el.sbHomeScore, '0');
  rebuildFlipCells(el.sbAwayScore, '0');
  persist();
  showGame();
  renderGame();
  notify('比赛已创建。点「▶ 开始 / 继续」启动计时。', 'info');
}
function openEdit(side, number) {
  const g = state.game;
  if (!g) return;
  const player = findPlayer(side, number);
  if (!player) return;
  activeEdit = { side, number };
  el.editTitle.textContent = `修正数据 — ${g[side].name} #${player.number} ${disp(player.name)}`;
  EDIT_FIELDS.forEach((f) => { $(`edit-${f}`).value = player[f]; });
  el.editModal.classList.remove('hidden');
  $('edit-points').focus();
}

/* event wiring — game */
el.startGame.addEventListener('click', startGame);
el.ctHome.addEventListener('click', () => { setConsoleTeam('home'); el.consoleNumber.focus(); });
el.ctAway.addEventListener('click', () => { setConsoleTeam('away'); el.consoleNumber.focus(); });
el.consoleNumber.addEventListener('input', () => { state.console.number = el.consoleNumber.value; refreshRowSelection(); });
document.querySelectorAll('[data-score]').forEach((b) => b.addEventListener('click', () => consoleApply('s' + b.dataset.score)));
document.querySelectorAll('[data-stat]').forEach((b) => b.addEventListener('click', () => consoleApply(b.dataset.stat)));

el.statsGrid.addEventListener('click', (e) => {
  if (!state.game) return;
  const editBtn = e.target.closest('[data-edit]');
  if (editBtn) {
    const [side, numStr] = editBtn.dataset.edit.split(':');
    openEdit(side, Number(numStr));
    return;
  }
  const row = e.target.closest('tr.row');
  if (row && row.dataset.row) {
    const [side, numStr] = row.dataset.row.split(':');
    setConsoleTeam(side);
    el.consoleNumber.value = numStr;
    state.console.number = numStr;
    refreshRowSelection();
    el.consoleNumber.focus();
  }
});

el.saveEdit.addEventListener('click', () => {
  const g = state.game;
  if (!g || !activeEdit) return;
  const player = findPlayer(activeEdit.side, activeEdit.number);
  if (!player) { activeEdit = null; el.editModal.classList.add('hidden'); return; }
  const values = EDIT_FIELDS.map((f) => Number($(`edit-${f}`).value));
  if (values.some((v) => !Number.isInteger(v) || v < 0)) { notify('数值不合法（必须是 ≥ 0 的整数）。', 'error'); return; }
  pushUndo();
  const teamObj = g[activeEdit.side];
  const oldPoints = player.points, oldFouls = player.fouls;
  EDIT_FIELDS.forEach((f, i) => { player[f] = values[i]; });
  teamObj.score = Math.max(0, teamObj.score + (player.points - oldPoints));
  teamObj.fouls = Math.max(0, teamObj.fouls + (player.fouls - oldFouls));
  activeEdit = null;
  el.editModal.classList.add('hidden');
  renderGame();
  persist();
  notify('已更新球员数据（队伍比分 / 全队犯规已同步）。', 'info');
});
el.cancelEdit.addEventListener('click', () => { activeEdit = null; el.editModal.classList.add('hidden'); });
el.editModal.addEventListener('click', (e) => { if (e.target === el.editModal) { activeEdit = null; el.editModal.classList.add('hidden'); } });

el.startResume.addEventListener('click', () => {
  const g = state.game;
  if (!g || g.finished || g.pendingTransition || g.break != null || g.timeout) return;
  g.running = true;
  g.status = isStopClockPeriod(g) ? 'running-stop' : 'running';
  renderGame();
  persist();
});
el.pauseGame.addEventListener('click', () => {
  const g = state.game;
  if (!g || g.finished || !g.running || g.break != null) return; // breaks run automatically — can't pause them
  g.running = false;
  g.status = 'paused';
  renderGame();
  persist();
});
el.confirmTransition.addEventListener('click', () => {
  const g = state.game;
  if (!g || !g.pendingTransition) return;
  g.break = g.pendingTransition.breakSeconds;
  g.status = 'break';
  g.running = true;
  g.pendingTransition = null;
  renderGame();
  persist();
});
document.querySelectorAll('[data-timeout]').forEach((btn) => btn.addEventListener('click', () => {
  const g = state.game;
  if (!g || g.finished) return;
  if (g.timeout) { notify('已有正在进行的暂停。', 'warn'); return; }
  if (g.break != null || g.pendingTransition) { notify('休息 / 阶段切换中无法请求暂停。', 'warn'); return; }
  const team = g[btn.dataset.timeout];
  if (team.timeouts <= 0) { notify(`${team.name} 已没有暂停次数。`, 'warn'); return; }
  pushUndo();
  team.timeouts -= 1;
  g.timeout = { team: btn.dataset.timeout, left: RULES.timeoutSeconds };
  g.running = false;
  g.status = 'timeout';
  notify(`${team.name} 请求暂停（${RULES.timeoutSeconds} 秒）。`, 'info');
  beep(1);
  renderGame();
  persist();
}));
el.endGame.addEventListener('click', () => {
  const g = state.game;
  if (!g || g.finished) return;
  if (!confirm('确认结束本场比赛？')) return;
  finishGame('比赛由操作员结束。');
});
el.undoAction.addEventListener('click', () => {
  if (!state.undoStack.length) { notify('没有可撤销的操作。', 'warn'); return; }
  state.game = state.undoStack.pop();
  renderGame();
  persist();
  notify('已撤销上一步。', 'info');
});
el.backToSetup.addEventListener('click', () => {
  const g = state.game;
  if (g && !g.finished && !confirm('比赛尚未结束，确定返回设置界面？（比赛会被保留，可从设置界面的「继续未结束的比赛」回来）')) return;
  showSetup();
});

function buildExportText() {
  const g = state.game;
  if (!g) return '';
  const teamLines = (team) => {
    const sorted = team.players.slice().sort((a, b) => a.number - b.number);
    return [`${team.name}（${team.score}）:`, ...sorted.map((p) =>
      `  #${p.number} ${p.name} — 得分:${p.points} 助攻:${p.assists} 篮板:${p.rebounds} 抢断:${p.steals} 盖帽:${p.blocks} 犯规:${p.fouls}`
    )].join('\n');
  };
  const head = g.finished
    ? '终场比分'
    : `比分（${periodName(g)} ${g.periodType === 'GP' ? '加时绝杀' : fmt(g.break != null ? g.break : g.secondsLeft)}）`;
  return `${head}：${g.home.name} ${g.home.score} : ${g.away.score} ${g.away.name}\n\n${teamLines(g.home)}\n\n${teamLines(g.away)}`;
}
el.copyExport.addEventListener('click', async () => {
  if (!state.game) return;
  const text = buildExportText();
  try { await navigator.clipboard.writeText(text); notify('比赛文本已复制到剪贴板。', 'info'); }
  catch { notify('复制失败，文本已输出到开发者控制台。', 'warn'); console.log(text); }
});

/* ====================================================== */
/* INIT                                                    */
/* ====================================================== */
function init() {
  loadPersisted();
  hydrateSetupForm();
  if (state.game && state.game.finished) state.game = null; // a finished game: start fresh, keep rosters
  if (state.game) {
    // After a reopen: keep an auto-running break going, let any timeout keep
    // counting, but pause the game clock so no game time is silently lost.
    state.game.running = state.game.break != null;
    state.game.status = state.game.break != null ? 'break' : (state.game.timeout ? 'timeout' : 'paused');
    // show the restored scores immediately (no flip flurry on load)
    rebuildFlipCells(el.sbHomeScore, String(state.game.home.score));
    rebuildFlipCells(el.sbAwayScore, String(state.game.away.score));
    showGame();
    renderGame();
    notify('已恢复上次未结束的比赛（计时已暂停，确认无误后继续）。', 'info', 12000);
  } else {
    showSetup();
  }
  updateResumeButton();
}
init();
