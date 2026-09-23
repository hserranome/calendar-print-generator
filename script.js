/* ============================================================
   Planner Calendar Generator — engine
   Plain JS. Builds the continuous-flow calendar grid as a
   single CSS grid per printed page, with sidebar labels and
   live re-rendering on every settings change.
   ============================================================ */

'use strict';

/* ----------------------------- constants ----------------------------- */

const MONTHS   = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const WEEKDAYS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const FIXED_LEN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const PAPERS = {
  a4:     { w: 210,    h: 297    },
  letter: { w: 215.9,  h: 279.4  },
};

// default palette — soft pastels, one base per quarter, cycled across the
// 12 month slots so every color mode (12 / 4 / 2 pickers) has a full set
const DEFAULT_COLORS = ['#C5EDF4', '#D7DAF2', '#F5D6E5', '#DBFAE0'];
const DEFAULT_PALETTE = Array.from({ length: 12 }, (_, i) => DEFAULT_COLORS[i % DEFAULT_COLORS.length]);
let masterColors = DEFAULT_PALETTE.slice();

const HEADER_H  = 17;   // mm reserved for title + weekday rows
const SIDE_Q    = '7mm';
const SIDE_M    = '9mm';
const SIDE_WK   = '8mm';

// number of visible color pickers depends on the color mode
function paletteSlots() {
  const mode = $('#colorMode').value;
  if (mode === 'month') return 12;
  if (mode === 'quarter' || mode === 'gradient') return 4;
  return 2;
}

/* ------------------------------- helpers ------------------------------ */

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function hexToRgb(hex) {
  const m = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16));
}
function mixHex(hex, amount, target = [255, 255, 255]) {
  const a = hexToRgb(hex);
  const c = a.map((v, i) => Math.round(v + (target[i] - v) * amount));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
function contrast(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.62 ? '#20242b' : '#ffffff';
}
function fmt(v) { return (Math.round(v * 100) / 100).toString(); }
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ------------------------------ palette input --------------------------- */

function normalizeHex(raw) {
  let h = String(raw || '').trim().replace(/^#/, '').toUpperCase();
  if (/^[0-9A-F]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
  return /^[0-9A-F]{6}$/.test(h) ? '#' + h : null;
}

// set the internal 12-slot master palette (cycling short arrays), rebuild
// the visible pickers and re-render
function setMaster(colors, keepColors) {
  for (let i = 0; i < 12; i++) {
    masterColors[i] = normalizeHex(colors[i % colors.length]) || masterColors[i];
  }
  if (!keepColors) {
    buildPaletteUI();
    render();
  }
}

/* --------------------------- state + UI config ------------------------- */

function readState() {
  const paper = PAPERS[$('#paper').value];
  const landscape = $('#orient').value === 'landscape';

  const monthColors = masterColors; // always 12 slots; pickers mirror a subset
  const mode = $('#colorMode').value;
  const colorOf = [];
  for (let m = 0; m < 12; m++) {
    if (mode === 'quarter') colorOf[m] = monthColors[Math.floor(m / 3) % 12];
    else if (mode === 'alternate') colorOf[m] = monthColors[m % 2];
    else if (mode === 'gradient') {
      // one base color per quarter; 1st month = exact base, the rest fade lighter
      const base = monthColors[Math.floor(m / 3) % 4];
      const step = [0, 0.45, 0.75][m % 3]; // base → lighter → lightest
      colorOf[m] = step === 0 ? base : mixHex(base, step);
    }
    else colorOf[m] = monthColors[m % 12];
  }

  return {
    mode: $('#mode').value,
    year: Math.max(1900, Math.min(2200, parseInt($('#year').value, 10) || 2026)),
    weekStart: document.querySelector('input[name="ws"]:checked').value === 'mon' ? 1 : 0,
    headerTitle: $('#headerTitle').value.trim(),
    showWeeks: $('#showWeeks').checked,
    showQuarters: $('#showQuarters').checked,
    showEvents: $('#showEvents').checked,
    eventsText: $('#events').value,
    colorOf,
    split: parseInt($('#split').value, 10) || 1,
    repeatHeader: $('#repeatHeader').checked,
    paperW: landscape ? paper.h : paper.w,
    paperH: landscape ? paper.w : paper.h,
    mt: n('#mt'), mr: n('#mr'), mb: n('#mb'), ml: n('#ml'),
    autoFit: $('#autoFit').checked,
    cellH: n('#cellH'),
    cellPad: n('#cellPad'),
  };
}
function n(sel) { return parseFloat($(sel).value) || 0; }

/* ------------------------------ calendar model -------------------------
   Produces a flat list of rows. Each row: { weekNo, cells: [7], primaryMonth }
   A cell is { month, day }  (month 0-11) or null for an empty slot.
   ---------------------------------------------------------------------- */

function daysInMonth(year, m) {
  return m === 1 && ((year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0))
    ? 29 : FIXED_LEN[m];
}

function buildModel(s) {
  const rows = [];

  if (s.mode === 'year') {
    // Real year: continuous flow — a month continues on the row of the next.
    const offset = (new Date(s.year, 0, 1).getDay() - s.weekStart + 7) % 7;
    const flat = new Array(offset).fill(null);
    for (let m = 0; m < 12; m++) {
      const len = daysInMonth(s.year, m);
      for (let d = 1; d <= len; d++) flat.push({ month: m, day: d });
    }
    while (flat.length % 7) flat.push(null);
    for (let i = 0; i < flat.length; i += 7) {
      rows.push(makeRow(flat.slice(i, i + 7), rows.length + 1));
    }
  } else {
    // Generic template: the days of the week are unknown (undated planner),
    // so every month starts at column 0 with day 1 — no leading blanks, no
    // weekday semantics. The same fixed pattern every year → reusable.
    let week = 1;
    for (let m = 0; m < 12; m++) {
      const flat = [];
      for (let d = 1; d <= FIXED_LEN[m]; d++) flat.push({ month: m, day: d });
      while (flat.length % 7) flat.push(null);
      for (let i = 0; i < flat.length; i += 7) {
        rows.push(makeRow(flat.slice(i, i + 7), week++));
      }
    }
  }
  return rows;
}

function makeRow(cells, weekNo) {
  const first = cells.find((c) => c) || null;
  return { cells, weekNo, primaryMonth: first ? first.month : null };
}

/* ------------------------------ page split ----------------------------- */

function splitPages(rows, split) {
  if (split === 1) return [rows];
  const cutAt = split === 2 ? [6] : [3, 6, 9]; // months that start a new page
  const pages = [];
  let cur = [];
  let prevHadCut = false;
  for (const row of rows) {
    const hasCut = row.cells.some((c) => c && cutAt.includes(c.month));
    // cut before the first row of the new block (transition only)
    if (hasCut && !prevHadCut && cur.length) {
      pages.push(cur);
      cur = [];
    }
    prevHadCut = hasCut;
    cur.push(row);
  }
  if (cur.length) pages.push(cur);
  return pages;
}

/* ------------------------------- events -------------------------------- */

function parseEvents(text) {
  const map = {};
  text.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[,;:\t]\s*(.+?)\s*$/);
    if (!m) return;
    const key = (parseInt(m[1], 10) - 1) + '-' + parseInt(m[2], 10);
    (map[key] = map[key] || []).push(m[3]);
  });
  return map;
}

