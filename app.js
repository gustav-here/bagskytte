'use strict';

/* ==========================================================================
   Bågskytte – träningsapp (PWA). Vanilla JS utan beroenden.
   Alla koordinater lagras i cm med tavlans centrum i (0, 0). y växer nedåt
   (samma riktning som i SVG).
   ========================================================================== */

// Zoomfönstrets sida som andel av tavlans diameter (1/2 → 30 cm, 1/4 av ytan).
const ZOOM_WINDOW_FRACTION = 1 / 2;
// Utsnittets bredd i zoomfönstret som andel av diametern (1/8 → 7,5 cm, alltså 4× förstoring).
const ZOOM_VIEW_FRACTION = 1 / 8;

const APP_VERSION = '1.2.0';
const TARGET_DIAMETER = 60;        // cm
const TARGET_RADIUS = 30;          // cm
const X_RADIUS = 1.5;              // cm
const RING_WIDTH = 3;              // cm
const SURFACE_HALF = 33;           // ytan (viewBox) går från −33 till 33 cm
const ZOOM_HYSTERESIS = 3;         // cm förbi mitten innan zoomfönstret byter hörn
const ARROWS_PER_END = 3;          // en rad
const ENDS_PER_SERIES = 10;
const ARROWS_PER_SERIES = ARROWS_PER_END * ENDS_PER_SERIES;
const MAX_SET_SIZE = 12;
const MAX_ARROW_NUMBER = 999;
const SCORE_EPS = 1e-9;
const DB_NAME = 'bagskytte';
const DB_VERSION = 1;
const BACKUP_FORMAT = 'bagskytte-backup';
const BACKUP_VERSION = 1;

const FRAME_COLOR = '#bdb6a4';
const ZOOM_OUTSIDE_COLOR = '#8f897a';
const MARKER_COLOR = '#39ff14';
const SERIES_COLORS = ['#39ff14', '#ff2bd6'];
const HIGHLIGHT_COLOR = '#ff6a00';
const ARROW_COLORS = [
  '#39ff14', '#ff2bd6', '#00e5ff', '#ff8c00', '#b388ff', '#ffffff',
  '#8b4513', '#7b1fa2', '#c6ff00', '#1de9b6', '#ffc0cb', '#607d8b'
];

/* ==========================================================================
   Poäng och beräkningar (rena funktioner)
   ========================================================================== */

// Poäng för avståndet d (cm) från centrum. En träff på en gräns ger den högre poängen.
function scoreForDistance(d) {
  if (d <= X_RADIUS + SCORE_EPS) return { score: 10, isX: true, isMiss: false };
  if (d > TARGET_RADIUS + SCORE_EPS) return { score: 0, isX: false, isMiss: true };
  return { score: 11 - Math.ceil((d - SCORE_EPS) / RING_WIDTH), isX: false, isMiss: false };
}

function scoreAt(x, y) {
  return scoreForDistance(Math.hypot(x, y));
}

function scoreLabel(a) {
  if (a.isX) return 'X';
  if (a.isMiss) return '–';
  return String(a.score);
}

function zoneOf(a) {
  if (a.isMiss) return 'miss';
  if (a.score >= 9) return 'gold';
  if (a.score >= 7) return 'red';
  if (a.score >= 5) return 'blue';
  if (a.score >= 3) return 'black';
  return 'white';
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round3 = (v) => Math.round(v * 1000) / 1000 + 0;

// En pil med koordinater låsta till ytan. Poängen räknas på de sparade (avrundade) koordinaterna.
function makeArrow(x, y) {
  const cx = round3(clamp(x, -SURFACE_HALF, SURFACE_HALF));
  const cy = round3(clamp(y, -SURFACE_HALF, SURFACE_HALF));
  return { x: cx, y: cy, ...scoreAt(cx, cy) };
}

const sumScores = (arrows) => arrows.reduce((t, a) => t + a.score, 0);

// Raderna i protokollet för en serie. previousTotal är föregående series summa (null i serie 1).
function seriesTable(arrows, previousTotal) {
  const rows = [];
  let cumulative = 0;
  for (let r = 0; r < ENDS_PER_SERIES; r++) {
    const cells = arrows.slice(r * ARROWS_PER_END, (r + 1) * ARROWS_PER_END);
    if (!cells.length) {
      rows.push({ cells, rowSum: null, seriesSum: null, total: null });
      continue;
    }
    const rowSum = sumScores(cells);
    cumulative += rowSum;
    rows.push({
      cells,
      rowSum,
      seriesSum: cumulative,
      total: previousTotal == null ? null : previousTotal + cumulative
    });
  }
  return rows;
}

function seriesScore(series) {
  return sumScores(series.arrows);
}

function shotStats(shots) {
  const count = shots.length;
  const sum = sumScores(shots);
  return {
    scores: shots.map(scoreLabel),
    count,
    sum,
    avg: count ? sum / count : null,
    tens: shots.filter((s) => s.score === 10).length, // X räknas som 10
    xs: shots.filter((s) => s.isX).length
  };
}

function roundSummary(round) {
  const all = round.series.flatMap((s) => s.arrows);
  const st = shotStats(all);
  return { score: st.sum, tens: st.tens, xs: st.xs, seriesScores: round.series.map(seriesScore) };
}

// Översikt över alla sparade tävlingsomgångar, äldst först.
function roundsOverview(rounds) {
  const list = [...rounds].sort((a, b) => a.createdAt - b.createdAt).map((r) => {
    const s = roundSummary(r);
    const arrows = r.series.reduce((t, x) => t + x.arrows.length, 0);
    return {
      id: r.id, name: r.name, createdAt: r.createdAt, series: r.series.length,
      score: s.score, arrows, avgArrow: arrows ? s.score / arrows : null, tens: s.tens, xs: s.xs
    };
  });
  const count = list.length;
  const totalScore = list.reduce((t, r) => t + r.score, 0);
  const totalArrows = list.reduce((t, r) => t + r.arrows, 0);
  return {
    rounds: list,
    count,
    totalScore,
    totalArrows,
    avgRound: count ? totalScore / count : null,
    avgArrow: totalArrows ? totalScore / totalArrows : null,
    best: count ? Math.max(...list.map((r) => r.score)) : null,
    tens: list.reduce((t, r) => t + r.tens, 0),
    xs: list.reduce((t, r) => t + r.xs, 0),
    mixedSeries: new Set(list.map((r) => r.series)).size > 1
  };
}

const byNumber = (a, b) => a.number - b.number || String(a.id).localeCompare(String(b.id));

// Index för nästa pil och varvnummer i en jämförelse med n pilar.
const nextArrowIndex = (shotCount, n) => shotCount % n;
const varvOf = (shotCount, n) => Math.floor(shotCount / n) + 1;

// Pilarna i en sparad jämförelse, sorterade på nummer.
function comparisonArrows(comparison, allArrows) {
  return comparison.arrowIds.map((id) => {
    const shot = comparison.shots.find((s) => s.arrowId === id);
    const known = allArrows.find((a) => a.id === id);
    return { id, number: shot ? shot.arrowNumber : known ? known.number : 0 };
  }).sort(byNumber);
}

function comparisonStats(comparison, allArrows) {
  return comparisonArrows(comparison, allArrows).map((a, i) => ({
    arrowId: a.id,
    number: a.number,
    color: arrowColor(i),
    ...shotStats(comparison.shots.filter((s) => s.arrowId === a.id))
  }));
}

// Alla skott med en viss pil över samtliga jämförelser, äldst först.
function arrowShotsAcross(arrowId, comparisons) {
  return [...comparisons]
    .sort((a, b) => a.createdAt - b.createdAt)
    .flatMap((c) => c.shots.filter((s) => s.arrowId === arrowId));
}

function arrowColor(i) {
  return ARROW_COLORS[i % ARROW_COLORS.length];
}

function textColorFor(hex) {
  const v = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
  return lum > 0.55 ? '#000' : '#fff';
}

function parseSetNumbers(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_SET_SIZE) {
    return { error: `Ett set ska ha 1–${MAX_SET_SIZE} pilar.` };
  }
  const numbers = [];
  for (let i = 0; i < values.length; i++) {
    const raw = String(values[i] == null ? '' : values[i]).trim();
    if (raw === '') return { error: `Ange ett nummer för pil ${i + 1}.` };
    const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
    if (!(n >= 1 && n <= MAX_ARROW_NUMBER)) {
      return { error: `”${raw}” är inget giltigt pilnummer. Använd heltal 1–${MAX_ARROW_NUMBER}.` };
    }
    if (numbers.includes(n)) return { error: `Pil ${n} finns redan i setet. Ett nummer får bara finnas en gång.` };
    numbers.push(n);
  }
  return { numbers };
}

function validateBackup(obj) {
  if (!obj || typeof obj !== 'object') return 'Filen är ingen giltig backup.';
  if (obj.format !== BACKUP_FORMAT) return 'Filen är ingen backup från Bågskytte.';
  const d = obj.data;
  if (!d || typeof d !== 'object') return 'Backupen saknar data.';
  for (const k of ['rounds', 'arrows', 'sets', 'comparisons']) {
    if (!Array.isArray(d[k])) return `Backupen saknar listan ”${k}”.`;
  }
  const isArrow = (a) => a && Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.score);
  if (!d.rounds.every((r) => r && typeof r.id === 'string' && Array.isArray(r.series) &&
    r.series.every((s) => s && Array.isArray(s.arrows) && s.arrows.every(isArrow)))) {
    return 'Backupen innehåller en felaktig tävlingsomgång.';
  }
  if (!d.arrows.every((a) => a && typeof a.id === 'string' && Number.isFinite(a.number))) {
    return 'Backupen innehåller en felaktig pil.';
  }
  if (!d.sets.every((s) => s && typeof s.id === 'string' && Array.isArray(s.arrowIds))) {
    return 'Backupen innehåller ett felaktigt set.';
  }
  if (!d.comparisons.every((c) => c && typeof c.id === 'string' && Array.isArray(c.arrowIds) &&
    Array.isArray(c.shots) && c.shots.every(isArrow))) {
    return 'Backupen innehåller en felaktig jämförelse.';
  }
  return null;
}

