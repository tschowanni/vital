/* ============================================================================
   VITAL · TESTS · TiltTest, MorningRoutine, EveningBP, Diary
   ============================================================================ */

'use strict';

/* ============================================================================
   BPReceiver · empfängt Messungen vom Beurer BM64 und routet sie ans richtige Modul
   ============================================================================ */
const BPReceiver = {

  /** Entscheidet basierend auf Uhrzeit der Messung, in welchen Slot gespeichert wird:
   *  - Vor 14:00 → Morgen-Routine
   *  - Ab 14:00  → Abend-BD
   *
   *  Wenn aktuell eine Morgen-Routine läuft (State.activeTest.kind === 'morning'),
   *  geht die Messung dort hinein (BD-liegend ODER Orthostat-Slot, je nach Phase).
   */
  saveMeasurement(measurement) {
    const ts = new Date(measurement.timestamp);
    const hour = ts.getHours();
    Utils.log(`BPReceiver: Messung ${measurement.sys}/${measurement.dia} @ ${Utils.fmtTime(ts)}`);

    // CASE 1 — Aktive Morgen-Routine läuft → in laufenden Workflow integrieren
    if (State.activeTest && State.activeTest.kind === 'morning') {
      BPReceiver.feedActiveMorning(measurement);
      return;
    }

    // CASE 2 — Auto-Slot basierend auf Tageszeit
    if (hour < CFG.BP_AUTO_DECISION_HOUR) {
      BPReceiver.saveAsMorning(measurement);
    } else {
      BPReceiver.saveAsEvening(measurement);
    }
  },

  /** Während einer aktiven Morgen-Routine: BD-Werte ins richtige Slot füllen */
  feedActiveMorning(measurement) {
    const a = State.activeTest;
    // Phase 1 — BD liegend noch nicht erfasst
    if (a.bpLying === null) {
      a.bpLying = { sys: measurement.sys, dia: measurement.dia, hr: measurement.hr };
      UI.onMorningBPAutoFilled(measurement);
      return;
    }
    // Phase 3 — Orthostat-Test läuft, slot suchen
    if (a.orthostatic) {
      for (const key of ['min1', 'min3', 'min5']) {
        if (a.orthostatic[key] === 'waiting') {
          a.orthostatic[key] = { sys: measurement.sys, dia: measurement.dia, hr: measurement.hr };
          UI.updateOrthoRow(key, measurement.sys, measurement.dia, measurement.hr);
          // Wenn das die letzte Messung war → finalisieren
          if (key === 'min5') {
            setTimeout(() => MorningRoutine.finish(), 800);
          }
          return;
        }
      }
    }
    // Fallback: keine offene Phase — als zusätzlicher Eintrag speichern
    BPReceiver.saveAsEvening(measurement);
  },

  /** Als Morgen-Routine speichern (nur BD, ohne HRV/Orthostat) */
  saveAsMorning(measurement) {
    // Prüfen ob heute schon eine Morgen-Routine erfasst wurde
    const todays = Storage.today(CFG.STORE.MORNING);
    if (todays.length > 0) {
      // Heute schon ein Eintrag — neue Messung in den vorhandenen Eintrag mergen oder als Abend speichern
      Utils.log('Morgen heute schon erfasst, speichere als Abend-BD');
      BPReceiver.saveAsEvening(measurement);
      return;
    }
    const record = {
      kind: 'morning',
      id: Utils.uid(),
      ts: measurement.timestamp,
      bpLying: { sys: measurement.sys, dia: measurement.dia, hr: measurement.hr },
      hrv: null,
      orthostatic: null,
      _source: 'BM64',
    };
    Storage.add(CFG.STORE.MORNING, record);
    UI.onBPAutoSaved('morning', record);
  },

  /** Als Abend-BD speichern */
  saveAsEvening(measurement) {
    const record = {
      id: Utils.uid(),
      ts: measurement.timestamp,
      sys: measurement.sys,
      dia: measurement.dia,
      hr:  measurement.hr,
      _source: 'BM64',
    };
    Storage.add(CFG.STORE.EVENING, record);
    UI.onBPAutoSaved('evening', record);
  },
};