/* ------------------------------ ranges on a page ------------------------
   For a page's rows (subset of the full year), compute the contiguous row
   spans of each month / quarter, using each row's primary month. Contiguous
   and non-overlapping → safe for CSS grid row spans.
   ---------------------------------------------------------------------- */

function spansOf(rows, gridRowBase) {
  const months = [];
  const quarters = [];
  let lastQ = null;

  for (let r = 0; r < rows.length; r++) {
    const pm = rows[r].primaryMonth;
    if (pm === null) continue;

    const q = Math.floor(pm / 3);
    if (lastQ !== q) {
      if (lastQ !== null) quarters[quarters.length - 1].end = gridRowBase + r;
      quarters.push({ q, start: gridRowBase + r, end: gridRowBase + r + 1 });
      lastQ = q;
    } else {
      quarters[quarters.length - 1].end = gridRowBase + r + 1;
    }
  }

  // months: group rows by primary month (monotonic)
  let lastM = null;
  for (let r = 0; r < rows.length; r++) {
    const pm = rows[r].primaryMonth;
    if (pm === null) continue;
    if (lastM !== pm) {
      months.push({ m: pm, start: gridRowBase + r, end: gridRowBase + r + 1 });
      lastM = pm;
    } else {
      months[months.length - 1].end = gridRowBase + r + 1;
    }
  }

  // extend the final spans to the bottom of the page (covers trailing blanks)
  const bottom = gridRowBase + rows.length;
  if (quarters.length) quarters[quarters.length - 1].end = bottom;
  if (months.length) months[months.length - 1].end = bottom;

  return { months, quarters };
}

/* ------------------------------- rendering ------------------------------ */