function uid() {
  if (self.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const fmtDate = (ts) => new Date(ts).toLocaleDateString('sv-SE');
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
const fmtDateTime = (ts) => `${fmtDate(ts)} ${fmtTime(ts)}`;
const fmtAvg = (v) => (v == null ? '–' : v.toFixed(2).replace('.', ','));
const fmtNum = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ','));
const defaultRoundName = (ts) => `Omgång ${fmtDate(ts)}`;

/* ==========================================================================
   IndexedDB – liten egen wrapper
   ========================================================================== */

const DB = (() => {
  const STORES = ['rounds', 'arrows', 'sets', 'comparisons'];
  let name = DB_NAME;
  let dbp = null;

  function open() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(name, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const s of STORES) {
            if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => { db.close(); dbp = null; };
          resolve(db);
        };
        req.onerror = () => { dbp = null; reject(req.error); };
      });
    }
    return dbp;
  }

  async function run(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let result;
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transaktionen avbröts.'));
      fn(t, (v) => { result = v; });
    });
  }

  return {
    STORES,
    configure(dbName) { name = dbName; dbp = null; },
    getAll(store) {
      return run([store], 'readonly', (t, set) => {
        const r = t.objectStore(store).getAll();
        r.onsuccess = () => set(r.result);
      });
    },
    get(store, key) {
      return run([store], 'readonly', (t, set) => {
        const r = t.objectStore(store).get(key);
        r.onsuccess = () => set(r.result);
      });
    },
    // ops: [['put', store, value] | ['del', store, key]] – skrivs i en och samma transaktion.
    write(ops) {
      const stores = [...new Set(ops.map((o) => o[1]))];
      if (!stores.length) return Promise.resolve();
      return run(stores, 'readwrite', (t) => {
        for (const [op, store, v] of ops) {
          if (op === 'put') t.objectStore(store).put(v);
          else t.objectStore(store).delete(v);
        }
      });
    },
    replaceAll(data) {
      return run([...STORES, 'meta'], 'readwrite', (t) => {
        for (const s of STORES) {
          const os = t.objectStore(s);
          os.clear();
          for (const item of data[s]) os.put(item);
        }
        const meta = t.objectStore('meta');
        meta.clear();
        if (data.activeSession) meta.put({ key: 'activeSession', value: data.activeSession });
      });
    },
    async close() {
      if (!dbp) return;
      const p = dbp;
      dbp = null;
      try { (await p).close(); } catch (e) { /* redan stängd */ }
    },
    async destroy() {
      await this.close();
      await new Promise((resolve) => {
        const r = indexedDB.deleteDatabase(name);
        r.onsuccess = r.onerror = r.onblocked = () => resolve();
      });
    }
  };
})();

/* ==========================================================================
   Store – appens data i minnet, speglad till IndexedDB vid varje ändring
   ========================================================================== */

const sessionOp = (s) => (s ? ['put', 'meta', { key: 'activeSession', value: s }] : ['del', 'meta', 'activeSession']);

const Store = {
  state: { rounds: [], arrows: [], sets: [], comparisons: [], activeSession: null },

  async init() {
    const [rounds, arrows, sets, comparisons, meta] = await Promise.all([
      DB.getAll('rounds'), DB.getAll('arrows'), DB.getAll('sets'), DB.getAll('comparisons'),
      DB.get('meta', 'activeSession')
    ]);
    this.state = { rounds, arrows, sets, comparisons, activeSession: meta ? meta.value : null };
  },

  // Uppdaterar minnet direkt och returnerar ett löfte som uppfylls när datan är skriven.
  _apply(ops) {
    for (const [op, store, v] of ops) {
      if (store === 'meta') {
        this.state.activeSession = op === 'put' ? v.value : null;
        continue;
      }
      const list = this.state[store];
      const key = op === 'put' ? v.id : v;
      const i = list.findIndex((o) => o.id === key);
      if (op === 'put') {
        if (i >= 0) list[i] = v; else list.push(v);
      } else if (i >= 0) {
        list.splice(i, 1);
      }
    }
    return DB.write(ops);
  },

  // En tävlingsomgång sparas så snart en serie är fullskjuten och innehåller bara fulla serier.
  _roundRecordOps(s) {
    const complete = s.series.filter((x) => x.arrows.length === ARROWS_PER_SERIES);
    if (complete.length) {
      return [['put', 'rounds', { id: s.roundId, name: s.name, createdAt: s.createdAt, series: clone(complete) }]];
    }
    return this.state.rounds.some((r) => r.id === s.roundId) ? [['del', 'rounds', s.roundId]] : [];
  },

  activeArrows() {
    return this.state.arrows.filter((a) => !a.deleted).sort(byNumber);
  },

  arrowById(id) {
    return this.state.arrows.find((a) => a.id === id);
  },

  setArrows(set) {
    return set.arrowIds.map((id) => this.arrowById(id)).filter((a) => a && !a.deleted).sort(byNumber);
  },

  canUndo() {
    const s = this.state.activeSession;
    if (!s) return false;
    if (s.kind === 'comparison') return s.shots.length > 0;
    return s.series.some((x) => x.arrows.length > 0);
  },

  startRound(name) {
    const createdAt = Date.now();
    const s = {
      kind: 'round',
      roundId: uid(),
      name: (name || '').trim() || defaultRoundName(createdAt),
      createdAt,
      series: [{ arrows: [] }],
      phase: 'shooting'
    };
    return this._apply([sessionOp(s)]).then(() => s);
  },

  startComparison(setId) {
    const set = this.state.sets.find((x) => x.id === setId);
    const arrows = set ? this.setArrows(set) : [];
    if (!arrows.length) return Promise.reject(new Error('Setet har inga pilar.'));
    const s = {
      kind: 'comparison',
      comparisonId: uid(),
      createdAt: Date.now(),
      setId,
      arrows: arrows.map((a) => ({ id: a.id, number: a.number })),
      shots: []
    };
    return this._apply([sessionOp(s)]).then(() => s);
  },

  // Sparar en pil i den pågående omgången/jämförelsen. Minnet uppdateras synkront.
  async placeArrow(x, y) {
    const s = this.state.activeSession;
    if (!s) return null;
    const arrow = makeArrow(x, y);

    if (s.kind === 'round') {
      if (s.phase !== 'shooting') return null;
      const cur = s.series[s.series.length - 1];
      if (cur.arrows.length >= ARROWS_PER_SERIES) return null;
      cur.arrows.push(arrow);
      let event = 'arrow';
      const ops = [];
      if (cur.arrows.length === ARROWS_PER_SERIES) {
        ops.push(...this._roundRecordOps(s));
        // Sessionen ligger kvar så att träffarna kan granskas innan omgången avslutas.
        s.phase = s.series.length === 1 ? 'askSeries2' : 'roundDone';
        event = s.series.length === 1 ? 'series1Done' : 'roundDone';
      }
      ops.push(sessionOp(s));
      await this._apply(ops);
      return { event, arrow, roundId: s.roundId };
    }

    const n = s.arrows.length;
    const len = s.shots.length;
    const a = s.arrows[nextArrowIndex(len, n)];
    const shot = { arrowId: a.id, arrowNumber: a.number, round: varvOf(len, n), ...arrow };
    s.shots.push(shot);
    await this._apply([sessionOp(s)]);
    return { event: 'shot', arrow: shot };
  },

  async undo() {
    const s = this.state.activeSession;
    if (!s) return false;
    if (s.kind === 'comparison') {
      if (!s.shots.length) return false;
      s.shots.pop();
      await this._apply([sessionOp(s)]);
      return true;
    }
    let cur = s.series[s.series.length - 1];
    if (!cur.arrows.length && s.series.length > 1) {
      s.series.pop();
      cur = s.series[s.series.length - 1];
    }
    if (!cur.arrows.length) return false;
    cur.arrows.pop();
    s.phase = 'shooting';
    await this._apply([...this._roundRecordOps(s), sessionOp(s)]);
    return true;
  },

  continueSeries2() {
    const s = this.state.activeSession;
    if (!s || s.kind !== 'round' || s.phase !== 'askSeries2') return Promise.resolve();
    s.series.push({ arrows: [] });
    s.phase = 'shooting';
    return this._apply([sessionOp(s)]);
  },

  // ”Avsluta” efter serie 1 eller 2: omgången är redan sparad, sessionen stängs.
  finishRound() {
    return this._apply([sessionOp(null)]);
  },

  discardSession() {
    return this._apply([sessionOp(null)]);
  },

  renameSession(name) {
    const s = this.state.activeSession;
    if (!s || s.kind !== 'round') return Promise.resolve();
    s.name = name.trim() || defaultRoundName(s.createdAt);
    const ops = this.state.rounds.some((r) => r.id === s.roundId) ? this._roundRecordOps(s) : [];
    return this._apply([...ops, sessionOp(s)]);
  },

  renameRound(id, name) {
    const r = this.state.rounds.find((x) => x.id === id);
    if (!r) return Promise.resolve();
    const updated = { ...r, name: name.trim() || defaultRoundName(r.createdAt) };
    const ops = [['put', 'rounds', updated]];
    const s = this.state.activeSession;
    if (s && s.kind === 'round' && s.roundId === id) {
      s.name = updated.name;
      ops.push(sessionOp(s));
    }
    return this._apply(ops);
  },

  deleteRound(id) {
    const ops = [['del', 'rounds', id]];
    const s = this.state.activeSession;
    if (s && s.kind === 'round' && s.roundId === id) ops.push(sessionOp(null));
    return this._apply(ops);
  },

  // Sparar jämförelsen (om den har skott) och avslutar sessionen. Returnerar id eller null.
  async finishComparison() {
    const s = this.state.activeSession;
    if (!s || s.kind !== 'comparison') return null;
    if (!s.shots.length) {
      await this._apply([sessionOp(null)]);
      return null;
    }
    const c = {
      id: s.comparisonId,
      createdAt: s.createdAt,
      arrowIds: s.arrows.map((a) => a.id),
      shots: clone(s.shots)
    };
    await this._apply([['put', 'comparisons', c], sessionOp(null)]);
    return c.id;
  },

  deleteComparison(id) {
    return this._apply([['del', 'comparisons', id]]);
  },

  // Skapar ett set. Ett nummer som redan finns i registret återanvänder samma pil.
  async createSet(values) {
    const parsed = parseSetNumbers(values);
    if (parsed.error) throw new Error(parsed.error);
    const ops = [];
    const arrowIds = [];
    for (const n of parsed.numbers) {
      let a = this.state.arrows.find((x) => !x.deleted && x.number === n);
      if (!a) {
        a = { id: uid(), number: n, deleted: false };
        ops.push(['put', 'arrows', a]);
      }
      arrowIds.push(a.id);
    }
    const set = { id: uid(), arrowIds };
    ops.push(['put', 'sets', set]);
    await this._apply(ops);
    return set;
  },

  deleteSet(id) {
    return this._apply([['del', 'sets', id]]);
  },

  // Tar bort en pil ur registret och ur alla set. Sparade jämförelser behåller sina skott.
  deleteArrow(id) {
    const a = this.arrowById(id);
    if (!a) return Promise.resolve();
    const ops = [['put', 'arrows', { ...a, deleted: true }]];
    for (const s of this.state.sets) {
      if (!s.arrowIds.includes(id)) continue;
      const rest = s.arrowIds.filter((x) => x !== id);
      ops.push(rest.length ? ['put', 'sets', { ...s, arrowIds: rest }] : ['del', 'sets', s.id]);
    }
    return this._apply(ops);
  },

  exportData() {
    const { rounds, arrows, sets, comparisons, activeSession } = this.state;
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      data: clone({ rounds, arrows, sets, comparisons, activeSession: activeSession || null })
    };
  },

  // Ersätter all data med innehållet i backupen.
  async importData(obj) {
    const err = validateBackup(obj);
    if (err) throw new Error(err);
    const d = obj.data;
    const data = {
      rounds: d.rounds, arrows: d.arrows, sets: d.sets, comparisons: d.comparisons,
      activeSession: d.activeSession || null
    };
    await DB.replaceAll(data);
    await this.init();
  }
};

