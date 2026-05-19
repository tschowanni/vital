/* ============================================================================
   VITAL · CORE · Config, State, Utils, Storage, Bluetooth, Speech, Audio
   ============================================================================ */

'use strict';

/* ----- CONFIG ------------------------------------------------------------- */
const CFG = Object.freeze({
  APP_VERSION: '2.0',

  // Tilt-Test
  TILT_LYING_DURATION:    10 * 60,
  TILT_BASELINE_WINDOW:    2 * 60,
  TILT_STANDING_DURATION: 10 * 60,
  TILT_MEASUREMENTS_AT:  [60, 180, 300, 600],
  TILT_MEASUREMENT_KEYS: ['min1', 'min3', 'min5', 'min10'],
  TILT_MEASUREMENT_LBL:  ['Nach 1 Min', 'Nach 3 Min', 'Nach 5 Min', 'Nach 10 Min'],
  TILT_MEASURE_WINDOW:   10,
  POTS_THRESHOLD:        30,
  BORDERLINE_THRESHOLD:  25,

  // Morgen-Routine
  MORNING_HRV_DURATION:    5 * 60,   // 5 Min HRV-Messung im Liegen
  MORNING_ORTHO_AT:       [60, 180, 300], // 1, 3, 5 Min Stehen (kürzer als Tilt)

  // Storage-Keys
  STORE: {
    TILT:    'vital.tilt.v1',
    MORNING: 'vital.morning.v1',
    EVENING: 'vital.evening.v1',
    DIARY:   'vital.diary.v1',
    SETTINGS:'vital.settings.v1',
  },
  STORAGE_VERSION: 1,
  MAX_HISTORY: 10000,     // erlaubt mehrjährige Tagebuch-Historie + alle anderen Module

  // Test-Intervalle (Tage) — für Dashboard "fällig"-Anzeige
  INTERVAL: {
    TILT:    7,   // wöchentlich
    MORNING: 1,   // täglich
    EVENING: 1,   // täglich
    DIARY:   1,   // täglich
  },

  // Bluetooth
  HR_SERVICE_UUID:   'heart_rate',
  HR_CHARACTERISTIC: 'heart_rate_measurement',

  // Voice
  PREFERRED_LANGS: ['de-CH', 'de-DE', 'de-AT', 'de'],
  SPEECH_RATE: 1.0,
  SPEECH_PITCH: 1.0,
});

/* ----- STATE -------------------------------------------------------------- */
const State = {
  currentScreen: 'dashboard',
  screenStack:   [],       // für Back-Navigation

  // Bluetooth
  device: null,
  server: null,
  characteristic: null,
  btStatus: 'disconnected',

  // Live-HR
  currentHR: null,
  hrSamples: [],
  rrSamples: [],  // RR-Intervalle für HRV

  // Aktiver Test (generisch)
  activeTest: null,   // { kind: 'tilt'|'morning', data: {...}, ... }
  phaseStartedAt: null,
  phaseTimer: null,

  // Speech & WakeLock
  voice: null,
  voicesReady: false,
  wakeLock: null,
};