function render() {
  const s = readState();
  const rows = buildModel(s);
  const pages = splitPages(rows, s.split);
  const events = s.showEvents ? parseEvents(s.eventsText) : {};

  // auto-fit: compute a cell height so every page fits. Pages with a header
  // (first page, or all pages when "repeat header" is on) have less vertical
  // room than headerless pages, so take the strictest fit across pages.
  const headerH = s.mode === 'generic' ? 13 : HEADER_H;
  const fitPerRow = pages.map((p, i) => {
    const hh = (i === 0 || s.repeatHeader) ? headerH : 0;
    return (s.paperH - s.mt - s.mb - hh) / p.length;
  });
  const cellH = s.autoFit
    ? Math.max(2.5, Math.floor(Math.min.apply(null, fitPerRow) * 100) / 100)
    : s.cellH;

  const root = $('#pages');
  root.innerHTML = '';

  // base page CSS vars
  const baseVars = {
    '--paper-w': s.paperW + 'mm',
    '--paper-h': s.paperH + 'mm',
    '--mt': s.mt + 'mm', '--mr': s.mr + 'mm',
    '--mb': s.mb + 'mm', '--ml': s.ml + 'mm',
    '--cell-h': cellH + 'mm',
    '--cell-pad': s.cellPad + 'mm',
    '--head-h': HEADER_H + 'mm',
    // disabled sidebar columns collapse to 0 so the day columns take the space
    '--w-q': s.showQuarters ? SIDE_Q : '0mm',
    '--w-m': SIDE_M,
    '--w-wk': s.showWeeks ? SIDE_WK : '0mm',
  };

  const title = s.headerTitle
    || (s.mode === 'year' ? String(s.year) : 'PLANNER');

  pages.forEach((pageRows, pi) => {
    const page = document.createElement('div');
    page.className = 'page';

    for (const [k, v] of Object.entries(baseVars)) page.style.setProperty(k, v);
    for (let i = 0; i < 12; i++) {
      const c = s.colorOf[i];
      page.style.setProperty('--c' + i, c);
      page.style.setProperty('--c' + i + 't', mixHex(c, 0.16));
      page.style.setProperty('--c' + i + 'x', contrast(c));
    }
    // header only appears on the first page (or on every page when the
    // "repeat header" option is enabled)
    const hasWeekdays = s.mode === 'year';
    const hasHeader = pi === 0 || s.repeatHeader;
    const gridRowBase = hasHeader ? (hasWeekdays ? 3 : 2) : 1;
    page.style.gridTemplateRows =
      (hasHeader ? (hasWeekdays ? 'auto auto ' : 'auto ') : '') +
      'repeat(' + pageRows.length + ', var(--cell-h))';

    if (hasHeader) {
      // ---- title bar ----
      const head = document.createElement('div');
      head.className = 'head-title';
      head.innerHTML =
        '<span class="t-main">' + esc(title) + '</span>' +
        '<span class="t-sub">Year at a glance</span>' +
        (pages.length > 1 ? '<span class="t-page">' +
          (s.split === 2 ? (pi === 0 ? 'Jan – Jun' : 'Jul – Dec') : 'Q' + (pi + 1)) +
          '</span>' : '');
      page.appendChild(head);

      // weekday labels + sidebar header row (real dates only — in generic mode
      // the days of the week are unknown, so there is no weekday header)
      if (hasWeekdays) {
        for (let c = 0; c < 3; c++) {
          const h = document.createElement('div');
          h.className = 'head-cell' + (c === 2 && s.showWeeks ? ' wk' : '');
          h.textContent = c === 2 && s.showWeeks ? 'WK' : '';
          page.appendChild(h);
        }
        for (let d = 0; d < 7; d++) {
          const wd = document.createElement('div');
          wd.className = 'head-cell wd' + (d === 0 ? ' col0' : '');
          wd.textContent = WEEKDAYS[(d + s.weekStart) % 7];
          page.appendChild(wd);
        }
      }
    }

    // sidebar spans
    const { months, quarters } = spansOf(pageRows, gridRowBase);

    if (s.showQuarters && quarters.length) {
      const el = document.createElement('div');
      el.className = 'q-cell s' + (quarters[0].q * 3) % 12;
      el.style.gridColumn = '1';
      el.style.gridRow = quarters[0].start + ' / ' + quarters[0].end;
      el.innerHTML = '<span>' + esc('Q' + (quarters[0].q + 1)) + '</span>';
      page.appendChild(el);
      for (let i = 1; i < quarters.length; i++) {
        const ex = el.cloneNode(true);
        ex.className = 'q-cell s' + (quarters[i].q * 3) % 12;
        ex.style.gridRow = quarters[i].start + ' / ' + quarters[i].end;
        ex.innerHTML = '<span>' + esc('Q' + (quarters[i].q + 1)) + '</span>';
        page.appendChild(ex);
      }
    }

    if (months.length) {
      months.forEach((sp) => {
        const el = document.createElement('div');
        el.className = 'm-cell s' + (sp.m % 12);
        el.style.gridColumn = '2';
        el.style.gridRow = sp.start + ' / ' + sp.end;
        el.innerHTML = '<span>' + esc(MONTHS[sp.m]) + '</span>';
        page.appendChild(el);
      });
    }

    // body rows
    pageRows.forEach((row, r) => {
      const gRow = gridRowBase + r;

      if (s.showWeeks) {
        const wk = document.createElement('div');
        wk.className = 'wk-cell';
        wk.style.gridColumn = '3';
        wk.style.gridRow = gRow;
        wk.textContent = String(row.weekNo);
        page.appendChild(wk);
      }

      row.cells.forEach((cell, d) => {
        const el = document.createElement('div');
        const col = 4 + d;
        el.style.gridColumn = String(col);
        el.style.gridRow = String(gRow);
        if (!cell) {
          // col0: boundary cells keep the separator between sidebar and days
          el.className = 'day blank' + (d === 0 ? ' col0' : '');
          page.appendChild(el);
          return;
        }
        let cls = 'day t' + (cell.month % 12);
        if (hasWeekdays && ((d + s.weekStart) % 7 === 0 || (d + s.weekStart) % 7 === 6)) {
          cls += ' weekend';
        }
        if (d === 0) cls += ' col0';
        el.className = cls;
        el.innerHTML = '<span class="dnum">' + cell.day + '</span>';
        const key = cell.month + '-' + cell.day;
        const evts = events[key];
        if (evts && evts.length) {
          const box = document.createElement('div');
          box.className = 'evts';
          evts.forEach((label) => {
            const b = document.createElement('span');
            b.className = 'evt';
            b.textContent = label;
            box.appendChild(b);
          });
          el.appendChild(box);
        }
        page.appendChild(el);
      });
    });

    root.appendChild(page);
  });

  updatePrintStyle(s);
  $('#status').textContent =
    pages.length + ' page' + (pages.length > 1 ? 's' : '') +
    ' · ' + rows.length + ' week rows · cell ' + fmt(cellH) + ' mm';
}