/* ==========================================================================
   DOM-hjälp
   ========================================================================== */

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const DOM_PROPS = new Set(['value', 'checked', 'disabled', 'hidden']);

function appendKids(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false || k === true) continue;
    el.append(k instanceof Node ? k : String(k));
  }
}

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (DOM_PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  appendKids(el, kids);
  return el;
}

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  return el;
}

function useEl(ref) {
  const u = svgEl('use', { href: ref });
  u.setAttributeNS(XLINK_NS, 'xlink:href', ref);
  return u;
}

const $ = (sel) => document.querySelector(sel);

/* ==========================================================================
   Måltavla
   ========================================================================== */

// Ritar en World Archery 10-ringstavla (60 cm) i gruppen g. Enheter: cm.
function buildTargetFace(g) {
  g.textContent = '';
  g.append(svgEl('rect', {
    x: -SURFACE_HALF, y: -SURFACE_HALF, width: 2 * SURFACE_HALF, height: 2 * SURFACE_HALF, fill: FRAME_COLOR
  }));
  const zones = [[30, '#FFFFFF'], [24, '#231F20'], [18, '#4FADDE'], [12, '#DC4A4A'], [6, '#F7E04B']];
  for (const [r, fill] of zones) g.append(svgEl('circle', { r, fill }));
  // Linjer 2 mm breda, ritade helt innanför den högre zonen.
  const line = (r, stroke) => svgEl('circle', { r: r - 0.1, fill: 'none', stroke, 'stroke-width': 0.2 });
  for (const r of [1.5, 3, 6, 9, 12, 15, 27, 30]) g.append(line(r, '#231F20'));
  g.append(line(21, '#FFFFFF'));
  g.append(svgEl('path', { d: 'M-0.2 0H0.2M0 -0.2V0.2', stroke: '#231F20', 'stroke-width': 0.1, fill: 'none' }));
}

function renderMarkers(g, list, r) {
  g.textContent = '';
  for (const m of list) {
    const rr = m.r || r;
    const grp = svgEl('g', { transform: `translate(${m.x} ${m.y})` });
    if (m.dim) grp.setAttribute('opacity', '0.35');
    if (m.highlight) {
      // Dubbel ring (svart och vit) så att markerad pil syns på alla färger.
      grp.append(svgEl('circle', { r: rr + 0.9, fill: 'none', stroke: '#000', 'stroke-width': 0.45 }));
      grp.append(svgEl('circle', { r: rr + 0.5, fill: 'none', stroke: '#fff', 'stroke-width': 0.35 }));
    }
    grp.append(svgEl('circle', {
      r: rr, fill: m.color || MARKER_COLOR, stroke: '#000', 'stroke-width': (rr * 0.16).toFixed(3)
    }));
    if (m.label != null && m.label !== '') {
      const label = String(m.label);
      const size = rr * (label.length >= 3 ? 0.85 : label.length === 2 ? 1.1 : 1.3);
      const t = svgEl('text', {
        'text-anchor': 'middle', dy: '0.35em', 'font-size': size.toFixed(3), 'font-weight': 800,
        'font-family': '-apple-system, system-ui, sans-serif',
        fill: m.textColor || textColorFor(m.color || MARKER_COLOR)
      });
      t.textContent = label;
      grp.append(t);
    }
    g.append(grp);
  }
}

let boardSeq = 0;

function createBoard({ interactive = false, markerR = 1.3 } = {}) {
  const markersId = `markers-${++boardSeq}`;
  const vb = `${-SURFACE_HALF} ${-SURFACE_HALF} ${2 * SURFACE_HALF} ${2 * SURFACE_HALF}`;
  const svg = svgEl('svg', { class: 'target', viewBox: vb, role: 'img', 'aria-label': 'Måltavla' });
  const markers = svgEl('g', { id: markersId, class: 'markers' });
  svg.append(useEl('#target-face'), markers);
  const box = h('div', { class: interactive ? 'board interactive' : 'board static' }, svg);
  const board = { svg, box, markers, el: box, destroy() {} };
  board.setMarkers = (list) => renderMarkers(markers, list, markerR);

  if (interactive) {
    const zsvg = svgEl('svg', { viewBox: '0 0 1 1', 'aria-hidden': 'true' });
    const arm = TARGET_DIAMETER * ZOOM_VIEW_FRACTION * 0.13;
    const cross = svgEl('g');
    for (const [stroke, w] of [['#fff', 4], ['#000', 1.5]]) {
      cross.append(svgEl('path', {
        d: `M${-arm} ${-arm}L${arm} ${arm}M${-arm} ${arm}L${arm} ${-arm}`,
        stroke, 'stroke-width': w, 'stroke-linecap': 'round', fill: 'none', 'vector-effect': 'non-scaling-stroke'
      }));
    }
    zsvg.append(
      svgEl('rect', { x: -500, y: -500, width: 1000, height: 1000, fill: ZOOM_OUTSIDE_COLOR }),
      useEl('#target-face'),
      useEl('#' + markersId),
      cross
    );
    const zoom = h('div', { class: 'zoom', hidden: true }, zsvg);
    box.append(zoom);
    const wrap = h('div', { class: 'board-wrap' }, box);
    Object.assign(board, { zoom, zsvg, cross, wrap, el: wrap });

    const fit = () => fitBoard(board);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(fit);
      ro.observe(wrap);
      board.destroy = () => ro.disconnect();
    } else {
      window.addEventListener('resize', fit);
      board.destroy = () => window.removeEventListener('resize', fit);
    }
  }
  return board;
}

const ZONE_FILL = { gold: '#F7E04B', red: '#DC4A4A', blue: '#4FADDE', black: '#231F20', white: '#FFFFFF', miss: '#C8C8C8' };

// Senaste poängen i nedre vänstra hörnet och summorna i nedre högra, i ramytan utanför tavlan (cm).
function boardCorners(board) {
  const g = svgEl('g', { class: 'corners', 'pointer-events': 'none' });
  const badge = svgEl('g', { visibility: 'hidden' });
  const rect = svgEl('rect', { x: -32.6, y: 25.4, width: 7.2, height: 7.2, rx: 1, stroke: '#000', 'stroke-width': 0.3 });
  const score = svgEl('text', { x: -29, y: 29, dy: '0.36em', 'text-anchor': 'middle', 'font-size': 5 });
  badge.append(rect, score);
  const extra = svgEl('text', { class: 'sum', x: 32.4, y: 24.6, 'text-anchor': 'end', 'font-size': 2.2 });
  const label = svgEl('text', { class: 'sum', x: 32.4, y: 27, 'text-anchor': 'end', 'font-size': 2 });
  const value = svgEl('text', { class: 'sum', x: 32.4, y: 32.3, 'text-anchor': 'end', 'font-size': 4.6 });
  g.append(badge, extra, label, value);
  board.svg.append(g);
  return {
    setScore(a) {
      badge.setAttribute('visibility', a ? 'visible' : 'hidden');
      if (!a) return;
      const z = zoneOf(a);
      rect.setAttribute('fill', ZONE_FILL[z]);
      score.setAttribute('fill', z === 'black' ? '#fff' : '#000');
      score.textContent = scoreLabel(a);
    },
    setSum(sum) {
      label.textContent = sum.label;
      value.textContent = sum.value;
      extra.textContent = sum.extra || '';
    }
  };
}