/* ----- UTILS -------------------------------------------------------------- */
const Utils = {
  fmtMMSS(ms) {
    if (ms == null || ms < 0) ms = 0;
    const t = Math.ceil(ms / 1000);
    return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
  },
  fmtDate(d) {
    const dt = (d instanceof Date) ? d : new Date(d);
    return `${dt.getFullYear()}.${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}`;
  },
  fmtTime(d) {
    const dt = (d instanceof Date) ? d : new Date(d);
    return `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
  },
  fmtDateLong(d) {
    const dt = (d instanceof Date) ? d : new Date(d);
    const months = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
    return `${dt.getDate()}. ${months[dt.getMonth()]} ${dt.getFullYear()}`;
  },
  fmtDayName(d) {
    const dt = (d instanceof Date) ? d : new Date(d);
    return ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'][dt.getDay()];
  },
  uid() { return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2,5); },
  daysBetween(d1, d2) {
    const a = (d1 instanceof Date) ? d1 : new Date(d1);
    const b = (d2 instanceof Date) ? d2 : new Date(d2);
    return Math.floor((b.setHours(0,0,0,0) - a.setHours(0,0,0,0)) / 86400000);
  },
  isSameDay(d1, d2) {
    const a = (d1 instanceof Date) ? d1 : new Date(d1);
    const b = (d2 instanceof Date) ? d2 : new Date(d2);
    return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
  },
  meanHR(samples, fromTs, toTs) {
    const inR = samples.filter(s => s.ts >= fromTs && s.ts <= toTs);
    if (!inR.length) return null;
    return Math.round(inR.reduce((a,b) => a + b.hr, 0) / inR.length);
  },
  meanRecentHR(samples, seconds) {
    return Utils.meanHR(samples, Date.now() - seconds*1000, Date.now());
  },
  /** RMSSD (Root Mean Square of Successive Differences) in ms */
  rmssd(rrSamples) {
    if (rrSamples.length < 2) return null;
    let sumSq = 0, n = 0;
    for (let i = 1; i < rrSamples.length; i++) {
      const diff = rrSamples[i].rr - rrSamples[i-1].rr;
      sumSq += diff * diff;
      n++;
    }
    return Math.round(Math.sqrt(sumSq / n));
  },
  /** SDNN (Standard Deviation of NN-Intervals) in ms */
  sdnn(rrSamples) {
    if (rrSamples.length < 2) return null;
    const rrs = rrSamples.map(s => s.rr);
    const mean = rrs.reduce((a,b) => a+b, 0) / rrs.length;
    const variance = rrs.reduce((a,b) => a + (b-mean)*(b-mean), 0) / rrs.length;
    return Math.round(Math.sqrt(variance));
  },
  classify(delta) {
    if (delta == null) return { status: 'unknown', label: 'Unbestimmt', cls: '' };
    if (delta >= CFG.POTS_THRESHOLD)        return { status: 'pos',        label: 'POTS-positiv',  cls: 'pos' };
    if (delta >= CFG.BORDERLINE_THRESHOLD)  return { status: 'borderline', label: 'Grenzwertig',   cls: 'borderline' };
    return { status: 'neg', label: 'Unauffällig', cls: 'neg' };
  },
  /** Statistik-Berechnung über Wertelisten */
  stats(values) {
    if (!values || !values.length) return null;
    const sorted = [...values].sort((a,b) => a - b);
    const sum = sorted.reduce((a,b) => a+b, 0);
    return {
      count: sorted.length,
      mean:  sum / sorted.length,
      min:   sorted[0],
      max:   sorted[sorted.length - 1],
      median: sorted[Math.floor(sorted.length / 2)],
    };
  },
  log(...args) { console.log(`[${new Date().toISOString().substr(11,8)}]`, ...args); },
  $(s)  { return document.querySelector(s); },
  $$(s) { return document.querySelectorAll(s); },
};

/* ============================================================================
   STORAGE · pro Modul eigene LocalStorage-Tabelle
   ============================================================================ */
const Storage = {
  /** Lade alle Records einer Tabelle */
  loadAll(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data.records) ? data.records : [];
    } catch (err) { Utils.log('Storage-Lese-Fehler:', key, err); return []; }
  },

  saveAll(key, records) {
    try {
      const data = { version: CFG.STORAGE_VERSION, records: records.slice(0, CFG.MAX_HISTORY) };
      localStorage.setItem(key, JSON.stringify(data));
    } catch (err) { Utils.log('Storage-Schreib-Fehler:', key, err); }
  },

  add(key, record) {
    const arr = Storage.loadAll(key);
    arr.unshift(record);
    Storage.saveAll(key, arr);
  },

  /** Records des letzten N Tage zurückgeben */
  recent(key, days = 30) {
    const cutoff = Date.now() - days * 86400000;
    return Storage.loadAll(key).filter(r => new Date(r.ts || r.startedAt).getTime() >= cutoff);
  },

  /** Letzten Record (neuester) */
  latest(key) {
    const arr = Storage.loadAll(key);
    return arr.length > 0 ? arr[0] : null;
  },

  /** Heute-Records einer Tabelle */
  today(key) {
    return Storage.loadAll(key).filter(r => {
      const ts = r.ts || r.startedAt;
      return ts && Utils.isSameDay(new Date(ts), new Date());
    });
  },

  clear(key) { localStorage.removeItem(key); },

  /** Alle Daten als JSON exportieren */
  exportAll() {
    const dump = {};
    Object.values(CFG.STORE).forEach(key => {
      dump[key] = Storage.loadAll(key);
    });
    return dump;
  },

  /** Daten aus JSON importieren (mit Replace) */
  importAll(dump) {
    Object.entries(dump).forEach(([key, records]) => {
      if (Array.isArray(records)) Storage.saveAll(key, records);
    });
  },
};

/* ============================================================================
   BLUETOOTH · Polar H10
   ============================================================================ */
const BT = {
  isSupported() { return 'bluetooth' in navigator; },

  async connect() {
    if (!BT.isSupported()) throw new Error('Web Bluetooth nicht verfügbar. Bitte Chrome/Edge verwenden.');
    Utils.log('BT: Pairing ...');
    UI.setBT('connecting', 'Suchen ...');
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [CFG.HR_SERVICE_UUID] }],
        optionalServices: ['battery_service'],
      });
      State.device = device;
      device.addEventListener('gattserverdisconnected', BT.onDisconnect);
      State.server = await device.gatt.connect();
      const service = await State.server.getPrimaryService(CFG.HR_SERVICE_UUID);
      State.characteristic = await service.getCharacteristic(CFG.HR_CHARACTERISTIC);
      State.characteristic.addEventListener('characteristicvaluechanged', BT.onHR);
      await State.characteristic.startNotifications();
      State.btStatus = 'connected';
      UI.setBT('connected', device.name || 'Polar H10');
      Utils.log('BT: ✓');
      return true;
    } catch (err) {
      Utils.log('BT-Fehler:', err);
      State.btStatus = 'error';
      UI.setBT('error', 'Fehler');
      throw err;
    }
  },

  onHR(event) {
    try {
      const value = event.target.value;
      if (!value || value.byteLength < 2) return;
      const flags = value.getUint8(0);
      const is16bit = (flags & 0x01) === 1;
      const sensorContact = (flags >> 1) & 0x03;
      const energyExpended = (flags >> 3) & 0x01;
      const rrPresent = (flags >> 4) & 0x01;

      let offset = is16bit ? 3 : 2;
      const hr = is16bit ? value.getUint16(1, true) : value.getUint8(1);
      if (hr <= 0 || hr > 250) return;

      State.currentHR = hr;
      State.hrSamples.push({ ts: Date.now(), hr });
      if (State.hrSamples.length > 5000) State.hrSamples = State.hrSamples.slice(-3000);

      // Energy (skip falls vorhanden)
      if (energyExpended) offset += 2;

      // RR-Intervalle (für HRV) — Einheit: 1/1024 Sekunden → in ms umrechnen
      if (rrPresent) {
        while (offset + 1 < value.byteLength) {
          const rrRaw = value.getUint16(offset, true);
          const rrMs = Math.round((rrRaw / 1024) * 1000);
          if (rrMs > 200 && rrMs < 2500) {  // physiologisch plausibel
            State.rrSamples.push({ ts: Date.now(), rr: rrMs });
          }
          offset += 2;
        }
        if (State.rrSamples.length > 5000) State.rrSamples = State.rrSamples.slice(-3000);
      }

      UI.updateLiveHR(hr);
    } catch (err) { Utils.log('HR-Parse-Fehler:', err); }
  },

  onDisconnect() {
    Utils.log('BT: getrennt');
    State.btStatus = 'disconnected';
    State.characteristic = null;
    State.server = null;
    UI.setBT('disconnected', 'Getrennt');
  },

  async disconnect() {
    try {
      if (State.characteristic) await State.characteristic.stopNotifications().catch(() => {});
      if (State.server && State.server.connected) State.server.disconnect();
    } catch (err) { Utils.log('Disconnect-Fehler:', err); }
  },
};

/* ============================================================================
   SPEECH · Sprachausgabe Deutsch
   ============================================================================ */
const Speech = {
  init() {
    if (!('speechSynthesis' in window)) return;
    Speech.pickVoice();
    speechSynthesis.addEventListener('voiceschanged', Speech.pickVoice);
  },
  pickVoice() {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;
    State.voicesReady = true;
    for (const lang of CFG.PREFERRED_LANGS) {
      const v = voices.find(v => v.lang === lang) || voices.find(v => v.lang.startsWith(lang.split('-')[0]));
      if (v) { State.voice = v; Utils.log('Speech:', v.name, v.lang); return; }
    }
    State.voice = voices[0];
  },
  warmup() {
    if (!('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      speechSynthesis.speak(u);
    } catch (err) { Utils.log('Warmup:', err); }
  },
  speak(text) {
    Utils.log('Speech:', text);
    if (!('speechSynthesis' in window)) { Audio.beep(); return; }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (State.voice) u.voice = State.voice;
      u.lang = State.voice ? State.voice.lang : 'de-DE';
      u.rate = CFG.SPEECH_RATE; u.pitch = CFG.SPEECH_PITCH; u.volume = 1;
      speechSynthesis.speak(u);
      Audio.beep(true);
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    } catch (err) { Utils.log('Speech-Fehler:', err); Audio.beep(); }
  },
};

/* ============================================================================
   AUDIO · Beep-Fallback
   ============================================================================ */
const Audio = {
  ctx: null,
  ensureCtx() {
    if (!Audio.ctx) {
      try { Audio.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (err) { Utils.log('AudioContext:', err); }
    }
    if (Audio.ctx && Audio.ctx.state === 'suspended') Audio.ctx.resume().catch(() => {});
  },
  beep(quiet = false) {
    Audio.ensureCtx();
    if (!Audio.ctx) return;
    try {
      const osc = Audio.ctx.createOscillator();
      const gain = Audio.ctx.createGain();
      osc.connect(gain); gain.connect(Audio.ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = quiet ? 880 : 800;
      const now = Audio.ctx.currentTime;
      const dur = quiet ? 0.15 : 0.35;
      const vol = quiet ? 0.12 : 0.4;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(vol, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.start(now); osc.stop(now + dur);
    } catch (err) { Utils.log('Beep:', err); }
  },
  beepDouble() { Audio.beep(); setTimeout(() => Audio.beep(), 200); },
};

/* ============================================================================
   WAKELOCK
   ============================================================================ */
const WakeLock = {
  async acquire() {
    if (!('wakeLock' in navigator)) return;
    try {
      State.wakeLock = await navigator.wakeLock.request('screen');
      Utils.log('WakeLock: aktiv');
      document.addEventListener('visibilitychange', WakeLock.reacquireIfNeeded);
    } catch (err) { Utils.log('WakeLock:', err); }
  },
  reacquireIfNeeded() {
    if (document.visibilityState === 'visible' && State.wakeLock === null) WakeLock.acquire();
  },
  async release() {
    if (State.wakeLock) {
      try { await State.wakeLock.release(); } catch (err) { Utils.log('WL-Release:', err); }
      State.wakeLock = null;
    }
  },
};
