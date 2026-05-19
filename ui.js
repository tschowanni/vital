/* ============================================================================
   VITAL · UI · Dashboard, Screen-Manager, Report-Generierung
   ============================================================================ */

'use strict';

const UI = {
  init() {
    // Top-Bar
    Utils.$('#bt-pill').addEventListener('click', UI.onBTClick);

    // Dashboard-Tiles
    Utils.$('#tile-tilt').addEventListener('click', () => UI.startTiltTest());
    Utils.$('#tile-morning').addEventListener('click', () => MorningRoutine.start());
    Utils.$('#tile-evening').addEventListener('click', () => EveningBP.start());
    Utils.$('#tile-diary').addEventListener('click', () => Diary.start());
    Utils.$('#btn-stats').addEventListener('click', () => UI.showStats());
    Utils.$('#btn-report').addEventListener('click', () => UI.showReport());

    // Back-Buttons
    Utils.$$('.back-btn').forEach(btn => {
      btn.addEventListener('click', () => UI.showScreen('dashboard'));
    });

    // Tilt-Test
    Utils.$('#tilt-btn-abort-lying').addEventListener('click', TiltTest.abort);
    Utils.$('#tilt-btn-standing-start').addEventListener('click', TiltTest.startStandingPhase);
    Utils.$('#tilt-btn-abort-standup').addEventListener('click', TiltTest.abort);
    Utils.$('#tilt-btn-abort-standing').addEventListener('click', TiltTest.abort);
    Utils.$('#tilt-btn-done').addEventListener('click', () => UI.showScreen('dashboard'));

    // Morgen-Routine
    Utils.$('#morning-bp-submit').addEventListener('click', UI.onMorningBPSubmit);
    Utils.$('#morning-choice-hrv').addEventListener('click', () => MorningRoutine.startHRV());
    // Beide "Orthostat starten"-Buttons (nach BD und nach HRV)
    Utils.$('#morning-choice-ortho-1').addEventListener('click', () => MorningRoutine.startOrthostat());
    Utils.$('#morning-choice-ortho-2').addEventListener('click', () => MorningRoutine.startOrthostat());
    // Beide "Fertig"-Buttons (nach BD und nach HRV)
    Utils.$('#morning-choice-finish-1').addEventListener('click', () => MorningRoutine.finish());
    Utils.$('#morning-choice-finish-2').addEventListener('click', () => MorningRoutine.finish());
    Utils.$('#morning-hrv-abort').addEventListener('click', MorningRoutine.abort);
    Utils.$('#morning-ortho-skip').addEventListener('click', MorningRoutine.skipOrthostat);
    Utils.$('#morning-ortho-abort').addEventListener('click', MorningRoutine.abort);
    Utils.$('#morning-done').addEventListener('click', () => UI.showScreen('dashboard'));

    // Abend-BD
    Utils.$('#evening-submit').addEventListener('click', UI.onEveningSubmit);

    // Tagebuch
    const dizz = Utils.$('#diary-dizziness');
    const well = Utils.$('#diary-wellbeing');
    dizz.addEventListener('input', e => Utils.$('#diary-dizziness-val').textContent = e.target.value);
    well.addEventListener('input', e => Utils.$('#diary-wellbeing-val').textContent = e.target.value);
    Utils.$('#diary-submit').addEventListener('click', Diary.submit);

    // Report
    Utils.$('#report-print').addEventListener('click', () => window.print());
    Utils.$('#report-export').addEventListener('click', UI.exportJSON);

    // Import (Statistik-Seite)
    Utils.$('#import-trigger').addEventListener('click', () => Utils.$('#import-file').click());
    Utils.$('#import-file').addEventListener('change', UI.onImportFileChosen);

    // Modal
    Utils.$('#modal-backdrop').addEventListener('click', e => {
      if (e.target.id === 'modal-backdrop') UI.closeModal();
    });

    // Bluetooth-Check
    if (!BT.isSupported()) {
      Utils.$('#bt-warning').style.display = 'block';
    }

    UI.renderDashboard();
  },

  /* ----- SCREEN-MANAGER --------------------------------------------------- */
  showScreen(name) {
    Utils.$$('.screen').forEach(s => s.classList.remove('active'));
    const el = Utils.$(`#screen-${name}`);
    if (el) el.classList.add('active');
    State.currentScreen = name;
    if (name === 'dashboard') UI.renderDashboard();
  },

  /* ----- BLUETOOTH -------------------------------------------------------- */
  setBT(status, text) {
    const pill = Utils.$('#bt-pill');
    const tx = Utils.$('#bt-text');
    pill.classList.remove('disconnected', 'connecting', 'connected', 'error');
    pill.classList.add(status);
    tx.textContent = text;
  },

  async onBTClick() {
    if (State.btStatus === 'connected') {
      if (confirm('Verbindung zum Brustgurt trennen?')) await BT.disconnect();
      return;
    }
    try { await BT.connect(); }
    catch (err) { alert('Bluetooth-Fehler: ' + (err.message || err)); }
  },

  /* ----- LIVE-HR ---------------------------------------------------------- */
  updateLiveHR(hr) {
    const t = State.currentScreen;
    if (t === 'tilt-lying') {
      const el = Utils.$('#tilt-lying-hr'); if (el) { el.textContent = hr; el.classList.remove('no-signal'); }
    } else if (t === 'tilt-standing') {
      const el = Utils.$('#tilt-standing-hr');
      if (el) { el.textContent = hr; el.classList.remove('no-signal'); }
      if (State.activeTest && State.activeTest.baselineHR) {
        const d = hr - State.activeTest.baselineHR;
        Utils.$('#tilt-standing-delta').textContent = `${d >= 0 ? '+' : ''}${d} gegenüber Liegend`;
      }
    } else if (t === 'tilt-standup') {
      Utils.$('#tilt-standup-baseline').textContent = State.activeTest?.baselineHR || hr;
    } else if (t === 'morning-hrv') {
      const el = Utils.$('#morning-hrv-hr'); if (el) { el.textContent = hr; el.classList.remove('no-signal'); }
    }
  },

  /* ----- TILT-TEST UI ----------------------------------------------------- */
  startTiltTest() {
    if (State.btStatus !== 'connected') {
      const ok = confirm('Polar H10 nicht verbunden. Jetzt verbinden?');
      if (!ok) return;
      BT.connect().then(() => TiltTest.start()).catch(err => alert('BT-Fehler: ' + (err.message || err)));
      return;
    }
    TiltTest.start();
  },

  updateLyingProgress(remainingMs, progressPct) {
    Utils.$('#tilt-lying-timer').textContent = Utils.fmtMMSS(remainingMs);
    Utils.$('#tilt-lying-progress').style.width = `${progressPct}%`;
    const tv = Utils.$('#tilt-lying-timer');
    const pf = Utils.$('#tilt-lying-progress');
    if (remainingMs <= 30000) { tv.classList.add('warning'); pf.classList.add('warning'); }
    else { tv.classList.remove('warning'); pf.classList.remove('warning'); }
  },

  showBaselineCard() {
    Utils.$('#tilt-baseline-card').style.display = 'block';
    Utils.$('#tilt-lying-instruction').textContent = 'Letzte 2 Min — Ruhepuls wird gemessen';
  },

  updateBaselineCurrent(hr) {
    Utils.$('#tilt-baseline-current').textContent = hr != null ? `${hr} bpm` : '-- bpm';
  },

  showStandupScreen(baseline) {
    UI.showScreen('tilt-standup');
    Utils.$('#tilt-standup-baseline').textContent = baseline != null ? baseline : '--';
  },

  updateStandingProgress(remainingMs, progressPct, delta) {
    Utils.$('#tilt-standing-timer').textContent = Utils.fmtMMSS(remainingMs);
    Utils.$('#tilt-standing-progress').style.width = `${progressPct}%`;
    const elapsed = CFG.TILT_STANDING_DURATION - Math.ceil(remainingMs / 1000);
    const next = CFG.TILT_MEASUREMENTS_AT.find(t => t > elapsed);
    if (next) {
      Utils.$('#tilt-standing-timer-cap').textContent = `Nächste Messung in ${Utils.fmtMMSS((next - elapsed) * 1000)}`;
    } else {
      Utils.$('#tilt-standing-timer-cap').textContent = 'Verbleibend · Stehen';
    }
  },

  markMeasurementActive(key) {
    const item = Utils.$(`.stage-item[data-measure="${key}"]`);
    if (!item) return;
    item.querySelector('.stage-num').classList.add('active');
    const val = item.querySelector('.stage-val');
    val.classList.add('active');
    val.classList.remove('pending');
    val.textContent = 'Messung läuft ...';
  },

  markMeasurementDone(key, hr, delta) {
    const item = Utils.$(`.stage-item[data-measure="${key}"]`);
    if (!item) return;
    const num = item.querySelector('.stage-num');
    num.classList.remove('active');
    num.classList.add('done');
    num.textContent = '✓';
    const val = item.querySelector('.stage-val');
    val.classList.remove('active', 'pending');
    val.innerHTML = `${hr} bpm<span class="delta">(${delta >= 0 ? '+' : ''}${delta})</span>`;
  },

  resetMeasurementUI() {
    CFG.TILT_MEASUREMENT_KEYS.forEach((key, idx) => {
      const item = Utils.$(`.stage-item[data-measure="${key}"]`);
      if (!item) return;
      const num = item.querySelector('.stage-num');
      const val = item.querySelector('.stage-val');
      num.className = 'stage-num';
      num.textContent = String([1,3,5,10][idx]);
      val.className = 'stage-val pending';
      val.textContent = '—';
    });
    Utils.$(`.stage-item[data-measure="min1"] .stage-num`).classList.add('active');
  },

  showTiltResult(record) {
    UI.showScreen('tilt-result');
    const card = Utils.$('#tilt-result-card');
    const status = Utils.$('#tilt-result-status');
    card.classList.remove('danger', 'success', 'standing', 'accent');
    const v = Utils.classify(record.delta);
    status.classList.remove('pos', 'neg', 'borderline');
    status.classList.add(v.cls);

    if (v.status === 'pos') { card.classList.add('danger'); status.textContent = '⚠ ' + v.label; }
    else if (v.status === 'borderline') { card.classList.add('standing'); status.textContent = '⚠ ' + v.label; }
    else if (v.status === 'neg') { card.classList.add('success'); status.textContent = '✓ ' + v.label; }
    else status.textContent = '— Unbestimmt —';

    Utils.$('#tilt-result-meta').textContent =
      `Test vom ${Utils.fmtDate(record.startedAt)} um ${Utils.fmtTime(record.startedAt)}`;
    Utils.$('#tilt-result-delta').textContent =
      (record.delta != null ? (record.delta >= 0 ? '+' : '') + record.delta : '--');
    Utils.$('#tilt-result-baseline').textContent = record.baselineHR ?? '--';
    Utils.$('#tilt-result-max').textContent = record.maxStandingHR ?? '--';
    const m = record.measurements || {};
    Utils.$('#tilt-result-row-baseline').textContent = record.baselineHR != null ? `${record.baselineHR} bpm` : '-- bpm';
    Utils.$('#tilt-result-row-min1').textContent  = m.min1  != null ? `${m.min1} bpm`  : '-- bpm';
    Utils.$('#tilt-result-row-min3').textContent  = m.min3  != null ? `${m.min3} bpm`  : '-- bpm';
    Utils.$('#tilt-result-row-min5').textContent  = m.min5  != null ? `${m.min5} bpm`  : '-- bpm';
    Utils.$('#tilt-result-row-min10').textContent = m.min10 != null ? `${m.min10} bpm` : '-- bpm';
  },

  /* ----- MORGEN-ROUTINE UI ------------------------------------------------ */
  onMorningBPSubmit() {
    const sys = parseInt(Utils.$('#morning-bp-sys').value);
    const dia = parseInt(Utils.$('#morning-bp-dia').value);
    const hr  = parseInt(Utils.$('#morning-bp-hr').value) || null;
    MorningRoutine.submitBPLying(sys, dia, hr);
  },

  updateHRVProgress(remainingMs, progressPct) {
    Utils.$('#morning-hrv-timer').textContent = Utils.fmtMMSS(remainingMs);
    Utils.$('#morning-hrv-progress').style.width = `${progressPct}%`;
  },

  updateHRVLive(rmssd, sdnn) {
    Utils.$('#morning-hrv-rmssd').textContent = rmssd != null ? rmssd : '--';
    Utils.$('#morning-hrv-sdnn').textContent = sdnn != null ? sdnn : '--';
  },

  updateOrthoCountdown(elapsedSec) {
    const next = [60, 180, 300].find(t => t > elapsedSec);
    if (next) {
      Utils.$('#morning-ortho-timer').textContent = Utils.fmtMMSS((next - elapsedSec) * 1000);
      Utils.$('#morning-ortho-cap').textContent = `Nächste Messung in`;
    } else {
      Utils.$('#morning-ortho-timer').textContent = 'OK';
      Utils.$('#morning-ortho-cap').textContent = 'Fertig';
    }
  },

  promptOrthoBP(key, label) {
    const sys = prompt(`${label} — Systolisch (SYS)?`);
    if (sys === null) return;
    const dia = prompt(`${label} — Diastolisch (DIA)?`);
    if (dia === null) return;
    const hr = prompt(`${label} — Puls (optional, sonst leer lassen)?`);
    MorningRoutine.submitOrthoBP(key, parseInt(sys), parseInt(dia), parseInt(hr) || null);
  },

  updateOrthoRow(key, sys, dia, hr) {
    const item = Utils.$(`.ortho-row[data-key="${key}"]`);
    if (!item) return;
    item.querySelector('.stage-num').classList.add('done');
    item.querySelector('.stage-num').textContent = '✓';
    const val = item.querySelector('.stage-val');
    val.classList.remove('pending');
    val.textContent = `${sys}/${dia}${hr ? ` · ${hr}bpm` : ''}`;
  },

  showMorningResult(record) {
    UI.showScreen('morning-result');
    Utils.$('#morning-result-meta').textContent =
      `Morgen-Routine vom ${Utils.fmtDate(record.ts)} um ${Utils.fmtTime(record.ts)}`;
    const bp = record.bpLying || {};
    Utils.$('#morning-result-bp').textContent = `${bp.sys ?? '--'}/${bp.dia ?? '--'}`;
    Utils.$('#morning-result-hr').textContent = bp.hr ?? '--';
    const hrv = record.hrv || {};
    Utils.$('#morning-result-rmssd').textContent = hrv.rmssd ?? '--';
    Utils.$('#morning-result-sdnn').textContent = hrv.sdnn ?? '--';
    const orth = record.orthostatic || {};
    const orthDiv = Utils.$('#morning-result-ortho');
    if (orth && (orth.min1 || orth.min3 || orth.min5)) {
      orthDiv.style.display = 'block';
      ['min1','min3','min5'].forEach(k => {
        const o = orth[k];
        const lbl = { min1: '1 Min', min3: '3 Min', min5: '5 Min' }[k];
        Utils.$(`#morning-result-${k}`).textContent = (o && typeof o === 'object')
          ? `${o.sys}/${o.dia}${o.hr ? ` · ${o.hr}bpm` : ''}`
          : '—';
      });
    } else {
      orthDiv.style.display = 'none';
    }
  },

  /* ----- ABEND-BD UI ------------------------------------------------------ */
  onEveningSubmit() {
    const sys = parseInt(Utils.$('#evening-sys').value);
    const dia = parseInt(Utils.$('#evening-dia').value);
    const hr  = parseInt(Utils.$('#evening-hr').value) || null;
    EveningBP.submit(sys, dia, hr);
  },

  /* ----- DASHBOARD -------------------------------------------------------- */
  renderDashboard() {
    const today = new Date();
    Utils.$('#dashboard-num').textContent = String(today.getDate());
    Utils.$('#dashboard-day').textContent = Utils.fmtDayName(today);
    Utils.$('#dashboard-word').textContent = `${Utils.fmtDateLong(today)}`;

    UI.renderTileTilt();
    UI.renderTileMorning();
    UI.renderTileEvening();
    UI.renderTileDiary();
    UI.renderMiniTrend();
  },

  renderTileTilt() {
    const last = Storage.latest(CFG.STORE.TILT);
    const tile = Utils.$('#tile-tilt');
    const status = Utils.$('#tile-tilt-status');
    const value = Utils.$('#tile-tilt-value');
    const info = Utils.$('#tile-tilt-info');
    tile.classList.remove('done', 'due', 'overdue');
    if (!last) {
      status.className = 'tile-status due'; status.textContent = 'Neu';
      value.textContent = '—'; info.textContent = 'Noch nicht getestet';
      return;
    }
    const days = Utils.daysBetween(last.startedAt, new Date());
    const dueIn = CFG.INTERVAL.TILT - days;
    if (dueIn > 0) {
      tile.classList.add('done');
      status.className = 'tile-status done'; status.textContent = 'OK';
    } else if (dueIn === 0) {
      tile.classList.add('due');
      status.className = 'tile-status due'; status.textContent = 'Fällig';
    } else {
      tile.classList.add('overdue');
      status.className = 'tile-status overdue'; status.textContent = `${-dueIn}d über`;
    }
    value.innerHTML = `${last.delta >= 0 ? '+' : ''}${last.delta}<span class="tile-unit"> bpm</span>`;
    info.textContent = `${Utils.fmtDate(last.startedAt)} · ${last.verdictLabel}`;
  },

  renderTileMorning() {
    const todayRec = Storage.today(CFG.STORE.MORNING)[0];
    const last = Storage.latest(CFG.STORE.MORNING);
    const tile = Utils.$('#tile-morning');
    const status = Utils.$('#tile-morning-status');
    const value = Utils.$('#tile-morning-value');
    const info = Utils.$('#tile-morning-info');
    tile.classList.remove('done', 'due', 'overdue');
    if (todayRec) {
      tile.classList.add('done');
      status.className = 'tile-status done'; status.textContent = 'Heute';
      const bp = todayRec.bpLying || {};
      value.innerHTML = `${bp.sys}/${bp.dia}<span class="tile-unit"></span>`;
      const hrv = todayRec.hrv;
      info.textContent = hrv ? `RMSSD ${hrv.rmssd}ms · ${Utils.fmtTime(todayRec.ts)}` : `${Utils.fmtTime(todayRec.ts)}`;
    } else if (last) {
      tile.classList.add('due');
      status.className = 'tile-status due'; status.textContent = 'Fällig';
      const bp = last.bpLying || {};
      value.innerHTML = `${bp.sys}/${bp.dia}<span class="tile-unit"></span>`;
      info.textContent = `Zuletzt ${Utils.fmtDate(last.ts)}`;
    } else {
      tile.classList.add('due');
      status.className = 'tile-status due'; status.textContent = 'Neu';
      value.textContent = '—';
      info.textContent = 'Noch nicht erfasst';
    }
  },

  renderTileEvening() {
    const todayRec = Storage.today(CFG.STORE.EVENING)[0];
    const last = Storage.latest(CFG.STORE.EVENING);
    const tile = Utils.$('#tile-evening');
    const status = Utils.$('#tile-evening-status');
    const value = Utils.$('#tile-evening-value');
    const info = Utils.$('#tile-evening-info');
    tile.classList.remove('done', 'due', 'overdue');
    if (todayRec) {
      tile.classList.add('done');
      status.className = 'tile-status done'; status.textContent = 'Heute';
      value.innerHTML = `${todayRec.sys}/${todayRec.dia}<span class="tile-unit"></span>`;
      info.textContent = `${Utils.fmtTime(todayRec.ts)}${todayRec.hr ? ' · ' + todayRec.hr + ' bpm' : ''}`;
    } else if (last) {
      tile.classList.add('due');
      status.className = 'tile-status due'; status.textContent = 'Fällig';
      value.innerHTML = `${last.sys}/${last.dia}<span class="tile-unit"></span>`;
      info.textContent = `Zuletzt ${Utils.fmtDate(last.ts)}`;
    } else {
      tile.classList.add('due');
      status.className = 'tile-status due'; status.textContent = 'Neu';
      value.textContent = '—';
      info.textContent = 'Noch nicht erfasst';
    }
  },

  renderTileDiary() {
    const todayRec = Storage.today(CFG.STORE.DIARY)[0];
    const last = Storage.latest(CFG.STORE.DIARY);
    const tile = Utils.$('#tile-diary');
    const status = Utils.$('#tile-diary-status');
    const value = Utils.$('#tile-diary-value');
    const info = Utils.$('#tile-diary-info');
    tile.classList.remove('done', 'due', 'overdue');
    if (todayRec) {
      tile.classList.add('done');
      status.className = 'tile-status done'; status.textContent = 'Heute';
      value.innerHTML = `<span style="color:var(--danger)">${todayRec.dizziness}</span>/<span style="color:var(--success)">${todayRec.wellbeing}</span>`;
      info.textContent = `Schwindel/Wohlfühl · ${Utils.fmtTime(todayRec.ts)}`;
    } else if (last) {
      tile.classList.add('due');
      status.className = 'tile-status due'; status.textContent = 'Fällig';
      value.innerHTML = `<span style="color:var(--danger)">${last.dizziness}</span>/<span style="color:var(--success)">${last.wellbeing}</span>`;
      info.textContent = `Zuletzt ${Utils.fmtDate(last.ts)}`;
    } else {
      tile.classList.add('due');
      status.className = 'tile-status due'; status.textContent = 'Neu';
      value.textContent = '—';
      info.textContent = 'Noch nicht erfasst';
    }
  },

  /** Mini-Trend: letzte 14 Tagebucheinträge — Schwindel/Wohlfühl */
  renderMiniTrend() {
    const recent = Storage.recent(CFG.STORE.DIARY, 30).reverse(); // älteste zuerst
    const svg = Utils.$('#trend-svg');
    if (!recent.length) {
      svg.innerHTML = `<text x="50%" y="50%" text-anchor="middle" dy="0.3em" fill="#5b6373" font-size="11" font-family="Manrope">Keine Daten</text>`;
      Utils.$('#trend-meta').textContent = '—';
      return;
    }
    const w = 320, h = 50, pad = 4;
    const max = 10; const min = 0;
    const points = recent.map((r, i) => {
      const x = pad + (i / Math.max(1, recent.length - 1)) * (w - 2*pad);
      return {
        x,
        yDizz: h - pad - ((r.dizziness - min) / (max - min)) * (h - 2*pad),
        yWell: h - pad - ((r.wellbeing - min) / (max - min)) * (h - 2*pad),
      };
    });
    const pathDizz = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.yDizz.toFixed(1)}`).join(' ');
    const pathWell = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.yWell.toFixed(1)}`).join(' ');
    svg.innerHTML = `
      <path d="${pathWell}" stroke="#7cc88f" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${pathDizz}" stroke="#ff7777" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    `;
    Utils.$('#trend-meta').textContent = `${recent.length} Tage`;
  },

  /* ----- STATISTIK ------------------------------------------------------- */
  showStats() {
    UI.showScreen('stats');
    UI.renderStats();
  },

  renderStats() {
    const stats = Diary.computeStats();
    const container = Utils.$('#stats-content');
    if (!stats) {
      container.innerHTML = `<div class="history-empty">Noch keine Tagebuch-Einträge.</div>`;
      return;
    }

    const distRows = (dist, totalCount, cls) => {
      const maxV = Math.max(...dist);
      return dist.map((v, i) => {
        const pct = maxV > 0 ? (v / maxV) * 100 : 0;
        return `<div class="dist-row">
          <span class="k">${i}</span>
          <div class="bar-container"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>
          <span class="v">${v}</span>
        </div>`;
      }).join('');
    };

    const tiltAll = Storage.loadAll(CFG.STORE.TILT);
    const morningAll = Storage.loadAll(CFG.STORE.MORNING);
    const eveningAll = Storage.loadAll(CFG.STORE.EVENING);

    // Durchschnitte Blutdruck
    const morningBPs = morningAll.map(r => r.bpLying).filter(b => b && b.sys && b.dia);
    const morningSys = Utils.stats(morningBPs.map(b => b.sys));
    const morningDia = Utils.stats(morningBPs.map(b => b.dia));
    const eveningSys = Utils.stats(eveningAll.map(r => r.sys).filter(v => v));
    const eveningDia = Utils.stats(eveningAll.map(r => r.dia).filter(v => v));
    const tiltDeltas = Utils.stats(tiltAll.map(r => r.delta).filter(v => v != null));

    container.innerHTML = `
      <div class="card">
        <div class="divider">Tagebuch · ${stats.count} Einträge</div>
        <div class="row"><span class="k">Zeitraum</span><span class="v">${Utils.fmtDate(stats.from)} – ${Utils.fmtDate(stats.to)}</span></div>
        <div class="row"><span class="k">Ø Schwindel</span><span class="v" style="color:var(--danger)">${stats.dizziness.mean.toFixed(2)}</span></div>
        <div class="row"><span class="k">Ø Wohlfühl</span><span class="v" style="color:var(--success)">${stats.wellbeing.mean.toFixed(2)}</span></div>
        <div class="row"><span class="k">Hitze-Trigger</span><span class="v">${stats.heatCount}× (${stats.heatPct}%)</span></div>
        <div class="row"><span class="k">Belastung</span><span class="v">${stats.exertCount}× (${stats.exertPct}%)</span></div>
        <div class="row"><span class="k">Schlechter Schlaf</span><span class="v">${stats.poorSleep}× (${stats.sleepPct}%)</span></div>
      </div>

      <div class="card">
        <div class="divider">Verteilung · Schwindel</div>
        ${distRows(stats.dizzDist, stats.count, 'dizziness')}
      </div>

      <div class="card">
        <div class="divider">Verteilung · Wohlfühl</div>
        ${distRows(stats.wellDist, stats.count, 'wellbeing')}
      </div>

      ${morningSys ? `
      <div class="card">
        <div class="divider">Blutdruck · ${morningAll.length} Morgen / ${eveningAll.length} Abend</div>
        <div class="row"><span class="k">Morgens Ø</span><span class="v">${morningSys.mean.toFixed(0)}/${morningDia.mean.toFixed(0)}</span></div>
        <div class="row"><span class="k">Morgens Max</span><span class="v">${morningSys.max}/${morningDia.max}</span></div>
        ${eveningSys ? `<div class="row"><span class="k">Abends Ø</span><span class="v">${eveningSys.mean.toFixed(0)}/${eveningDia.mean.toFixed(0)}</span></div>` : ''}
        ${eveningSys ? `<div class="row"><span class="k">Abends Max</span><span class="v">${eveningSys.max}/${eveningDia.max}</span></div>` : ''}
      </div>` : ''}

      ${tiltDeltas ? `
      <div class="card">
        <div class="divider">POTS-Tests · ${tiltAll.length}</div>
        <div class="row"><span class="k">Ø Delta</span><span class="v">+${tiltDeltas.mean.toFixed(1)} bpm</span></div>
        <div class="row"><span class="k">Max Delta</span><span class="v">+${tiltDeltas.max} bpm</span></div>
        <div class="row"><span class="k">POTS-positiv</span><span class="v">${tiltAll.filter(t => t.verdict === 'pos').length} / ${tiltAll.length}</span></div>
      </div>` : ''}
    `;
  },

  /* ----- REPORT (druckbar) ----------------------------------------------- */
  showReport() {
    UI.showScreen('report');
    UI.renderReport();
  },

  renderReport() {
    const days = parseInt(Utils.$('#report-days')?.value) || 90;
    const now = new Date();
    const from = new Date(now.getTime() - days * 86400000);

    const tilt    = Storage.loadAll(CFG.STORE.TILT)   .filter(r => new Date(r.startedAt) >= from);
    const morning = Storage.loadAll(CFG.STORE.MORNING).filter(r => new Date(r.ts) >= from);
    const evening = Storage.loadAll(CFG.STORE.EVENING).filter(r => new Date(r.ts) >= from);
    const diary   = Storage.loadAll(CFG.STORE.DIARY)  .filter(r => new Date(r.ts) >= from);

    const morningBPs = morning.map(r => r.bpLying).filter(b => b);
    const mSys = Utils.stats(morningBPs.map(b => b.sys));
    const mDia = Utils.stats(morningBPs.map(b => b.dia));
    const eSys = Utils.stats(evening.map(r => r.sys));
    const eDia = Utils.stats(evening.map(r => r.dia));
    const dizz = Utils.stats(diary.map(r => r.dizziness));
    const well = Utils.stats(diary.map(r => r.wellbeing));
    const tiltDeltas = Utils.stats(tilt.map(r => r.delta).filter(v => v != null));

    const tiltRows = tilt.slice(0, 20).map(r => `
      <tr>
        <td>${Utils.fmtDate(r.startedAt)} ${Utils.fmtTime(r.startedAt)}</td>
        <td class="num">${r.baselineHR ?? '—'}</td>
        <td class="num">${r.maxStandingHR ?? '—'}</td>
        <td class="num">${r.delta != null ? (r.delta>=0?'+':'')+r.delta : '—'}</td>
        <td>${r.verdictLabel ?? ''}</td>
      </tr>
    `).join('');

    const bpRows = (() => {
      const allBP = [
        ...morning.map(r => ({ ts: r.ts, type: 'M', sys: r.bpLying?.sys, dia: r.bpLying?.dia, hr: r.bpLying?.hr })),
        ...evening.map(r => ({ ts: r.ts, type: 'A', sys: r.sys, dia: r.dia, hr: r.hr })),
      ].sort((a,b) => new Date(b.ts) - new Date(a.ts)).slice(0, 30);
      return allBP.map(r => `
        <tr>
          <td>${Utils.fmtDate(r.ts)} ${Utils.fmtTime(r.ts)}</td>
          <td>${r.type === 'M' ? 'Morgens' : 'Abends'}</td>
          <td class="num">${r.sys ?? '—'}/${r.dia ?? '—'}</td>
          <td class="num">${r.hr ?? '—'}</td>
        </tr>
      `).join('');
    })();

    const diaryRows = diary.slice(0, 20).map(r => `
      <tr>
        <td>${Utils.fmtDate(r.ts)}</td>
        <td class="num">${r.dizziness}</td>
        <td class="num">${r.wellbeing}</td>
        <td>${[r.heatTrigger ? 'Hitze' : '', r.exertion ? 'Belastung' : '', r.poorSleep ? 'Schlaf' : ''].filter(Boolean).join(', ') || '—'}</td>
        <td class="num">${r.spo2Min ?? '—'}</td>
      </tr>
    `).join('');

    const reportEl = Utils.$('#report-content');
    reportEl.innerHTML = `
      <div class="report-page">
        <h1>Gesundheits-Monitoring · Verlaufsbericht</h1>
        <p style="color:#666;font-size:12px;">Selbsterhobene Daten — kein medizinisches Gutachten</p>

        <div class="report-meta">
          <div class="report-meta-cell"><div class="lbl">Zeitraum</div><div class="val">${Utils.fmtDate(from)} bis ${Utils.fmtDate(now)} (${days} Tage)</div></div>
          <div class="report-meta-cell"><div class="lbl">Erstellt</div><div class="val">${Utils.fmtDate(now)} ${Utils.fmtTime(now)}</div></div>
          <div class="report-meta-cell"><div class="lbl">Anzahl Tagebuch-Einträge</div><div class="val">${diary.length}</div></div>
          <div class="report-meta-cell"><div class="lbl">Anzahl POTS-Tests</div><div class="val">${tilt.length}</div></div>
        </div>

        <h2>Zusammenfassung</h2>
        ${dizz ? `<p><strong>Schwindel-Ø:</strong> ${dizz.mean.toFixed(2)} / 10 (Min ${dizz.min}, Max ${dizz.max}, Median ${dizz.median})</p>` : ''}
        ${well ? `<p><strong>Wohlbefinden-Ø:</strong> ${well.mean.toFixed(2)} / 10 (Min ${well.min}, Max ${well.max}, Median ${well.median})</p>` : ''}
        ${mSys ? `<p><strong>Blutdruck morgens Ø:</strong> ${mSys.mean.toFixed(0)}/${mDia.mean.toFixed(0)} mmHg · Maximalwert ${mSys.max}/${mDia.max} mmHg</p>` : ''}
        ${eSys ? `<p><strong>Blutdruck abends Ø:</strong> ${eSys.mean.toFixed(0)}/${eDia.mean.toFixed(0)} mmHg · Maximalwert ${eSys.max}/${eDia.max} mmHg</p>` : ''}
        ${tiltDeltas ? `<p><strong>POTS Active-Stand-Test Ø Pulsanstieg:</strong> +${tiltDeltas.mean.toFixed(1)} bpm (Max +${tiltDeltas.max} bpm) — POTS-positiv in ${tilt.filter(t => t.verdict === 'pos').length} von ${tilt.length} Tests</p>` : ''}

        ${tilt.length ? `
        <h2>POTS Active-Stand-Tests</h2>
        <table>
          <thead><tr><th>Datum/Zeit</th><th>Liegend</th><th>Stehend max</th><th>Delta</th><th>Bewertung</th></tr></thead>
          <tbody>${tiltRows}</tbody>
        </table>
        ${tilt.length > 20 ? `<p style="font-size:10px;color:#888;">Älteste ${tilt.length - 20} Tests aus Platzgründen nicht aufgelistet.</p>` : ''}` : ''}

        ${(morning.length || evening.length) ? `
        <h2>Blutdruck-Verlauf (letzte 30 Messungen)</h2>
        <table>
          <thead><tr><th>Datum/Zeit</th><th>Typ</th><th>BD (mmHg)</th><th>Puls</th></tr></thead>
          <tbody>${bpRows}</tbody>
        </table>` : ''}

        ${diary.length ? `
        <h2>Tagebuch (letzte 20 Einträge)</h2>
        <table>
          <thead><tr><th>Datum</th><th>Schwindel</th><th>Wohlfühl</th><th>Trigger</th><th>SpO2 min</th></tr></thead>
          <tbody>${diaryRows}</tbody>
        </table>` : ''}

        <p style="margin-top:24px;font-size:10px;color:#888;text-align:center;">
          VITAL · Self-Monitoring · ergänzt ärztliche Diagnostik, ersetzt sie nicht.
        </p>
      </div>
    `;
  },

  /* ----- EXPORT ----------------------------------------------------------- */
  exportJSON() {
    const dump = {
      exportedAt: new Date().toISOString(),
      appVersion: CFG.APP_VERSION,
      data: Storage.exportAll(),
    };
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vital-export-${Utils.fmtDate(new Date()).replace(/\./g,'')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /* ----- IMPORT (alte TXT-Tagebuch-Datei) -------------------------------- */
  onImportFileChosen(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    Utils.log('Import: Datei', file.name, file.size, 'bytes');

    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = String(e.target.result || '');
        const result = Diary.parseTxt(text);
        UI.showImportPreview(result, file.name);
      } catch (err) {
        alert('Datei-Lese-Fehler: ' + (err.message || err));
        Utils.log('Import-Fehler:', err);
      }
    };
    reader.onerror = () => alert('Datei konnte nicht gelesen werden.');
    reader.readAsText(file, 'utf-8');

    // Input zurücksetzen, damit selbe Datei nochmal gewählt werden kann
    event.target.value = '';
  },

  showImportPreview(result, fileName) {
    const { records, errors, stats } = result;
    const body = Utils.$('#modal-body');

    if (records.length === 0) {
      body.innerHTML = `
        <h2 style="color:var(--danger);margin-bottom:10px;">Keine gültigen Daten gefunden</h2>
        <p style="color:var(--txt-secondary);font-size:13px;margin-bottom:14px;">
          In <strong>${fileName}</strong> wurden keine Zeilen im erwarteten Format gefunden.
          Erwartet: <code>TT.MM.JJJJ*Schwindel&lt;Wohlfühl&gt;</code>
        </p>
        ${errors.length ? `<p style="color:var(--txt-muted);font-size:11px;">Erste fehlerhafte Zeile (#${errors[0].line}): <code>${UI.escape(errors[0].text)}</code></p>` : ''}
        <button class="btn-ghost" onclick="UI.closeModal()">OK</button>
      `;
      Utils.$('#modal-backdrop').classList.add('active');
      return;
    }

    const existing = Storage.loadAll(CFG.STORE.DIARY).length;
    body.innerHTML = `
      <h2 style="color:var(--txt-primary);margin-bottom:6px;">Import-Vorschau</h2>
      <p style="color:var(--txt-muted);font-size:12px;margin-bottom:14px;">Datei: <strong>${fileName}</strong></p>

      <div class="card">
        <div class="row"><span class="k">Gefundene Einträge</span><span class="v">${stats.count}</span></div>
        <div class="row"><span class="k">Zeitraum</span><span class="v">${Utils.fmtDate(stats.from)} – ${Utils.fmtDate(stats.to)}</span></div>
        <div class="row"><span class="k">Ø Schwindel</span><span class="v" style="color:var(--danger)">${stats.dizzMean.toFixed(2)}</span></div>
        <div class="row"><span class="k">Ø Wohlfühl</span><span class="v" style="color:var(--success)">${stats.wellMean.toFixed(2)}</span></div>
        ${stats.dupDays ? `<div class="row"><span class="k">Tage mit Doppeleintrag</span><span class="v">${stats.dupDays}</span></div>` : ''}
        ${errors.length ? `<div class="row"><span class="k" style="color:var(--warning)">Ignorierte Zeilen</span><span class="v" style="color:var(--warning)">${errors.length}</span></div>` : ''}
      </div>

      ${errors.length ? `
      <div class="alert warning" style="margin:10px 0;">
        <strong>Fehlerhafte Zeilen (werden übersprungen):</strong>
        <div style="font-family:var(--font-mono);font-size:11px;margin-top:6px;max-height:120px;overflow-y:auto;">
          ${errors.slice(0, 10).map(e => `Zeile ${e.line}: <code>${UI.escape(e.text)}</code>`).join('<br>')}
          ${errors.length > 10 ? `<br>... und ${errors.length - 10} weitere` : ''}
        </div>
      </div>` : ''}

      ${existing > 0 ? `
      <div class="alert warning" style="margin:10px 0;">
        <strong>Hinweis:</strong> Im Tagebuch sind bereits ${existing} Einträge.
        Wähle, wie importiert werden soll.
      </div>` : ''}

      <div class="card">
        <div class="divider">Import-Modus</div>
        <p style="color:var(--txt-muted);font-size:12px;margin-bottom:10px;">
          <strong>Zusammenführen:</strong> Es werden nur Tage übernommen, an denen noch kein Eintrag im Tagebuch ist.<br>
          <strong>Ersetzen:</strong> Alle bestehenden Tagebuch-Einträge werden gelöscht und durch die TXT-Daten ersetzt.
        </p>
      </div>

      <button class="btn" onclick="UI.confirmImport('merge')">Zusammenführen (empfohlen)</button>
      <button class="btn-ghost danger" onclick="UI.confirmImport('replace')">Komplett ersetzen</button>
      <button class="btn-ghost" onclick="UI.closeModal()">Abbrechen</button>
    `;

    // Records temporär zwischenspeichern für confirmImport
    UI._pendingImport = records;
    Utils.$('#modal-backdrop').classList.add('active');
  },

  confirmImport(mode) {
    const records = UI._pendingImport;
    if (!records || !records.length) { UI.closeModal(); return; }

    if (mode === 'replace') {
      const existing = Storage.loadAll(CFG.STORE.DIARY).length;
      if (existing > 0) {
        const ok = confirm(`Wirklich alle ${existing} bestehenden Einträge löschen und durch ${records.length} importierte ersetzen?`);
        if (!ok) return;
      }
    }

    try {
      const res = Diary.importTxt(records, mode);
      UI.closeModal();
      Utils.$('#modal-body').innerHTML = `
        <h2 style="color:var(--success);margin-bottom:10px;">✓ Import erfolgreich</h2>
        <div class="card">
          <div class="row"><span class="k">Übernommen</span><span class="v" style="color:var(--success)">${res.added}</span></div>
          ${res.skipped ? `<div class="row"><span class="k">Übersprungen (schon vorhanden)</span><span class="v">${res.skipped}</span></div>` : ''}
          ${res.removed ? `<div class="row"><span class="k">Vorher gelöscht</span><span class="v" style="color:var(--danger)">${res.removed}</span></div>` : ''}
        </div>
        <button class="btn" onclick="UI.closeModal(); UI.renderStats(); UI.renderDashboard();">OK</button>
      `;
      Utils.$('#modal-backdrop').classList.add('active');
      UI._pendingImport = null;
    } catch (err) {
      alert('Import-Fehler: ' + (err.message || err));
      Utils.log('Import-Fehler:', err);
    }
  },

  escape(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  },

  closeModal() {
    Utils.$('#modal-backdrop').classList.remove('active');
  },
};

/* ============================================================================
   INIT
   ============================================================================ */
document.addEventListener('DOMContentLoaded', () => {
  Speech.init();
  UI.init();
  Utils.log(`VITAL ${CFG.APP_VERSION} bereit`);
});

window.UI = UI;
window.TiltTest = TiltTest;
window.MorningRoutine = MorningRoutine;
window.EveningBP = EveningBP;
window.Diary = Diary;