function fitBoard(board) {
  const size = Math.floor(Math.min(board.wrap.clientWidth, board.wrap.clientHeight));
  if (size <= 0) return;
  board.box.style.width = board.box.style.height = `${size}px`;
  const zoomPx = Math.round(size * (TARGET_DIAMETER / (2 * SURFACE_HALF)) * ZOOM_WINDOW_FRACTION);
  board.zoom.style.width = board.zoom.style.height = `${zoomPx}px`;
}

function clientToCm(svg, clientX, clientY) {
  const r = svg.getBoundingClientRect();
  const span = 2 * SURFACE_HALF;
  return {
    x: clamp((clientX - r.left) / r.width * span - SURFACE_HALF, -SURFACE_HALF, SURFACE_HALF),
    y: clamp((clientY - r.top) / r.height * span - SURFACE_HALF, -SURFACE_HALF, SURFACE_HALF)
  };
}

// Placering av en pil med ett finger: zoomfönster under dragning, sparas när fingret lyfts.
function attachPlacement(board, handlers) {
  const { svg } = board;
  let pid = null;
  let side = null; // hörnet där zoomfönstret visas: 'left' eller 'right'
  let pt = null;

  function update(e) {
    pt = clientToCm(svg, e.clientX, e.clientY);
    if (side === null) side = pt.x < 0 ? 'right' : 'left';
    else if (side === 'right' && pt.x > ZOOM_HYSTERESIS) side = 'left';
    else if (side === 'left' && pt.x < -ZOOM_HYSTERESIS) side = 'right';
    const w = TARGET_DIAMETER * ZOOM_VIEW_FRACTION;
    board.zsvg.setAttribute('viewBox', `${pt.x - w / 2} ${pt.y - w / 2} ${w} ${w}`);
    board.cross.setAttribute('transform', `translate(${pt.x} ${pt.y})`);
    board.zoom.classList.toggle('left', side === 'left');
    if (handlers.onMove) handlers.onMove(pt, scoreAt(pt.x, pt.y));
  }

  function finish(commit) {
    const p = pt;
    pid = null;
    pt = null;
    board.zoom.hidden = true;
    if (commit && p) handlers.onCommit(p);
    else if (handlers.onCancel) handlers.onCancel();
  }

  svg.addEventListener('pointerdown', (e) => {
    if (pid !== null) return; // bara första fingret räknas
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (handlers.canStart && !handlers.canStart()) return;
    e.preventDefault();
    pid = e.pointerId;
    side = null;
    try { svg.setPointerCapture(pid); } catch (err) { /* stöds inte */ }
    if (handlers.onStart) handlers.onStart();
    board.zoom.hidden = false;
    update(e);
  });
  svg.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    e.preventDefault();
    update(e);
  });
  svg.addEventListener('pointerup', (e) => {
    if (e.pointerId !== pid) return;
    update(e);
    finish(true);
  });
  svg.addEventListener('pointercancel', (e) => {
    if (e.pointerId !== pid) return;
    finish(false);
  });

  // Stoppa scroll, zoom, förstoringsglas och kontextmeny på tavlan.
  const stop = (e) => e.preventDefault();
  board.box.addEventListener('touchstart', stop, { passive: false });
  board.box.addEventListener('touchmove', stop, { passive: false });
  board.box.addEventListener('contextmenu', stop);
  board.box.addEventListener('selectstart', stop);
  board.box.addEventListener('dblclick', stop);

  return {
    get active() { return pid !== null; },
    cancel() { if (pid !== null) finish(false); }
  };
}

/* ==========================================================================
   UI-ramverk: vyer, dialoger, notiser
   ========================================================================== */

let currentCleanup = null;

function go(view, ...args) {
  if (currentCleanup) currentCleanup();
  currentCleanup = null;
  const root = $('#app');
  const res = view(...args);
  root.textContent = '';
  root.append(res.el);
  currentCleanup = res.cleanup || null;
  if (res.mounted) res.mounted();
}

function bar({ title, left, right, onTitle }) {
  const t = onTitle
    ? h('button', { class: 'bar-title', onclick: onTitle, 'aria-label': 'Byt namn' }, title)
    : h('div', { class: 'bar-title' }, title);
  return {
    el: h('header', { class: 'bar' }, h('div', { class: 'bar-side' }, left), t, h('div', { class: 'bar-side right' }, right)),
    setTitle: (s) => { t.textContent = s; }
  };
}

const barBtn = (label, onclick) => h('button', { class: 'bar-btn', onclick }, label);

function page(barObj, content, extraClass) {
  return h('div', { class: 'view' + (extraClass ? ' ' + extraClass : '') }, barObj.el, content);
}

// closable ger en stängknapp (X) som löser löftet med 'close'.
function modal({ title, text, content, buttons = [], links = [], closable = false }) {
  return new Promise((resolve) => {
    const close = (v) => { overlay.remove(); resolve(v); };
    const overlay = h('div', { class: 'overlay' },
      h('div', { class: 'dialog' + (closable ? ' closable' : ''), role: 'dialog', 'aria-modal': 'true' },
        closable ? h('button', { class: 'dialog-close', 'aria-label': 'Stäng', onclick: () => close('close') }, '✕') : null,
        title ? h('h2', null, title) : null,
        text ? h('p', null, text) : null,
        content || null,
        h('div', { class: 'dialog-buttons' },
          buttons.map((b) => h('button', { class: `btn ${b.kind || ''}`, onclick: () => close(b.value) }, b.label))),
        links.length
          ? h('div', { class: 'dialog-links' },
            links.map((l) => h('button', { class: 'link', onclick: () => close(l.value) }, l.label)))
          : null));
    // Stoppa zoom och kontextmeny även när dialogen visas.
    overlay.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    $('#modal-root').append(overlay);
  });
}

async function confirmDialog(title, text, okLabel = 'OK', danger = false) {
  const v = await modal({
    title, text,
    buttons: [{ label: 'Avbryt', value: 'cancel' }, { label: okLabel, value: 'ok', kind: danger ? 'danger' : 'primary' }]
  });
  return v === 'ok';
}

async function promptDialog(title, value, placeholder) {
  const input = h('input', { class: 'input', type: 'text', value: value || '', placeholder: placeholder || '', maxlength: 60 });
  const p = modal({
    title, content: input,
    buttons: [{ label: 'Avbryt', value: 'cancel' }, { label: 'Spara', value: 'ok', kind: 'primary' }]
  });
  setTimeout(() => input.focus(), 50);
  const v = await p;
  return v === 'ok' ? input.value : null;
}

let toastTimer = null;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function scoreChip(a) {
  return h('span', { class: `sc z-${zoneOf(a)}` }, scoreLabel(a));
}

