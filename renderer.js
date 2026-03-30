const RULES = {
  quarterSeconds: 12 * 60,
  overtimeSeconds: 5 * 60,
  timeoutSeconds: 60,
  halftimeBreak: 5 * 60,
  shortBreak: 2 * 60,
  preOtBreak: 60,
  maxOvertimes: 2
};

const state = {
  setup: {
    homeName: 'Home', awayName: 'Away', homeRoster: [], awayRoster: []
  },
  game: null,
  undoStack: []
};

const el = {
  setupScreen: document.getElementById('setup-screen'),
  gameScreen: document.getElementById('game-screen'),
  homeName: document.getElementById('home-name'),
  awayName: document.getElementById('away-name'),
  homePlayerInput: document.getElementById('home-player-input'),
  awayPlayerInput: document.getElementById('away-player-input'),
  homeRoster: document.getElementById('home-roster'),
  awayRoster: document.getElementById('away-roster'),
  startGame: document.getElementById('start-game'),
  periodLabel: document.getElementById('period-label'),
  clockLabel: document.getElementById('clock-label'),
  stateLabel: document.getElementById('state-label'),
  homeTeamCard: document.getElementById('home-team-card'),
  awayTeamCard: document.getElementById('away-team-card'),
  statsGrid: document.getElementById('stats-grid'),
  bannerContainer: document.getElementById('banner-container'),
  transitionCard: document.getElementById('transition-card'),
  transitionTitle: document.getElementById('transition-title'),
  transitionText: document.getElementById('transition-text'),
  confirmTransition: document.getElementById('confirm-transition'),
  startResume: document.getElementById('start-resume'),
  pauseGame: document.getElementById('pause-game'),
  endGame: document.getElementById('end-game'),
  undoAction: document.getElementById('undo-action'),
  copyExport: document.getElementById('copy-export'),
  timeoutStatus: document.getElementById('timeout-status'),
  timeoutCountdown: document.getElementById('timeout-countdown'),
  editModal: document.getElementById('edit-modal'),
  saveEdit: document.getElementById('save-edit'),
  cancelEdit: document.getElementById('cancel-edit')
};
const editFields = ['points', 'assists', 'rebounds', 'steals', 'blocks', 'fouls'];
let activeEdit = null;

function notify(message, type = 'info') {
  const row = document.createElement('div');
  row.className = `banner ${type}`;
  const text = document.createElement('span');
  text.textContent = message;
  const close = document.createElement('button');
  close.textContent = '✕';
  close.addEventListener('click', () => row.remove());
  row.append(text, close);
  el.bannerContainer.prepend(row);
}