const TiltTest = {
  async start() {
    Utils.log('Tilt: Start');
    Speech.warmup();
    Audio.ensureCtx();
    await WakeLock.acquire();

    State.hrSamples = [];
    State.rrSamples = [];
    State.activeTest = {
      kind: 'tilt',
      id: Utils.uid(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      baselineHR: null,
      standingStartedAt: null,
      measurements: { min1: null, min3: null, min5: null, min10: null },
    };

    TiltTest.startLyingPhase();
  },

  startLyingPhase() {
    UI.showScreen('tilt-lying');
    State.phaseStartedAt = Date.now();
    Speech.speak('Tilt-Test gestartet. Bitte ruhig auf den Rücken legen und normal atmen. Die Liegephase dauert zehn Minuten.');
    TiltTest.clearTimer();
    State.phaseTimer = setInterval(TiltTest.tickLying, 250);
  },

  tickLying() {
    const elapsed = (Date.now() - State.phaseStartedAt) / 1000;
    const remaining = CFG.TILT_LYING_DURATION - elapsed;
    const progress = Math.min(100, (elapsed / CFG.TILT_LYING_DURATION) * 100);
    UI.updateLyingProgress(remaining * 1000, progress);

    if (remaining <= CFG.TILT_BASELINE_WINDOW && remaining > CFG.TILT_BASELINE_WINDOW - 1) {
      Speech.speak('Letzte zwei Minuten. Der Ruhepuls wird jetzt gemessen.');
      UI.showBaselineCard();
    }
    if (remaining <= CFG.TILT_BASELINE_WINDOW) {
      const mean = Utils.meanHR(
        State.hrSamples,
        State.phaseStartedAt + (CFG.TILT_LYING_DURATION - CFG.TILT_BASELINE_WINDOW) * 1000,
        Date.now()
      );
      UI.updateBaselineCurrent(mean);
    }
    if (remaining <= 0) {
      TiltTest.clearTimer();
      TiltTest.finishLyingPhase();
    }
  },

  finishLyingPhase() {
    const fromTs = State.phaseStartedAt + (CFG.TILT_LYING_DURATION - CFG.TILT_BASELINE_WINDOW) * 1000;
    const toTs   = State.phaseStartedAt + CFG.TILT_LYING_DURATION * 1000;
    const baseline = Utils.meanHR(State.hrSamples, fromTs, toTs)
                   || Utils.meanRecentHR(State.hrSamples, 30)
                   || State.currentHR;
    State.activeTest.baselineHR = baseline;
    Speech.speak('Liegephase beendet. Bitte langsam aufstehen und still stehen bleiben. Tippe auf "Ich stehe jetzt", sobald du stehst.');
    UI.showStandupScreen(baseline);
  },

  startStandingPhase() {
    Utils.log('Tilt: Stehphase');
    State.activeTest.standingStartedAt = Date.now();
    State.phaseStartedAt = Date.now();
    UI.showScreen('tilt-standing');
    UI.resetMeasurementUI();
    Speech.speak('Stehphase gestartet. Bitte ruhig stehen bleiben.');
    TiltTest.clearTimer();
    State.phaseTimer = setInterval(TiltTest.tickStanding, 250);
  },

  tickStanding() {
    const elapsed = (Date.now() - State.phaseStartedAt) / 1000;
    const remaining = CFG.TILT_STANDING_DURATION - elapsed;
    const progress = Math.min(100, (elapsed / CFG.TILT_STANDING_DURATION) * 100);
    const delta = (State.currentHR != null && State.activeTest.baselineHR != null)
      ? State.currentHR - State.activeTest.baselineHR : null;
    UI.updateStandingProgress(remaining * 1000, progress, delta);

    for (let i = 0; i < CFG.TILT_MEASUREMENTS_AT.length; i++) {
      const t = CFG.TILT_MEASUREMENTS_AT[i];
      const key = CFG.TILT_MEASUREMENT_KEYS[i];
      if (elapsed >= t - 15 && elapsed < t && State.activeTest.measurements[key] == null) {
        UI.markMeasurementActive(key);
      }
      if (elapsed >= t && State.activeTest.measurements[key] == null) {
        const measured = Utils.meanHR(
          State.hrSamples,
          State.phaseStartedAt + (t - CFG.TILT_MEASURE_WINDOW) * 1000,
          State.phaseStartedAt + t * 1000
        ) || State.currentHR;
        State.activeTest.measurements[key] = measured;
        const d = measured != null && State.activeTest.baselineHR != null
          ? measured - State.activeTest.baselineHR : null;
        UI.markMeasurementDone(key, measured, d);
        Speech.speak(`${CFG.TILT_MEASUREMENT_LBL[i]}. Puls ${measured}. ${d != null ? (d > 0 ? 'Plus ' : '') + d : ''}.`);
        Audio.beepDouble();
      }
    }
    if (remaining <= 0) {
      TiltTest.clearTimer();
      TiltTest.finish();
    }
  },

  finish() {
    State.activeTest.finishedAt = new Date().toISOString();
    const m = State.activeTest.measurements;
    const vals = Object.values(m).filter(v => v != null);
    const maxStanding = vals.length ? Math.max(...vals) : null;
    const delta = (maxStanding != null && State.activeTest.baselineHR != null)
      ? maxStanding - State.activeTest.baselineHR : null;
    const v = Utils.classify(delta);

    const record = {
      ...State.activeTest,
      maxStandingHR: maxStanding,
      delta, verdict: v.status, verdictLabel: v.label,
    };
    Storage.add(CFG.STORE.TILT, record);
    WakeLock.release();
    Speech.speak(`Test abgeschlossen. Anstieg ${delta} bpm. Ergebnis: ${v.label}.`);
    UI.showTiltResult(record);
  },

  abort() {
    if (!confirm('Test wirklich abbrechen? Daten gehen verloren.')) return;
    TiltTest.clearTimer();
    WakeLock.release();
    speechSynthesis.cancel();
    UI.showScreen('dashboard');
  },

  clearTimer() {
    if (State.phaseTimer) { clearInterval(State.phaseTimer); State.phaseTimer = null; }
  },
};

/* ============================================================================
   MORGEN-ROUTINE · BD liegend + HRV + optional Orthostat-BD
   ============================================================================ */
const MorningRoutine = {

  /** Workflow:
   *   1) BD-Eingabe liegend (manuell)
   *   2) Optional: 5 Min HRV-Messung im Liegen (Polar)
   *   3) Optional: Orthostat-BD nach 1/3/5 Min Stehen
   */
  start() {
    Utils.log('Morgen: Start');
    State.activeTest = {
      kind: 'morning',
      id: Utils.uid(),
      ts: new Date().toISOString(),
      bpLying: null,        // { sys, dia, hr }
      hrv: null,            // { rmssd, sdnn, hrMean }
      orthostatic: null,    // { min1: {sys,dia,hr}, min3:..., min5:... }
    };
    UI.showScreen('morning-bp');
  },

  /** Schritt 1 abgeschlossen: BD liegend eingegeben */
  submitBPLying(sys, dia, hr) {
    if (!sys || !dia) { alert('Bitte SYS und DIA ausfüllen.'); return; }
    State.activeTest.bpLying = { sys, dia, hr: hr || null };
    UI.showScreen('morning-choice');
  },

  /** Schritt 2a: HRV-Messung starten */
  async startHRV() {
    if (State.btStatus !== 'connected') {
      const ok = confirm('Polar H10 nicht verbunden. Jetzt verbinden?');
      if (!ok) return;
      try { await BT.connect(); } catch (e) { alert('BT-Fehler: ' + (e.message || e)); return; }
    }
    State.hrSamples = [];
    State.rrSamples = [];
    State.phaseStartedAt = Date.now();
    await WakeLock.acquire();
    UI.showScreen('morning-hrv');
    Speech.warmup();
    Speech.speak('HRV-Messung gestartet. Bitte ruhig liegen, normal atmen. Fünf Minuten.');
    MorningRoutine.clearTimer();
    State.phaseTimer = setInterval(MorningRoutine.tickHRV, 250);
  },

  tickHRV() {
    const elapsed = (Date.now() - State.phaseStartedAt) / 1000;
    const remaining = CFG.MORNING_HRV_DURATION - elapsed;
    const progress = Math.min(100, (elapsed / CFG.MORNING_HRV_DURATION) * 100);
    UI.updateHRVProgress(remaining * 1000, progress);

    // Live-HRV-Werte berechnen (für Anzeige)
    if (State.rrSamples.length >= 10) {
      const rmssd = Utils.rmssd(State.rrSamples);
      const sdnn = Utils.sdnn(State.rrSamples);
      UI.updateHRVLive(rmssd, sdnn);
    }
    if (remaining <= 0) {
      MorningRoutine.clearTimer();
      MorningRoutine.finishHRV();
    }
  },

  finishHRV() {
    const rmssd = Utils.rmssd(State.rrSamples);
    const sdnn  = Utils.sdnn(State.rrSamples);
    const hrMean = State.hrSamples.length
      ? Math.round(State.hrSamples.reduce((a,b) => a+b.hr, 0) / State.hrSamples.length)
      : null;
    State.activeTest.hrv = { rmssd, sdnn, hrMean, sampleCount: State.rrSamples.length };
    Speech.speak(`HRV-Messung abgeschlossen. RMSSD ${rmssd} Millisekunden.`);
    WakeLock.release();
    UI.showScreen('morning-orthochoice');
  },

  /** Schritt 3: Orthostat-BD-Test starten (1, 3, 5 Min) */
  startOrthostat() {
    State.activeTest.orthostatic = { min1: null, min3: null, min5: null };
    State.phaseStartedAt = Date.now();
    UI.showScreen('morning-ortho');
    Speech.warmup();
    Speech.speak('Bitte aufstehen und ruhig stehen bleiben. Nach einer Minute folgt die erste Messung.');
    MorningRoutine.clearTimer();
    State.phaseTimer = setInterval(MorningRoutine.tickOrtho, 1000);
  },

  tickOrtho() {
    const elapsed = (Date.now() - State.phaseStartedAt) / 1000;
    UI.updateOrthoCountdown(elapsed);

    const targets = [
      { sec: 60,  key: 'min1', label: 'Nach einer Minute' },
      { sec: 180, key: 'min3', label: 'Nach drei Minuten' },
      { sec: 300, key: 'min5', label: 'Nach fünf Minuten' },
    ];
    for (const t of targets) {
      if (elapsed >= t.sec && State.activeTest.orthostatic[t.key] === null) {
        // Markieren als "ready", damit User BD-Eingabe-Dialog öffnen kann
        State.activeTest.orthostatic[t.key] = 'waiting';
        Speech.speak(`${t.label}. Bitte Blutdruck messen.`);
        Audio.beepDouble();
        UI.promptOrthoBP(t.key, t.label);
      }
    }
    if (elapsed >= 310) {
      MorningRoutine.clearTimer();
    }
  },

  submitOrthoBP(key, sys, dia, hr) {
    if (!sys || !dia) return;
    State.activeTest.orthostatic[key] = { sys, dia, hr: hr || null };
    UI.updateOrthoRow(key, sys, dia, hr);
    if (key === 'min5') {
      MorningRoutine.clearTimer();
      setTimeout(() => MorningRoutine.finish(), 500);
    }
  },

  skipOrthostat() { MorningRoutine.finish(); }, // direkt finalisieren ohne Orthostat-Daten

  finish() {
    Utils.log('Morgen: Abschluss');
    WakeLock.release();
    speechSynthesis.cancel();
    Storage.add(CFG.STORE.MORNING, State.activeTest);
    Speech.speak('Morgen-Routine abgeschlossen.');
    UI.showMorningResult(State.activeTest);
  },

  abort() {
    if (!confirm('Morgen-Routine abbrechen? Daten gehen verloren.')) return;
    MorningRoutine.clearTimer();
    WakeLock.release();
    speechSynthesis.cancel();
    UI.showScreen('dashboard');
  },

  clearTimer() {
    if (State.phaseTimer) { clearInterval(State.phaseTimer); State.phaseTimer = null; }
  },
};

/* ============================================================================
   ABEND-BD · einfache Eingabe
   ============================================================================ */
const EveningBP = {
  start() {
    UI.showScreen('evening');
  },
  submit(sys, dia, hr) {
    if (!sys || !dia) { alert('Bitte SYS und DIA ausfüllen.'); return; }
    const record = {
      id: Utils.uid(),
      ts: new Date().toISOString(),
      sys, dia, hr: hr || null,
    };
    Storage.add(CFG.STORE.EVENING, record);
    UI.showScreen('dashboard');
    UI.renderDashboard();
  },
};

/* ============================================================================
   TAGEBUCH · Schwindel + Wohlfühl + Trigger + Schlaf + Notes
   ============================================================================ */
const Diary = {
  start() {
    UI.showScreen('diary');
    Diary.resetForm();
  },

  resetForm() {
    Utils.$('#diary-dizziness').value = 5;
    Utils.$('#diary-dizziness-val').textContent = '5';
    Utils.$('#diary-wellbeing').value = 5;
    Utils.$('#diary-wellbeing-val').textContent = '5';
    Utils.$('#diary-heat').checked = false;
    Utils.$('#diary-exertion').checked = false;
    Utils.$('#diary-poor-sleep').checked = false;
    Utils.$('#diary-sleep-hours').value = '';
    Utils.$('#diary-spo2-min').value = '';
    Utils.$('#diary-notes').value = '';
  },

  submit() {
    const record = {
      id: Utils.uid(),
      ts: new Date().toISOString(),
      dizziness:    Number(Utils.$('#diary-dizziness').value),
      wellbeing:    Number(Utils.$('#diary-wellbeing').value),
      heatTrigger:  Utils.$('#diary-heat').checked,
      exertion:     Utils.$('#diary-exertion').checked,
      poorSleep:    Utils.$('#diary-poor-sleep').checked,
      sleepHours:   parseFloat(Utils.$('#diary-sleep-hours').value) || null,
      spo2Min:      parseInt(Utils.$('#diary-spo2-min').value) || null,
      notes:        Utils.$('#diary-notes').value.trim() || null,
    };
    Storage.add(CFG.STORE.DIARY, record);
    UI.showScreen('dashboard');
    UI.renderDashboard();
  },

  /** Parser für das alte TXT-Format: "DD.MM.YYYY*Schwindel<Wohlfühl>"
   *  Liefert ein Array von Records (noch nicht in Storage geschrieben) +
   *  Statistik für die Vorschau.
   */
  parseTxt(text) {
    const lines = text.split(/\r?\n/);
    const pattern = /^(\d{2})\.(\d{2})\.(\d{4})\*(\d+)<(\d+)>$/;

    const records = [];
    const errors = [];
    const dayCount = new Map();   // Tage mit mehreren Einträgen tracken

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const m = pattern.exec(line);
      if (!m) { errors.push({ line: i + 1, text: line }); continue; }

      const day = parseInt(m[1], 10);
      const mon = parseInt(m[2], 10);
      const yr  = parseInt(m[3], 10);
      const dizz = parseInt(m[4], 10);
      const well = parseInt(m[5], 10);

      // Plausibilitäts-Prüfungen
      if (day < 1 || day > 31 || mon < 1 || mon > 12 || yr < 2000 || yr > 2100) {
        errors.push({ line: i + 1, text: line }); continue;
      }
      if (dizz < 0 || dizz > 10 || well < 0 || well > 10) {
        errors.push({ line: i + 1, text: line }); continue;
      }

      // Wenn schon ein Eintrag an diesem Tag: zweiter Eintrag bekommt 21:00,
      // ansonsten 09:00 als synthetischen Timestamp
      const dateKey = `${yr}-${mon}-${day}`;
      const seenBefore = dayCount.get(dateKey) || 0;
      dayCount.set(dateKey, seenBefore + 1);
      const hour = seenBefore === 0 ? 9 : 21;

      const dt = new Date(yr, mon - 1, day, hour, 0, 0);
      records.push({
        id: Utils.uid(),
        ts: dt.toISOString(),
        dizziness:    dizz,
        wellbeing:    well,
        heatTrigger:  false,
        exertion:     false,
        poorSleep:    false,
        sleepHours:   null,
        spo2Min:      null,
        notes:        null,
        _imported:    true,    // Marker, dass importiert (nicht in App eingegeben)
      });
    }

    // Nach Datum sortieren — neueste zuerst (passt zu Storage-Konvention)
    records.sort((a, b) => new Date(b.ts) - new Date(a.ts));

    // Statistik für Vorschau
    const dizzVals = records.map(r => r.dizziness);
    const wellVals = records.map(r => r.wellbeing);
    const dupDays = [...dayCount.values()].filter(v => v > 1).length;

    return {
      records,
      errors,
      stats: {
        count: records.length,
        from:  records.length ? records[records.length - 1].ts : null,
        to:    records.length ? records[0].ts : null,
        dizzMean: dizzVals.length ? dizzVals.reduce((a,b)=>a+b,0) / dizzVals.length : 0,
        wellMean: wellVals.length ? wellVals.reduce((a,b)=>a+b,0) / wellVals.length : 0,
        dupDays,
      },
    };
  },

  /** Import-Modus: 'replace' löscht alle bestehenden Diary-Daten,
   *                'merge' fügt nur Datensätze hinzu, deren Tag noch nicht im Storage ist.
   */
  importTxt(records, mode = 'merge') {
    const existing = Storage.loadAll(CFG.STORE.DIARY);

    if (mode === 'replace') {
      // Komplett ersetzen
      const all = [...records];
      all.sort((a, b) => new Date(b.ts) - new Date(a.ts));
      Storage.saveAll(CFG.STORE.DIARY, all);
      return { added: records.length, skipped: 0, removed: existing.length };
    }

    // Merge: Tage, an denen wir schon einen Eintrag haben, NICHT überschreiben
    const existingDays = new Set(
      existing.map(r => Utils.fmtDate(r.ts))
    );
    let added = 0, skipped = 0;
    const toAdd = [];
    for (const rec of records) {
      const dateKey = Utils.fmtDate(rec.ts);
      if (existingDays.has(dateKey)) { skipped++; continue; }
      toAdd.push(rec);
      added++;
    }
    const merged = [...existing, ...toAdd];
    merged.sort((a, b) => new Date(b.ts) - new Date(a.ts));
    Storage.saveAll(CFG.STORE.DIARY, merged);
    return { added, skipped, removed: 0 };
  },

  /** Statistik über alle Tagebuch-Einträge */
  computeStats() {
    const all = Storage.loadAll(CFG.STORE.DIARY);
    if (!all.length) return null;

    const dizz = all.map(r => r.dizziness).filter(v => v != null);
    const well = all.map(r => r.wellbeing).filter(v => v != null);
    const heatCount = all.filter(r => r.heatTrigger).length;
    const exertCount = all.filter(r => r.exertion).length;
    const poorSleep  = all.filter(r => r.poorSleep).length;

    // Verteilung 0-10
    const dizzDist = Array(11).fill(0);
    const wellDist = Array(11).fill(0);
    dizz.forEach(v => { if (v >= 0 && v <= 10) dizzDist[v]++; });
    well.forEach(v => { if (v >= 0 && v <= 10) wellDist[v]++; });

    return {
      count: all.length,
      from: all[all.length - 1]?.ts,
      to:   all[0]?.ts,
      dizziness: Utils.stats(dizz),
      wellbeing: Utils.stats(well),
      dizzDist, wellDist,
      heatCount, exertCount, poorSleep,
      heatPct:  Math.round(100 * heatCount  / all.length),
      exertPct: Math.round(100 * exertCount / all.length),
      sleepPct: Math.round(100 * poorSleep  / all.length),
    };
  },
};