function kv(k, v) {
  return h('div', { class: 'kv' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
}

function sideBox(label, value, cls) {
  const num = h('div', { class: 'side-num' }, value);
  const el = h('div', { class: 'side-box' + (cls ? ' ' + cls : '') }, h('div', { class: 'side-label' }, label), num);
  return { el, num, label: el.firstChild };
}

function liveBox(label) {
  const num = h('div', { class: 'live-num' }, '');
  const el = h('div', { class: 'side-box grow' }, h('div', { class: 'side-label' }, label), num);
  return {
    el,
    set(a) {
      num.textContent = a ? scoreLabel(a) : '';
      el.className = 'side-box grow' + (a ? ` z-${zoneOf(a)}` : '');
    }
  };
}

// Protokolltabell för en serie: Pil 1 | Pil 2 | Pil 3 | Poäng | Serie | Totalt
// activeIndex markeras. Med onCell blir pilrutorna tryckbara (onCell(index)).
function seriesGrid(arrows, previousTotal, activeIndex, isStatic, onCell) {
  const g = h('div', { class: 'grid6' + (isStatic ? ' static' : '') });
  for (const t of ['Pil 1', 'Pil 2', 'Pil 3', 'Poäng', 'Serie', 'Totalt']) g.append(h('div', { class: 'gh' }, t));
  seriesTable(arrows, previousTotal).forEach((row, r) => {
    for (let c = 0; c < ARROWS_PER_END; c++) {
      const i = r * ARROWS_PER_END + c;
      const a = arrows[i];
      const cls = 'gc' + (a ? ` z-${zoneOf(a)}` : '') + (i === activeIndex ? ' active' : '') + (a && onCell ? ' tap' : '');
      g.append(h('div', { class: cls, onclick: a && onCell ? () => onCell(i) : null }, a ? scoreLabel(a) : ''));
    }
    g.append(h('div', { class: 'gc sum' }, row.rowSum));
    g.append(h('div', { class: 'gc sum' }, row.seriesSum));
    g.append(h('div', { class: 'gc total' }, row.total));
  });
  return g;
}

/* ==========================================================================
   Vyer
   ========================================================================== */

async function ensureNoSession() {
  const s = Store.state.activeSession;
  if (!s) return true;
  if (s.kind === 'round' && s.phase === 'roundDone') {
    // Hela omgången är redan sparad, det finns inget att slänga.
    await Store.finishRound();
    return true;
  }
  const what = s.kind === 'round' ? 'omgång' : 'jämförelse';
  const saved = s.kind === 'round' && Store.state.rounds.some((r) => r.id === s.roundId)
    ? ' Serie 1 är redan sparad och påverkas inte.' : '';
  const ok = await confirmDialog(`Pågående ${what}`,
    `Du har en pågående ${what}. Om du startar något nytt slängs den.${saved}`, 'Släng och starta', true);
  if (ok) await Store.discardSession();
  return ok;
}

function sessionDescription(s) {
  if (s.kind === 'round') {
    if (s.phase === 'askSeries2') return `${s.name} · serie 1 klar`;
    if (s.phase === 'roundDone') return `${s.name} · båda serierna klara`;
    const k = s.series.length;
    return `${s.name} · serie ${k} · ${s.series[k - 1].arrows.length}/${ARROWS_PER_SERIES} pilar`;
  }
  const nums = s.arrows.map((a) => a.number).join(', ');
  return `Jämförelse (pil ${nums}) · ${s.shots.length} skott`;
}

function resumeSession() {
  const s = Store.state.activeSession;
  if (!s) return go(viewHome);
  go(s.kind === 'round' ? viewShootRound : viewShootComparison);
}

function resumeCard(s, onDiscarded) {
  return h('section', { class: 'card resume' },
    h('div', { class: 'resume-title' }, 'Pågående'),
    h('div', { class: 'resume-desc' }, sessionDescription(s)),
    h('div', { class: 'row-buttons' },
      h('button', { class: 'btn primary', onclick: resumeSession }, 'Fortsätt pågående'),
      h('button', {
        class: 'btn danger-outline',
        onclick: async () => {
          const saved = s.kind === 'round' && Store.state.rounds.some((r) => r.id === s.roundId);
          let text = 'Alla skott i jämförelsen slängs.';
          if (s.kind === 'round') {
            if (s.phase === 'roundDone') text = 'Omgången är redan sparad och finns kvar. Bara den pågående vyn stängs.';
            else if (saved) text = 'Serie 2 slängs. Serie 1 är redan sparad och finns kvar.';
            else text = 'Alla pilar i omgången slängs.';
          }
          const ok = await confirmDialog('Släng pågående?', text, 'Släng', true);
          if (!ok) return;
          await Store.discardSession();
          toast('Pågående slängdes');
          onDiscarded();
        }
      }, 'Släng')));
}

// ---------- Startsida ----------

function viewHome() {
  const st = Store.state;
  const content = h('main', { class: 'content' });
  if (st.activeSession) content.append(resumeCard(st.activeSession, () => go(viewHome)));

  content.append(h('div', { class: 'big-buttons' },
    h('button', {
      class: 'btn big primary',
      onclick: async () => { if (await ensureNoSession()) go(viewRoundSetup); }
    }, 'Räkna serie'),
    h('button', { class: 'btn big', onclick: () => go(viewCompareHome) }, 'Jämför pilar'),
    h('button', { class: 'btn wide', onclick: () => go(viewRoundStats) }, 'Statistik')));

  content.append(h('h2', { class: 'section' }, 'Sparade tävlingsomgångar'));
  const rounds = [...st.rounds].sort((a, b) => b.createdAt - a.createdAt);
  content.append(rounds.length
    ? h('div', { class: 'list' }, rounds.map((r) => {
      const sum = roundSummary(r);
      return h('button', { class: 'list-item', onclick: () => go(viewRoundDetail, r.id, () => go(viewHome)) },
        h('div', { class: 'li-main' },
          h('div', { class: 'li-title' }, r.name),
          h('div', { class: 'li-sub' }, `${fmtDate(r.createdAt)} · ${r.series.length === 1 ? '1 serie' : '2 serier'}`)),
        h('div', { class: 'li-score' },
          h('div', { class: 'big' }, sum.score),
          h('div', { class: 'small' }, `10:or ${sum.tens} · X ${sum.xs}`)));
    }))
    : h('p', { class: 'empty' }, 'Inga sparade omgångar ännu.'));

  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: onImportFile });
  content.append(
    h('h2', { class: 'section' }, 'Backup'),
    h('div', { class: 'row-buttons' },
      h('button', { class: 'btn', onclick: exportBackup }, 'Exportera backup'),
      h('button', { class: 'btn', onclick: () => fileInput.click() }, 'Importera backup')),
    fileInput,
    h('p', { class: 'hint' }, 'Backupen är en JSON-fil med alla omgångar, jämförelser, set och pilar. Spara den t.ex. i Filer eller iCloud Drive.'),
    h('p', { class: 'version' }, `Bågskytte ${APP_VERSION}`));

  return { el: page(bar({ title: 'Bågskytte' }), content) };
}