function renderRoster(side) {
  const list = side === 'home' ? el.homeRoster : el.awayRoster;
  const roster = side === 'home' ? state.setup.homeRoster : state.setup.awayRoster;
  list.innerHTML = '';
  roster.forEach((name, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${name}</span><button data-remove="${side}:${idx}">Remove</button>`;
    list.appendChild(li);
  });
}

function addPlayer(side) {
  const input = side === 'home' ? el.homePlayerInput : el.awayPlayerInput;
  const roster = side === 'home' ? state.setup.homeRoster : state.setup.awayRoster;
  const name = input.value.trim();
  if (!name) return notify('Player name is required.', 'warn');
  if (roster.length >= 15) return notify('Max 15 players per team.', 'warn');
  roster.push(name);
  input.value = '';
  renderRoster(side);
}

document.querySelectorAll('[data-add-player]').forEach((btn) => btn.addEventListener('click', () => addPlayer(btn.dataset.addPlayer)));
[el.homeRoster, el.awayRoster].forEach((list) => {
  list.addEventListener('click', (e) => {
    if (!e.target.dataset.remove) return;
    const [side, idx] = e.target.dataset.remove.split(':');
    const roster = side === 'home' ? state.setup.homeRoster : state.setup.awayRoster;
    roster.splice(Number(idx), 1);
    renderRoster(side);
  });
});

function buildTeam(name, roster) {
  return {
    name,
    score: 0,
    timeouts: 1,
    fouls: 0,
    players: roster.map((p, i) => ({ id: `${name}-${i}`, name: p, points: 0, assists: 0, rebounds: 0, steals: 0, blocks: 0, fouls: 0 }))
  };
}

function initGame() {
  const homeName = el.homeName.value.trim() || 'Home';
  const awayName = el.awayName.value.trim() || 'Away';
  if (!state.setup.homeRoster.length || !state.setup.awayRoster.length) {
    return notify('Each team must have at least 1 player before starting.', 'error');
  }
  state.game = {
    periodIndex: 1,
    periodType: 'Q',
    secondsLeft: RULES.quarterSeconds,
    running: false,
    status: 'paused',
    timeout: null,
    break: null,
    pendingTransition: null,
    home: buildTeam(homeName, state.setup.homeRoster),
    away: buildTeam(awayName, state.setup.awayRoster),
    finished: false
  };
  state.undoStack = [];
  el.setupScreen.classList.remove('active');
  el.gameScreen.classList.add('active');
  renderGame();
}

el.startGame.addEventListener('click', initGame);

function periodLabel() {
  if (state.game.periodType === 'Q') return `Q${state.game.periodIndex}`;
  if (state.game.periodType === 'OT') return `OT${state.game.periodIndex}`;
  return 'Golden Point';
}

function getStopClock() {
  return state.game.periodType === 'OT' || state.game.periodType === 'GP' || (state.game.periodType === 'Q' && state.game.periodIndex === 4);
}

function setTeamTimeoutsForContext() {
  if (state.game.periodType === 'Q' && state.game.periodIndex === 3) {
    state.game.home.timeouts = 2;
    state.game.away.timeouts = 2;
    notify('Second half timeouts reset to 2 per team.', 'info');
  }
  if (state.game.periodType === 'OT') {
    state.game.home.timeouts = 1;
    state.game.away.timeouts = 1;
    notify('Overtime timeout allocation set to 1 per team.', 'info');
  }
}

function updateClock() {
  const g = state.game;
  if (!g || g.finished || !g.running) return;
  if (g.timeout || g.pendingTransition || g.break) return;
  if (g.periodType === 'GP') return;
  g.secondsLeft -= 1;
  if (g.secondsLeft <= 0) {
    g.secondsLeft = 0;
    g.running = false;
    onPeriodExpired();
  }
  renderGame();
}
setInterval(updateClock, 1000);

function onPeriodExpired() {
  const g = state.game;
  if (g.periodType === 'Q' && g.periodIndex < 4) {
    const isHalftime = g.periodIndex === 2;
    g.pendingTransition = {
      title: `End of Q${g.periodIndex}`,
      text: `Confirm ${isHalftime ? 'halftime (5:00)' : 'break (2:00)'} before next quarter.`,
      apply: () => {
        g.break = isHalftime ? RULES.halftimeBreak : RULES.shortBreak;
        g.status = 'break';
        g.running = true;
      }
    };
  } else if (g.periodType === 'Q' && g.periodIndex === 4) {
    if (g.home.score === g.away.score) {
      g.pendingTransition = {
        title: 'End of Q4 - Tie Game',
        text: 'Confirm overtime start (1:00 pre-OT break).',
        apply: () => {
          g.break = RULES.preOtBreak;
          g.status = 'break';
          g.running = true;
        }
      };
    } else {
      finishGame('Regulation complete.');
    }
  } else if (g.periodType === 'OT') {
    if (g.home.score === g.away.score && g.periodIndex < RULES.maxOvertimes) {
      g.pendingTransition = {
        title: `End of OT${g.periodIndex} - Still Tied`,
        text: 'Confirm next overtime start (1:00 pre-OT break).',
        apply: () => {
          g.break = RULES.preOtBreak;
          g.status = 'break';
          g.running = true;
        }
      };
    } else if (g.home.score === g.away.score) {
      g.periodType = 'GP';
      g.status = 'golden-point';
      notify('Golden Point active. Next score wins.', 'warn');
    } else {
      finishGame('Overtime complete.');
    }
  }
}

function updateBreak() {
  const g = state.game;
  if (!g || !g.break || !g.running) return;
  g.break -= 1;
  if (g.break <= 0) {
    g.break = null;
    if (g.periodType === 'Q' && g.periodIndex < 4) {
      g.periodIndex += 1;
      g.secondsLeft = RULES.quarterSeconds;
      g.status = 'paused';
      g.running = false;
      if (g.periodIndex !== 4) {
        g.home.fouls = 0;
        g.away.fouls = 0;
      }
      setTeamTimeoutsForContext();
    } else if (g.periodType === 'Q' && g.periodIndex === 4) {
      g.periodType = 'OT';
      g.periodIndex = 1;
      g.secondsLeft = RULES.overtimeSeconds;
      g.status = 'paused';
      g.running = false;
      setTeamTimeoutsForContext();
    } else if (g.periodType === 'OT') {
      g.periodIndex += 1;
      g.secondsLeft = RULES.overtimeSeconds;
      g.status = 'paused';
      g.running = false;
      setTeamTimeoutsForContext();
    }
  }
  renderGame();
}
setInterval(updateBreak, 1000);

function fmt(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function teamCard(team) {
  return `<h2>${team.name}</h2><div class="team-score">${team.score}</div>
    <div class="team-meta">
      <div class="meta-block"><small>Fouls</small><div>${team.fouls}</div></div>
      <div class="meta-block"><small>Timeouts</small><div>${team.timeouts}</div></div>
      <div class="meta-block"><small>Bonus</small><div>${team.fouls >= 4 ? 'ON' : 'OFF'}</div></div>
    </div>`;
}

function statsTable(side, team) {
  const rows = team.players.map((p) => `<tr>
    <td>${p.name}</td><td>${p.points}</td><td>${p.assists}</td><td>${p.rebounds}</td><td>${p.steals}</td><td>${p.blocks}</td><td>${p.fouls}</td>
    <td><div class="actions">
      <button data-act="${side}:${p.id}:p1">+1</button><button data-act="${side}:${p.id}:p2">+2</button><button data-act="${side}:${p.id}:p3">+3</button><button data-act="${side}:${p.id}:ast">A</button>
      <button data-act="${side}:${p.id}:reb">R</button><button data-act="${side}:${p.id}:stl">S</button><button data-act="${side}:${p.id}:blk">B</button><button data-act="${side}:${p.id}:foul">F</button>
      <button data-edit="${side}:${p.id}">Edit</button><button data-reset="${side}:${p.id}">Reset</button>
    </div></td>
  </tr>`).join('');

  return `<article class="stats-team"><h3>${team.name} Players</h3>
    <table><thead><tr><th>Player</th><th>Pts</th><th>Ast</th><th>Reb</th><th>Stl</th><th>Blk</th><th>Fouls</th><th>Actions</th></tr></thead>
    <tbody>${rows}</tbody></table></article>`;
}

function renderGame() {
  const g = state.game;
  if (!g) return;
  el.periodLabel.textContent = periodLabel();
  el.clockLabel.textContent = g.periodType === 'GP' ? 'SUDDEN DEATH' : fmt(g.break ?? g.secondsLeft);
  el.stateLabel.textContent = g.break ? 'break' : g.timeout ? 'timeout' : g.status;
  el.homeTeamCard.innerHTML = teamCard(g.home);
  el.awayTeamCard.innerHTML = teamCard(g.away);
  el.statsGrid.innerHTML = `${statsTable('home', g.home)}${statsTable('away', g.away)}`;

  if (g.pendingTransition) {
    el.transitionCard.classList.remove('hidden');
    el.transitionTitle.textContent = g.pendingTransition.title;
    el.transitionText.textContent = g.pendingTransition.text;
  } else {
    el.transitionCard.classList.add('hidden');
  }

  if (g.timeout) {
    el.timeoutStatus.textContent = `${g.timeout.team.toUpperCase()} timeout active`;
    el.timeoutCountdown.textContent = fmt(g.timeout.left);
    document.querySelectorAll('[data-timeout]').forEach((b) => b.classList.toggle('active-timeout', b.dataset.timeout === g.timeout.team));
  } else {
    el.timeoutStatus.textContent = 'No active timeout';
    el.timeoutCountdown.textContent = '--';
    document.querySelectorAll('[data-timeout]').forEach((b) => b.classList.remove('active-timeout'));
  }
}

function cloneGame() {
  state.undoStack.push(JSON.parse(JSON.stringify(state.game)));
  if (state.undoStack.length > 100) state.undoStack.shift();
}

document.getElementById('stats-grid').addEventListener('click', (e) => {
  const g = state.game;
  if (!g || g.finished) return;
  if (e.target.dataset.act) {
    cloneGame();
    const [side, id, act] = e.target.dataset.act.split(':');
    const team = g[side];
    const player = team.players.find((p) => p.id === id);
    if (!player) return;
    if (act === 'p1' || act === 'p2' || act === 'p3') {
      const pts = Number(act.replace('p', ''));
      player.points += pts;
      team.score += pts;
      if (g.periodType === 'GP' && g.home.score !== g.away.score) finishGame('Golden Point winner decided.');
    }
    if (act === 'ast') player.assists += 1;
    if (act === 'reb') player.rebounds += 1;
    if (act === 'stl') player.steals += 1;
    if (act === 'blk') player.blocks += 1;
    if (act === 'foul') {
      player.fouls += 1;
      team.fouls += 1;
      if (team.fouls === 4) notify(`${team.name} entered bonus.`, 'warn');
      if (player.fouls === 5) notify(`${player.name} fouled out.`, 'error');
    }
    renderGame();
  }
  if (e.target.dataset.edit) {
    const [side, id] = e.target.dataset.edit.split(':');
    const player = g[side].players.find((p) => p.id === id);
    activeEdit = { side, id };
    editFields.forEach((f) => document.getElementById(`edit-${f}`).value = player[f]);
    el.editModal.classList.remove('hidden');
  }
  if (e.target.dataset.reset) {
    const [side, id] = e.target.dataset.reset.split(':');
    const player = g[side].players.find((p) => p.id === id);
    cloneGame();
    g[side].score -= player.points;
    g[side].fouls = Math.max(0, g[side].fouls - player.fouls);
    Object.assign(player, { points: 0, assists: 0, rebounds: 0, steals: 0, blocks: 0, fouls: 0 });
    renderGame();
  }
});

el.saveEdit.addEventListener('click', () => {
  const g = state.game;
  if (!g || !activeEdit) return;
  const player = g[activeEdit.side].players.find((p) => p.id === activeEdit.id);
  const values = editFields.map((f) => Number(document.getElementById(`edit-${f}`).value));
  if (values.some((v) => Number.isNaN(v) || v < 0)) return notify('Invalid stat input for manual edit.', 'error');
  cloneGame();
  const oldPoints = player.points;
  const oldFouls = player.fouls;
  editFields.forEach((f, i) => player[f] = values[i]);
  g[activeEdit.side].score += player.points - oldPoints;
  g[activeEdit.side].fouls = Math.max(0, g[activeEdit.side].fouls + (player.fouls - oldFouls));
  activeEdit = null;
  el.editModal.classList.add('hidden');
  renderGame();
});

el.cancelEdit.addEventListener('click', () => {
  activeEdit = null;
  el.editModal.classList.add('hidden');
});

el.startResume.addEventListener('click', () => {
  const g = state.game;
  if (!g || g.finished || g.pendingTransition) return;
  if (g.break || g.timeout) return;
  g.running = true;
  g.status = getStopClock() ? 'stop-clock running' : 'running clock';
  renderGame();
});

el.pauseGame.addEventListener('click', () => {
  const g = state.game;
  if (!g || g.finished) return;
  g.running = false;
  g.status = 'paused';
  renderGame();
});

el.confirmTransition.addEventListener('click', () => {
  const g = state.game;
  if (!g?.pendingTransition) return;
  g.pendingTransition.apply();
  g.pendingTransition = null;
  renderGame();
});

document.querySelectorAll('[data-timeout]').forEach((button) => {
  button.addEventListener('click', () => {
    const g = state.game;
    if (!g || g.timeout || g.finished) return;
    const team = g[button.dataset.timeout];
    if (team.timeouts <= 0) return notify(`${team.name} has no timeouts left.`, 'error');
    cloneGame();
    team.timeouts -= 1;
    g.timeout = { team: button.dataset.timeout, left: RULES.timeoutSeconds };
    g.running = false;
    g.status = 'timeout';
    renderGame();
  });
});

setInterval(() => {
  const g = state.game;
  if (!g?.timeout) return;
  g.timeout.left -= 1;
  if (g.timeout.left <= 0) {
    g.timeout = null;
    g.status = 'paused';
    notify('Timeout ended.', 'info');
  }
  renderGame();
}, 1000);

function finishGame(msg) {
  const g = state.game;
  g.finished = true;
  g.running = false;
  g.status = 'ended';
  notify(msg, 'info');
  renderGame();
}

el.endGame.addEventListener('click', () => {
  if (!state.game?.finished) finishGame('Game ended by operator.');
});

el.undoAction.addEventListener('click', () => {
  if (!state.undoStack.length) return notify('Nothing to undo.', 'warn');
  state.game = state.undoStack.pop();
  renderGame();
});

function buildExport() {
  const g = state.game;
  const teamText = (team) => [
    `${team.name}:`,
    ...team.players.map((p) => `${p.name} - Points: ${p.points}, Assists: ${p.assists}, Rebounds: ${p.rebounds}, Steals: ${p.steals}, Blocks: ${p.blocks}, Fouls: ${p.fouls}`)
  ].join('\n');
  return `Final Score:\n${g.home.name} ${g.home.score} : ${g.away.score} ${g.away.name}\n\n${teamText(g.home)}\n\n${teamText(g.away)}`;
}

el.copyExport.addEventListener('click', async () => {
  if (!state.game) return;
  const text = buildExport();
  try {
    await navigator.clipboard.writeText(text);
    notify('Final report copied to clipboard.', 'info');
  } catch {
    notify('Clipboard failed. Copy from console fallback.', 'warn');
    console.log(text);
  }
});