/* --------------------------- print / paper css -------------------------- */

function updatePrintStyle(s) {
  const sheet = $('#print-style');
  sheet.textContent =
    '@page { size: ' + fmt(s.paperW) + 'mm ' + fmt(s.paperH) + 'mm;' +
    ' margin: ' + fmt(s.mt) + 'mm ' + fmt(s.mr) + 'mm ' +
    fmt(s.mb) + 'mm ' + fmt(s.ml) + 'mm; }';
}

/* ------------------------------ UI wiring ------------------------------- */

function buildPaletteUI() {
  const wrap = $('#palette');
  wrap.innerHTML = '';
  // visible pickers mirror the master palette; count depends on color mode.
  // each picker is a row: color swatch + editable hex field.
  const n = paletteSlots();
  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.className = 'swatch-row';

    const swatch = document.createElement('input');
    swatch.type = 'color';
    swatch.value = masterColors[i];
    swatch.dataset.i = i;
    swatch.title = 'Color ' + (i + 1);
    swatch.addEventListener('input', () => {
      masterColors[i] = normalizeHex(swatch.value) || masterColors[i];
      hexIn.value = masterColors[i];
    });

    const hexIn = document.createElement('input');
    hexIn.type = 'text';
    hexIn.className = 'hex-input';
    hexIn.spellcheck = false;
    hexIn.value = masterColors[i];
    hexIn.dataset.i = i;
    hexIn.addEventListener('input', () => {
      const norm = normalizeHex(hexIn.value);
      if (norm) {
        masterColors[i] = norm;
        swatch.value = norm;
        hexIn.classList.remove('invalid');
      } else {
        hexIn.classList.add('invalid');
      }
    });
    hexIn.addEventListener('blur', () => {
      hexIn.value = masterColors[i];
      hexIn.classList.remove('invalid');
    });

    row.appendChild(swatch);
    row.appendChild(hexIn);
    wrap.appendChild(row);
  }
}

function wireUI() {
  const panel = $('#panel');
  const rerender = () => render();
  panel.addEventListener('input', rerender);
  panel.addEventListener('change', rerender);

  // year field + week-start only meaningful in 'year' mode
  function applyModeUI() {
    const generic = $('#mode').value === 'generic';
    $('#yearField').style.display = generic ? 'none' : 'block';
    $('#weekStartField').style.display = generic ? 'none' : 'block';
  }
  $('#mode').addEventListener('change', () => {
    applyModeUI();
    render();
  });
  applyModeUI();

  // palette is rebuilt when the color mode changes the number of pickers
  $('#colorMode').addEventListener('change', () => {
    buildPaletteUI();
    render();
  });

  $('#printBtn').addEventListener('click', () => window.print());

  $('#zoom').addEventListener('input', (e) => {
    $('.pages').style.zoom = e.target.value;
  });

  $('#cellH').addEventListener('input', (e) => {
    $('#cellHOut').textContent = e.target.value + ' mm';
  });
  $('#cellPad').addEventListener('input', (e) => {
    $('#cellPadOut').textContent = e.target.value + ' mm';
  });
}

/* --------------------------------- init -------------------------------- */

buildPaletteUI();
wireUI();
render();