async function exportBackup() {
  const json = JSON.stringify(Store.exportData(), null, 2);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  const filename = `bagskytte-backup-${stamp}.json`;
  const blob = new Blob([json], { type: 'application/json' });
  try {
    const file = new File([blob], filename, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Bågskytte backup' });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function onImportFile(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let obj;
  try {
    obj = JSON.parse(await file.text());
  } catch (err) {
    await modal({ title: 'Kunde inte läsa filen', text: 'Filen är ingen giltig JSON-fil.', buttons: [{ label: 'OK', value: 'ok', kind: 'primary' }] });
    return;
  }
  const err = validateBackup(obj);
  if (err) {
    await modal({ title: 'Kunde inte importera', text: err, buttons: [{ label: 'OK', value: 'ok', kind: 'primary' }] });
    return;
  }
  const d = obj.data;
  const ok = await confirmDialog('Importera backup?',
    `Backupen innehåller ${d.rounds.length} omgångar och ${d.comparisons.length} jämförelser. ` +
    'All nuvarande data i appen ersätts.', 'Importera', true);
  if (!ok) return;
  await Store.importData(obj);
  toast('Backupen är importerad');
  go(viewHome);
}

// ---------- Räkna serie ----------

function viewRoundSetup() {
  const input = h('input', {
    id: 'round-name', class: 'input', type: 'text', maxlength: 60, enterkeyhint: 'go',
    placeholder: defaultRoundName(Date.now()), autocomplete: 'off'
  });
  const start = async (e) => {
    e.preventDefault();
    input.blur();
    await Store.startRound(input.value);
    go(viewShootRound);
  };
  const content = h('main', { class: 'content' },
    h('form', { onsubmit: start },
      h('div', { class: 'field' },
        h('label', { for: 'round-name' }, 'Namn (valfritt)'),
        input,
        h('p', { class: 'hint' }, 'Tomt namn ger ”Omgång” och dagens datum. Namnet kan ändras senare.')),
      h('p', null),
      h('button', { class: 'btn big primary', type: 'submit' }, 'Starta')));
  return { el: page(bar({ title: 'Räkna serie', left: barBtn('‹ Hem', () => go(viewHome)) }), content) };
}

function viewShootRound() {
  const ses = () => Store.state.activeSession;
  const isDone = () => { const s = ses(); return !!s && s.kind === 'round' && s.phase !== 'shooting'; };
  let placing = false;
  let dialogOpen = false;
  let show = 'both'; // serien som visas när serien/omgången är klar: 0, 1 eller 'both'

  const undoBtn = barBtn('Ångra', onUndo);
  const backBtn = h('button', { class: 'bar-btn icon', 'aria-label': 'Tillbaka till startsidan', onclick: onBack }, '‹');
  const header = bar({ title: '', left: [backBtn, barBtn('Spara', onSave)], right: undoBtn, onTitle: rename });
  const board = createBoard({ interactive: true, markerR: 1.3 });
  const corners = boardCorners(board);
  const nextBtn = h('button', { class: 'btn primary', onclick: openDoneDialog }, 'Gå vidare');
  const seg = h('div', { class: 'seg' });
  const doneBar = h('div', { class: 'done-bar' }, seg, nextBtn);
  // När serien är klar öppnar ett tryck på siffrorna dialogen.
  const tableHost = h('div', { class: 'shoot-bottom fixed', onclick: () => { if (isDone()) openDoneDialog(); } });

  const placement = attachPlacement(board, {
    canStart: () => {
      const s = ses();
      return !!s && s.kind === 'round' && s.phase === 'shooting' &&
        s.series[s.series.length - 1].arrows.length < ARROWS_PER_SERIES;
    },
    onStart: () => { placing = true; render(); },
    onMove: (pt, sc) => corners.setScore(sc),
    onCommit: commit,
    onCancel: () => { placing = false; render(); }
  });

  function render() {
    const s = ses();
    if (!s || s.kind !== 'round') return;
    const done = s.phase !== 'shooting';
    const two = s.series.length > 1;
    const si = s.series.length - 1;
    const cur = s.series[si].arrows;
    const n = cur.length;
    const prev = two ? seriesScore(s.series[0]) : null;
    header.setTitle(s.name);

    if (done) {
      // Alla pilar i serien (eller vald serie) visas på tavlan.
      if (!two) show = 0;
      board.setMarkers(s.series.flatMap((x, i) => (show === 'both' || show === i
        ? x.arrows.map((a) => ({ x: a.x, y: a.y, color: SERIES_COLORS[i], r: 0.85 }))
        : [])));
      seg.textContent = '';
      for (const [val, label] of [[0, 'Serie 1'], [1, 'Serie 2'], ['both', 'Båda']]) {
        seg.append(h('button', { class: show === val ? 'on' : '', onclick: () => { show = val; render(); } }, label));
      }
    } else {
      // Tavlan visar pilarna i aktuell rad. De försvinner när nästa rad påbörjas.
      const row = placing ? Math.floor(n / ARROWS_PER_END) : Math.floor(Math.max(n - 1, 0) / ARROWS_PER_END);
      board.setMarkers(cur.slice(row * ARROWS_PER_END, (row + 1) * ARROWS_PER_END)
        .map((a, i) => ({ x: a.x, y: a.y, label: i + 1 })));
    }

    doneBar.hidden = !done;
    seg.hidden = !two;
    const curSum = sumScores(cur);
    corners.setSum(two
      ? { label: 'Totalt', value: prev + curSum, extra: `S2 ${curSum}` }
      : { label: 'Serie 1', value: curSum });
    if (!placing) corners.setScore(n ? cur[n - 1] : null);

    const tsi = done && show === 0 ? 0 : si;
    tableHost.textContent = '';
    tableHost.append(seriesGrid(s.series[tsi].arrows, tsi > 0 ? prev : null,
      done ? -1 : (n < ARROWS_PER_SERIES ? n : -1), false));
    undoBtn.disabled = !Store.canUndo();
  }

  async function commit(pt) {
    placing = false;
    const res = await Store.placeArrow(pt.x, pt.y);
    if (res && (res.event === 'series1Done' || res.event === 'roundDone')) {
      show = 'both';
      toast(res.event === 'series1Done' ? 'Serie 1 klar – tryck på siffrorna för att gå vidare' : 'Omgången klar – tryck på siffrorna för att gå vidare');
    }
    render();
  }

  async function onUndo() {
    placement.cancel();
    await Store.undo();
    render();
  }

  function onBack() {
    placement.cancel();
    go(viewHome);
  }

  function onSave() {
    placement.cancel();
    toast('Omgången är sparad. Fortsätt från startsidan.');
    go(viewHome);
  }

  async function rename() {
    const s = ses();
    const name = await promptDialog('Byt namn', s.name, defaultRoundName(s.createdAt));
    if (name == null) return;
    await Store.renameSession(name);
    render();
  }

  // Dialogen efter serie 1 (Avsluta/Nästa) eller efter serie 2 (Visa omgång/Avsluta). Kan stängas med X.
  async function openDoneDialog() {
    const s = ses();
    if (!isDone() || dialogOpen) return;
    dialogOpen = true;
    const s1 = seriesScore(s.series[0]);
    const undoLink = [{ label: 'Ångra sista pilen', value: 'undo' }];
    const v = s.phase === 'askSeries2'
      ? await modal({
        title: 'Serie 1 klar',
        text: `Serie 1 är sparad: ${s1} poäng. Avsluta till huvudmenyn eller skjut serie 2.`,
        buttons: [{ label: 'Avsluta', value: 'finish' }, { label: 'Nästa', value: 'next', kind: 'primary' }],
        links: undoLink, closable: true
      })
      : await modal({
        title: 'Omgången klar',
        text: `Serie 1: ${s1} · Serie 2: ${seriesScore(s.series[1])} · Totalt: ${roundSummary(s).score} poäng. Omgången är sparad.`,
        buttons: [{ label: 'Visa omgång', value: 'show' }, { label: 'Avsluta', value: 'finish', kind: 'primary' }],
        links: undoLink, closable: true
      });
    dialogOpen = false;
    if (v === 'next') {
      await Store.continueSeries2();
    } else if (v === 'finish' || v === 'show') {
      const id = s.roundId;
      await Store.finishRound();
      toast('Omgången är sparad');
      if (v === 'show') go(viewRoundDetail, id, () => go(viewHome));
      else go(viewHome);
      return;
    } else if (v === 'undo') {
      await Store.undo();
    }
    render();
  }

  const el = page(header, h('div', { style: 'display:contents' },
    h('div', { class: 'shoot-top' }, board.el),
    doneBar,
    tableHost));

  return {
    el,
    mounted: render,
    cleanup() { placement.cancel(); board.destroy(); }
  };
}

// ---------- Sparad omgång ----------

function viewRoundDetail(id, back) {
  const r = Store.state.rounds.find((x) => x.id === id);
  if (!r) return { el: h('div'), mounted: back };
  const sum = roundSummary(r);
  let show = r.series.length > 1 ? 'both' : 0;
  let sel = null; // markerad pil: { si, i }

  const nameInput = h('input', {
    class: 'input', type: 'text', value: r.name, maxlength: 60, 'aria-label': 'Namn',
    onchange: async () => {
      await Store.renameRound(id, nameInput.value);
      nameInput.value = Store.state.rounds.find((x) => x.id === id).name;
      toast('Namnet är sparat');
    }
  });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });

  const board = createBoard({ markerR: 0.75 });
  const caption = h('p', { class: 'board-caption' });
  const seg = h('div', { class: 'seg' });
  const tablesHost = h('div');

  function select(si, i) {
    sel = sel && sel.si === si && sel.i === i ? null : { si, i };
    if (sel && show !== 'both' && show !== si) show = 'both';
    render();
  }

  function render() {
    seg.textContent = '';
    if (r.series.length > 1) {
      for (const [val, label] of [[0, 'Serie 1'], [1, 'Serie 2'], ['both', 'Båda']]) {
        seg.append(h('button', {
          class: show === val ? 'on' : '',
          onclick: () => {
            show = val;
            if (sel && show !== 'both' && show !== sel.si) sel = null;
            render();
          }
        }, label));
      }
    }
    seg.hidden = r.series.length < 2;

    const markers = [];
    let picked = null;
    r.series.forEach((s, si) => {
      if (show !== 'both' && show !== si) return;
      s.arrows.forEach((a, i) => {
        if (sel && sel.si === si && sel.i === i) {
          picked = { x: a.x, y: a.y, color: HIGHLIGHT_COLOR, label: i + 1, r: 1.5, highlight: true };
        } else {
          markers.push({ x: a.x, y: a.y, color: SERIES_COLORS[si], dim: !!sel });
        }
      });
    });
    if (picked) markers.push(picked); // överst
    board.setMarkers(markers);

    if (sel) {
      const a = r.series[sel.si].arrows[sel.i];
      const rowNo = Math.floor(sel.i / ARROWS_PER_END) + 1;
      const pilNo = (sel.i % ARROWS_PER_END) + 1;
      caption.textContent = `Serie ${sel.si + 1} · rad ${rowNo} · pil ${pilNo}: ${scoreLabel(a)}`;
    } else {
      caption.textContent = 'Tryck på en poängsiffra för att markera pilen.';
    }

    tablesHost.textContent = '';
    r.series.forEach((s, si) => tablesHost.append(
      h('div', { class: 'series-head' },
        h('h3', null, `Serie ${si + 1}`),
        h('span', null, h('span', { class: 'dot', style: `background:${SERIES_COLORS[si]}` }), `${seriesScore(s)} poäng`)),
      seriesGrid(s.arrows, si > 0 ? seriesScore(r.series[0]) : null,
        sel && sel.si === si ? sel.i : -1, true, (i) => select(si, i))));
  }

  const content = h('main', { class: 'content' },
    h('div', { class: 'field' }, h('label', null, 'Namn'), nameInput),
    h('p', { class: 'meta-line' }, fmtDateTime(r.createdAt)),
    h('div', { class: 'summary' },
      sideBox('Poäng', sum.score).el, sideBox('10:or', sum.tens).el, sideBox('X', sum.xs).el),
    seg,
    h('div', { class: 'sticky-board' }, board.el, caption),
    tablesHost,
    h('p', null),
    h('button', {
      class: 'btn danger-outline wide',
      onclick: async () => {
        const ok = await confirmDialog('Radera omgången?', `”${r.name}” raderas permanent.`, 'Radera', true);
        if (!ok) return;
        await Store.deleteRound(id);
        toast('Omgången är raderad');
        back();
      }
    }, 'Radera omgång'));

  return {
    el: page(bar({ title: 'Omgång', left: barBtn('‹ Tillbaka', back) }), content),
    mounted: render
  };
}

// ---------- Statistik ----------

function niceTicks(lo, hi, count) {
  if (lo === hi) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  const step = (f >= 7 ? 10 : f >= 3 ? 5 : f >= 1.5 ? 2 : 1) * mag;
  const ticks = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 2; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}

// Linjediagram i SVG med en serie. points: [{ y, label, tip }]. Tryck/hovra för värde.
function lineChart(points, { min = 0, max = Infinity, format = String } = {}) {
  const W = 340, H = 190, L = 40, R = 14, T = 14, B = 26;
  const ys = points.map((p) => p.y);
  const ticks = niceTicks(Math.max(min, Math.min(...ys)), Math.min(max, Math.max(...ys)), 4)
    .filter((t) => t >= min && t <= max);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const px = (i) => (points.length === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (points.length - 1));
  const py = (v) => T + (y1 - v) / (y1 - y0 || 1) * (H - T - B);

  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Diagram över omgångarnas poäng' });
  for (const t of ticks) {
    svg.append(svgEl('line', { x1: L, x2: W - R, y1: py(t), y2: py(t), class: 'grid' }));
    const tx = svgEl('text', { x: L - 6, y: py(t), dy: '0.35em', 'text-anchor': 'end', class: 'axis' });
    tx.textContent = format(t);
    svg.append(tx);
  }
  const step = Math.max(1, Math.ceil(points.length / 5));
  points.forEach((p, i) => {
    if (i % step !== 0 && i !== points.length - 1) return;
    if (i !== points.length - 1 && points.length - 1 - i < step / 2) return; // undvik krock med sista etiketten
    const tx = svgEl('text', { x: px(i), y: H - 8, 'text-anchor': 'middle', class: 'axis' });
    tx.textContent = p.label;
    svg.append(tx);
  });
  if (points.length > 1) {
    svg.append(svgEl('polyline', { points: points.map((p, i) => `${px(i)},${py(p.y)}`).join(' '), class: 'line' }));
  }
  points.forEach((p, i) => svg.append(svgEl('circle', { cx: px(i), cy: py(p.y), r: 4, class: 'pt' })));
  const last = points[points.length - 1];
  const lastLabel = svgEl('text', { x: px(points.length - 1), y: py(last.y) - 9, 'text-anchor': 'end', class: 'value' });
  lastLabel.textContent = format(last.y);
  svg.append(lastLabel);

  const cross = svgEl('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' });
  const focus = svgEl('circle', { r: 6, class: 'focus', visibility: 'hidden' });
  svg.append(cross, focus);
  const tip = h('p', { class: 'chart-tip' }, 'Tryck i diagrammet för att se en omgång.');

  function pick(e) {
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * W;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(px(i) - x) < Math.abs(px(best) - x)) best = i; });
    cross.setAttribute('x1', px(best));
    cross.setAttribute('x2', px(best));
    cross.setAttribute('visibility', 'visible');
    focus.setAttribute('cx', px(best));
    focus.setAttribute('cy', py(points[best].y));
    focus.setAttribute('visibility', 'visible');
    tip.textContent = points[best].tip;
  }
  svg.addEventListener('pointerdown', pick);
  svg.addEventListener('pointermove', pick);
  return h('div', { class: 'chart-wrap' }, svg, tip);
}

function viewRoundStats() {
  const o = roundsOverview(Store.state.rounds);
  const content = h('main', { class: 'content' });
  const bar0 = bar({ title: 'Statistik', left: barBtn('‹ Hem', () => go(viewHome)) });
  if (!o.count) {
    content.append(h('p', { class: 'empty' }, 'Inga sparade tävlingsomgångar ännu. Statistiken visas när du har sparat en omgång.'));
    return { el: page(bar0, content) };
  }
  const fmt1 = (v) => (v == null ? '–' : v.toFixed(1).replace('.', ','));
  content.append(
    h('div', { class: 'stat-grid three' },
      kv('Omgångar', o.count), kv('Snitt/omgång', fmt1(o.avgRound)), kv('Snitt/pil', fmtAvg(o.avgArrow)),
      kv('Totalt', o.totalScore), kv('Bästa', o.best), kv('10:or / X', `${o.tens}/${o.xs}`)),
    o.mixedSeries
      ? h('p', { class: 'hint' }, 'Omgångarna har olika antal serier (30 eller 60 pilar). Jämför hellre snitt per pil.')
      : null);

  let mode = 'score';
  const seg = h('div', { class: 'seg' });
  const chartHost = h('div');
  function renderChart() {
    seg.textContent = '';
    for (const [val, label] of [['score', 'Poäng'], ['avg', 'Snitt per pil']]) {
      seg.append(h('button', { class: mode === val ? 'on' : '', onclick: () => { mode = val; renderChart(); } }, label));
    }
    const pts = o.rounds.map((r) => ({
      y: mode === 'score' ? r.score : r.avgArrow,
      label: new Date(r.createdAt).toLocaleDateString('sv-SE', { day: 'numeric', month: 'numeric' }),
      tip: `${r.name} · ${fmtDate(r.createdAt)}: ${r.score} poäng, ${fmtAvg(r.avgArrow)} per pil`
    }));
    chartHost.textContent = '';
    chartHost.append(mode === 'score'
      ? lineChart(pts, { min: 0 })
      : lineChart(pts, { min: 0, max: 10, format: (v) => fmtNum(v) }));
  }
  renderChart();

  content.append(
    h('h2', { class: 'section' }, 'Poäng för alla omgångar'),
    seg, chartHost,
    h('h2', { class: 'section' }, 'Per omgång'),
    h('div', { class: 'list' }, [...o.rounds].reverse().map((r) =>
      h('button', { class: 'list-item', onclick: () => go(viewRoundDetail, r.id, () => go(viewRoundStats)) },
        h('div', { class: 'li-main' },
          h('div', { class: 'li-title' }, r.name),
          h('div', { class: 'li-sub' }, `${fmtDate(r.createdAt)} · ${r.series === 1 ? '1 serie' : '2 serier'}`)),
        h('div', { class: 'li-score' },
          h('div', { class: 'big' }, r.score),
          h('div', { class: 'small' }, `snitt ${fmtAvg(r.avgArrow)}/pil`))))));

  return { el: page(bar0, content) };
}

// ---------- Jämför pilar ----------

function viewCompareHome() {
  const st = Store.state;
  const content = h('main', { class: 'content' });
  const s = st.activeSession;
  if (s && s.kind === 'comparison') content.append(resumeCard(s, () => go(viewCompareHome)));

  content.append(h('div', { class: 'big-buttons' },
    h('button', { class: 'btn big primary', onclick: () => go(viewNewComparison) }, 'Ny jämförelse'),
    h('button', { class: 'btn wide', onclick: () => go(viewArrowStats, null) }, 'Statistik per pil')));

  content.append(h('h2', { class: 'section' }, 'Sparade jämförelser'));
  const comps = [...st.comparisons].sort((a, b) => b.createdAt - a.createdAt);
  content.append(comps.length
    ? h('div', { class: 'list' }, comps.map((c) => {
      const arrows = comparisonArrows(c, st.arrows);
      const total = shotStats(c.shots);
      return h('button', { class: 'list-item', onclick: () => go(viewComparisonDetail, c.id, () => go(viewCompareHome)) },
        h('div', { class: 'li-main' },
          h('div', { class: 'li-title' }, `Pil ${arrows.map((a) => a.number).join(', ')}`),
          h('div', { class: 'li-sub' }, `${fmtDateTime(c.createdAt)} · ${c.shots.length} skott`)),
        h('div', { class: 'li-score' },
          h('div', { class: 'big' }, fmtAvg(total.avg)),
          h('div', { class: 'small' }, 'snitt')));
    }))
    : h('p', { class: 'empty' }, 'Inga sparade jämförelser ännu.'));

  content.append(h('h2', { class: 'section' }, 'Pilregister'));
  const arrows = Store.activeArrows();
  content.append(arrows.length
    ? h('div', { class: 'list' }, arrows.map((a) => {
      const shots = arrowShotsAcross(a.id, st.comparisons).length;
      const sets = st.sets.filter((x) => x.arrowIds.includes(a.id)).length;
      return h('div', { class: 'list-item' },
        h('div', { class: 'li-main' },
          h('div', { class: 'li-title' }, `Pil ${a.number}`),
          h('div', { class: 'li-sub' }, `${shots} skott · i ${sets} set`)),
        h('button', {
          class: 'btn small danger-outline',
          onclick: async () => {
            const ok = await confirmDialog(`Ta bort pil ${a.number}?`,
              'Pilen tas bort ur registret och ur alla set. Set som blir tomma raderas. ' +
              'Sparade jämförelser behåller sina skott.', 'Ta bort', true);
            if (!ok) return;
            await Store.deleteArrow(a.id);
            toast(`Pil ${a.number} är borttagen`);
            go(viewCompareHome);
          }
        }, 'Ta bort'));
    }))
    : h('p', { class: 'empty' }, 'Inga pilar ännu. Pilar läggs till när du skapar ett set.'));

  return { el: page(bar({ title: 'Jämför pilar', left: barBtn('‹ Hem', () => go(viewHome)) }), content) };
}

function viewNewComparison() {
  let count = 3;
  let values = ['1', '2', '3'];
  const errorEl = h('p', { class: 'error', hidden: true });
  const countEl = h('div', { class: 'val' }, count);
  const numGrid = h('div', { class: 'num-grid' });

  async function startWith(setId) {
    if (!(await ensureNoSession())) return;
    await Store.startComparison(setId);
    go(viewShootComparison);
  }

  function renderInputs() {
    countEl.textContent = count;
    numGrid.textContent = '';
    values.forEach((v, i) => {
      const input = h('input', {
        class: 'input', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', value: v, maxlength: 3,
        'aria-label': `Nummer för pil ${i + 1}`,
        oninput: (e) => { values[i] = e.target.value; errorEl.hidden = true; }
      });
      numGrid.append(h('div', { class: 'field' }, h('label', null, `Pil ${i + 1}`), input));
    });
  }

  function setCount(n) {
    count = clamp(n, 1, MAX_SET_SIZE);
    while (values.length < count) {
      const used = values.map((v) => parseInt(v, 10)).filter(Number.isFinite);
      values.push(String(used.length ? Math.max(...used) + 1 : values.length + 1));
    }
    values = values.slice(0, count);
    renderInputs();
  }

  const sets = Store.state.sets
    .map((s) => ({ set: s, arrows: Store.setArrows(s) }))
    .filter((x) => x.arrows.length);

  const content = h('main', { class: 'content' },
    h('h2', { class: 'section', style: 'margin-top:0' }, 'Välj ett befintligt set'),
    sets.length
      ? h('div', { class: 'list' }, sets.map(({ set, arrows }) =>
        h('div', { class: 'li-row' },
          h('button', { class: 'list-item', onclick: () => startWith(set.id) },
            h('div', { class: 'li-main' },
              h('div', { class: 'li-title' }, `Pil ${arrows.map((a) => a.number).join(', ')}`),
              h('div', { class: 'li-sub' }, `${arrows.length} pilar · tryck för att starta`))),
          h('button', {
            class: 'btn small danger-outline',
            onclick: async () => {
              const ok = await confirmDialog('Radera setet?',
                'Setet raderas. Pilarna finns kvar i pilregistret och sparade jämförelser påverkas inte.', 'Radera', true);
              if (!ok) return;
              await Store.deleteSet(set.id);
              go(viewNewComparison);
            }
          }, 'Radera'))))
      : h('p', { class: 'empty' }, 'Inga set ännu.'),

    h('h2', { class: 'section' }, 'Skapa nytt set'),
    h('div', { class: 'label' }, 'Antal pilar'),
    h('div', { class: 'stepper' },
      h('button', { class: 'btn', 'aria-label': 'Färre pilar', onclick: () => setCount(count - 1) }, '−'),
      countEl,
      h('button', { class: 'btn', 'aria-label': 'Fler pilar', onclick: () => setCount(count + 1) }, '+')),
    h('div', { class: 'label' }, 'Pilarnas nummer'),
    numGrid,
    h('p', { class: 'hint' }, 'Samma nummer i flera set är samma pil och delar statistik.'),
    errorEl,
    h('button', {
      class: 'btn big primary',
      onclick: async () => {
        const parsed = parseSetNumbers(values);
        if (parsed.error) {
          errorEl.textContent = parsed.error;
          errorEl.hidden = false;
          return;
        }
        if (!(await ensureNoSession())) return;
        const set = await Store.createSet(values);
        await Store.startComparison(set.id);
        go(viewShootComparison);
      }
    }, 'Skapa set och starta'));

  renderInputs();
  return { el: page(bar({ title: 'Ny jämförelse', left: barBtn('‹ Tillbaka', () => go(viewCompareHome)) }), content) };
}

function viewShootComparison() {
  const ses = () => Store.state.activeSession;
  let placing = false;

  const undoBtn = barBtn('Ångra', onUndo);
  const header = bar({ title: 'Jämför pilar', left: barBtn('‹ Tillbaka', () => go(viewCompareHome)), right: undoBtn });
  const board = createBoard({ interactive: true, markerR: 1.3 });
  const arrowBox = sideBox('Pil nr', '');
  const live = liveBox('Poäng');
  const varvBox = sideBox('Varv', '1');
  const tableHost = h('div', { class: 'cmp-table' });

  const placement = attachPlacement(board, {
    canStart: () => { const s = ses(); return !!s && s.kind === 'comparison'; },
    onStart: () => { placing = true; render(); },
    onMove: (pt, sc) => live.set(sc),
    onCommit: async (pt) => {
      placing = false;
      await Store.placeArrow(pt.x, pt.y);
      render();
    },
    onCancel: () => { placing = false; render(); }
  });

  function render() {
    const s = ses();
    if (!s || s.kind !== 'comparison') return;
    const n = s.arrows.length;
    const len = s.shots.length;
    const nextIdx = nextArrowIndex(len, n);
    arrowBox.num.textContent = s.arrows[nextIdx].number;
    varvBox.num.textContent = varvOf(len, n);

    // Tavlan visar skotten i aktuellt varv.
    const v = placing ? varvOf(len, n) : varvOf(Math.max(len - 1, 0), n);
    board.setMarkers(s.shots.filter((x) => x.round === v).map((x) => {
      const color = arrowColor(s.arrows.findIndex((a) => a.id === x.arrowId));
      return { x: x.x, y: x.y, label: x.arrowNumber, color };
    }));
    if (!placing) live.set(len ? s.shots[len - 1] : null);

    const g = h('div', { class: 'grid4' });
    for (const t of ['Pil', 'Senaste', 'Skott', 'Snitt']) g.append(h('div', { class: 'gh' }, t));
    s.arrows.forEach((a, i) => {
      const shots = s.shots.filter((x) => x.arrowId === a.id);
      const st = shotStats(shots);
      const last = shots[shots.length - 1];
      const nx = i === nextIdx ? ' next' : '';
      g.append(
        h('div', { class: 'gc' + nx }, h('span', { class: 'dot', style: `background:${arrowColor(i)}` }), a.number),
        h('div', { class: 'gc' + nx + (last ? ` z-${zoneOf(last)}` : '') }, last ? scoreLabel(last) : ''),
        h('div', { class: 'gc' + nx }, st.count),
        h('div', { class: 'gc' + nx }, fmtAvg(st.avg)));
    });
    tableHost.textContent = '';
    tableHost.append(g);
    undoBtn.disabled = !Store.canUndo();
  }

  async function onUndo() {
    placement.cancel();
    await Store.undo();
    render();
  }

  async function finish() {
    placement.cancel();
    const s = ses();
    const ok = await confirmDialog('Avsluta jämförelsen?',
      s.shots.length ? `${s.shots.length} skott sparas.` : 'Inga skott är registrerade, så jämförelsen sparas inte.',
      'Avsluta');
    if (!ok) return;
    const id = await Store.finishComparison();
    if (id) {
      toast('Jämförelsen är sparad');
      go(viewComparisonDetail, id, () => go(viewCompareHome));
    } else {
      toast('Tom jämförelse sparades inte');
      go(viewCompareHome);
    }
  }

  const el = page(header, h('div', { style: 'display:contents' },
    h('div', { class: 'shoot-top' }, board.el,
      h('div', { class: 'side' }, arrowBox.el, live.el, varvBox.el)),
    h('div', { class: 'shoot-bottom' }, tableHost,
      h('div', { class: 'bottom-bar' }, h('button', { class: 'btn primary', onclick: finish }, 'Avsluta')))));

  return {
    el,
    mounted: render,
    cleanup() { placement.cancel(); board.destroy(); }
  };
}

function statsCard(title, color, st, extra) {
  return h('section', { class: 'card' },
    h('div', { class: 'stat-head' }, color ? h('span', { class: 'dot', style: `background:${color}` }) : null, title),
    extra ? h('p', { class: 'meta-line' }, extra) : null,
    h('div', { class: 'stat-grid' }, kv('Skott', st.count), kv('Snitt', fmtAvg(st.avg)), kv('10:or', st.tens), kv('X', st.xs)),
    st.shots.length
      ? h('div', { class: 'scores' }, st.shots.map(scoreChip))
      : h('p', { class: 'empty' }, 'Inga skott.'));
}

function viewComparisonDetail(id, back) {
  const c = Store.state.comparisons.find((x) => x.id === id);
  if (!c) return { el: h('div'), mounted: back };
  const stats = comparisonStats(c, Store.state.arrows);
  const varv = c.shots.reduce((m, s) => Math.max(m, s.round), 0);
  let filter = null;

  const board = createBoard({ markerR: 1.1 });
  const chips = h('div', { class: 'chips' });

  function render() {
    chips.textContent = '';
    chips.append(h('button', { class: 'chip' + (filter === null ? ' on' : ''), onclick: () => { filter = null; render(); } }, 'Alla'));
    for (const st of stats) {
      chips.append(h('button', {
        class: 'chip' + (filter === st.arrowId ? ' on' : ''),
        onclick: () => { filter = st.arrowId; render(); }
      }, h('span', { class: 'dot', style: `background:${st.color}` }), `Pil ${st.number}`));
    }
    board.setMarkers(c.shots.filter((s) => filter === null || s.arrowId === filter).map((s) => {
      const st = stats.find((x) => x.arrowId === s.arrowId);
      return { x: s.x, y: s.y, label: s.arrowNumber, color: st ? st.color : MARKER_COLOR };
    }));
  }

  const content = h('main', { class: 'content' },
    h('p', { class: 'meta-line', style: 'margin-top:0' },
      `${fmtDateTime(c.createdAt)} · ${c.shots.length} skott · ${varv} varv`),
    chips,
    board.el,
    stats.map((st) => statsCard(`Pil ${st.number}`, st.color,
      { ...st, shots: c.shots.filter((s) => s.arrowId === st.arrowId) })),
    h('p', null),
    h('button', {
      class: 'btn danger-outline wide',
      onclick: async () => {
        const ok = await confirmDialog('Radera jämförelsen?', 'Jämförelsen och dess skott raderas permanent.', 'Radera', true);
        if (!ok) return;
        await Store.deleteComparison(id);
        toast('Jämförelsen är raderad');
        back();
      }
    }, 'Radera jämförelse'));

  return {
    el: page(bar({ title: 'Jämförelse', left: barBtn('‹ Tillbaka', back) }), content),
    mounted: render
  };
}

function viewArrowStats(selectedId) {
  const arrows = Store.activeArrows();
  const content = h('main', { class: 'content' });
  content.append(arrows.length
    ? h('div', { class: 'chips' }, arrows.map((a) =>
      h('button', { class: 'chip' + (a.id === selectedId ? ' on' : ''), onclick: () => go(viewArrowStats, a.id) }, `Pil ${a.number}`)))
    : h('p', { class: 'empty' }, 'Inga pilar i registret ännu.'));

  const a = arrows.find((x) => x.id === selectedId);
  if (a) {
    const shots = arrowShotsAcross(a.id, Store.state.comparisons);
    const nComps = Store.state.comparisons.filter((c) => c.shots.some((s) => s.arrowId === a.id)).length;
    const board = createBoard({ markerR: 0.8 });
    board.setMarkers(shots.map((s) => ({ x: s.x, y: s.y, color: MARKER_COLOR })));
    content.append(
      statsCard(`Pil ${a.number}`, null, { ...shotStats(shots), shots },
        `Från ${nComps} ${nComps === 1 ? 'jämförelse' : 'jämförelser'}`),
      board.el);
  } else if (arrows.length) {
    content.append(h('p', { class: 'hint' }, 'Välj en pil för att se dess statistik och alla träffar.'));
  }
  return { el: page(bar({ title: 'Statistik per pil', left: barBtn('‹ Tillbaka', () => go(viewCompareHome)) }), content) };
}

/* ==========================================================================
   Start
   ========================================================================== */

function installGestureGuards() {
  // Ingen nypzoom någonstans i appen. Dubbeltryckszoom stängs av med touch-action i CSS.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
}

async function boot() {
  buildTargetFace(document.getElementById('target-face'));
  installGestureGuards();
  window.addEventListener('unhandledrejection', (e) => {
    console.error(e.reason);
    toast('Något gick fel: ' + ((e.reason && e.reason.message) || e.reason));
  });
  try {
    await Store.init();
  } catch (e) {
    $('#app').append(h('p', { style: 'padding:24px' }, 'Kunde inte öppna databasen: ' + e.message));
    return;
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  go(viewHome);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker:', e));
  }
}

window.Bage = {
  ZOOM_WINDOW_FRACTION, ZOOM_VIEW_FRACTION, ARROWS_PER_SERIES, MAX_SET_SIZE,
  scoreForDistance, scoreAt, scoreLabel, zoneOf, makeArrow, seriesTable, seriesScore, shotStats, roundSummary,
  roundsOverview, niceTicks, seriesGrid,
  nextArrowIndex, varvOf, comparisonArrows, comparisonStats, arrowShotsAcross, parseSetNumbers, validateBackup,
  defaultRoundName, buildTargetFace, DB, Store, go, viewHome
};

if (!window.BAGE_TEST) boot();
