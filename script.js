/* ============================================================
   Planner Calendar Generator — engine
   Plain JS. Builds the continuous-flow calendar grid, then draws
   it into a real PDF (no dependencies) that the browser's own PDF
   viewer shows on the right. What you see is what Download/Print
   produce.
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

const HEADER_H = 17;      // mm reserved for title + weekday rows (auto-fit)
const SIDE_W   = { q: 7, m: 9, wk: 8 };   // sidebar column widths in mm
const TITLE_H  = 11.5;    // title band height (mm)
const TITLE_GAP = 1;      // gap under the title rule (mm)
const WD_H     = 4.5;     // weekday header band height (mm)

const PT = 72 / 25.4;     // points per millimetre

const C_GRID   = '#b9c2cc';
const C_STRONG = '#2b3038';
const C_NUM    = '#1d222a';
const C_NUM_WK = '#4a525d';

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

/* ------------------------------ palette input --------------------------- */

function normalizeHex(raw) {
  let h = String(raw || '').trim().replace(/^#/, '').toUpperCase();
  if (/^[0-9A-F]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
  return /^[0-9A-F]{6}$/.test(h) ? '#' + h : null;
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
    subtitle: $('#subtitle').value.trim(),
    showWeeks: $('#showWeeks').checked,
    showQuarters: $('#showQuarters').checked,
    showMonthLines: $('#showMonthLines').checked,
    showOutOfRange: $('#showOutOfRange').checked,
    showEvents: $('#showEvents').checked,
    eventsText: $('#events').value,
    colorOf,
    split: parseInt($('#split').value, 10) || 1,
    repeatHeader: $('#repeatHeader').checked,
    showRange: $('#showRange').checked,
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
   Produces a flat list of rows -> { weekNo, cells: [7] }.
   A cell is { month, day } (month 0-11) or null for an empty slot.
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
    const flat = [];

    // days before Jan 1 (previous December) — shown greyed when enabled
    for (let i = offset; i >= 1; i--) {
      const dt = new Date(s.year, 0, 1 - i);
      flat.push(s.showOutOfRange
        ? { month: dt.getMonth(), day: dt.getDate(), out: true }
        : null);
    }
    for (let m = 0; m < 12; m++) {
      const len = daysInMonth(s.year, m);
      for (let d = 1; d <= len; d++) flat.push({ month: m, day: d });
    }
    // days after Dec 31 (next January)
    let j = 1;
    while (flat.length % 7) {
      flat.push(s.showOutOfRange ? { month: 0, day: j, out: true } : null);
      j++;
    }
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
  return { cells, weekNo };
}

/* ------------------------------ page split ----------------------------- */

function splitPages(rows, split) {
  if (split === 1) return [rows];
  const cutAt = split === 2 ? [6] : [3, 6, 9]; // months that start a new page
  const pages = [];
  let cur = [];
  let prevHadCut = false;
  for (const row of rows) {
    const hasCut = row.cells.some((c) => c && !c.out && cutAt.includes(c.month));
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
   For a page's rows compute the contiguous spans of each month / quarter.
   A month's block begins on the grid row that holds its day 1, so the
   sidebar dividers line up with the stepped boundary in the day grid.
   ---------------------------------------------------------------------- */

function spansOf(rows, gridRowBase) {
  const bottom = gridRowBase + rows.length;

  const startRow = {};   // month -> grid row of its day 1
  const order = [];      // months in order of first appearance on this page
  const seen = new Set();

  rows.forEach((row, r) => {
    row.cells.forEach((c) => {
      if (!c || c.out) return;
      if (!seen.has(c.month)) { seen.add(c.month); order.push(c.month); }
      if (c.day === 1 && startRow[c.month] === undefined) {
        startRow[c.month] = gridRowBase + r;
      }
    });
  });

  const months = order.map((m, i) => {
    const next = order[i + 1];
    const start = startRow[m] !== undefined
      ? startRow[m]
      : (i === 0 ? gridRowBase : bottom);
    const end = next !== undefined && startRow[next] !== undefined
      ? startRow[next]
      : bottom;
    return { m, start, end };
  });

  // quarters are derived from the (contiguous) month spans
  const quarters = [];
  months.forEach((sp) => {
    const q = Math.floor(sp.m / 3);
    const last = quarters[quarters.length - 1];
    if (last && last.q === q) last.end = sp.end;
    else quarters.push({ q, start: sp.start, end: sp.end });
  });

  return { months, quarters };
}

/* ------------------------------- rendering ------------------------------ */

// auto-fit: pick a cell height so every page fits. Pages that carry a header
// (the first page, or all pages when "repeat header" is on) have less vertical
// room, so take the strictest fit across pages.
function computeCellH(s, pages) {
  const headerH = s.mode === 'generic' ? 13 : HEADER_H;
  const fitPerRow = pages.map((p, i) => {
    const hh = (i === 0 || s.repeatHeader) ? headerH : 0;
    return (s.paperH - s.mt - s.mb - hh) / p.length;
  });
  return s.autoFit
    ? Math.max(2.5, Math.floor(Math.min.apply(null, fitPerRow) * 100) / 100)
    : s.cellH;
}

function render() {
  const s = readState();
  const rows = buildModel(s);
  const pages = splitPages(rows, s.split);
  const cellH = computeCellH(s, pages);

  schedulePreview(s, pages, cellH);
}

/* ------------------------------ PDF preview -----------------------------
   The pane on the right is a genuine PDF. We build the bytes in the browser
   and hand them to the embedded viewer, so the preview, Download and Print
   all use exactly the same file.
   ---------------------------------------------------------------------- */

let pdfUrl = null;
let pdfName = 'calendar.pdf';
let previewTimer = null;

function schedulePreview(s, pages, cellH) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => buildPreview(s, pages, cellH), 180);
}

function buildPreview(s, pages, cellH) {
  let url;
  try {
    const bytes = buildPdf(s, pages, cellH);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    url = URL.createObjectURL(blob);
  } catch (err) {
    console.error('PDF build failed', err);
    return;
  }
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  pdfUrl = url;
  pdfName = (s.headerTitle ? s.headerTitle.replace(/[^\w.-]+/g, '_') : 'calendar') + '.pdf';

  $('#pdfPreview').src = url;
}

function downloadPdf() {
  if (!pdfUrl) return;
  const a = document.createElement('a');
  a.href = pdfUrl;
  a.download = pdfName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function printPdf() {
  const frame = $('#pdfPreview');
  try {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  } catch (e) {
    if (pdfUrl) window.open(pdfUrl, '_blank');
  }
}

/* ------------------------------ PDF layout ------------------------------ */

function buildPdf(s, pages, cellH) {
  const doc = new PdfWriter();
  const events = s.showEvents ? parseEvents(s.eventsText) : {};
  pages.forEach((pageRows, pi) => drawPage(doc, s, pageRows, pi, pages, cellH, events));
  return doc.build();
}

function drawPage(doc, s, pageRows, pi, pages, cellH, events) {
  const page = doc.addPage(s.paperW * PT, s.paperH * PT);

  const x0 = s.ml;
  const gridW = s.paperW - s.ml - s.mr;
  const gridX2 = x0 + gridW;
  const hasWeekdays = s.mode === 'year';
  const hasHeader = pi === 0 || s.repeatHeader;

  // columns: quarter | month | week | 7 day columns
  const wq = s.showQuarters ? SIDE_W.q : 0;
  const wm = SIDE_W.m;
  const wwk = s.showWeeks ? SIDE_W.wk : 0;
  const dayW = (gridW - wq - wm - wwk) / 7;
  const colX = [x0, x0 + wq, x0 + wq + wm, x0 + wq + wm + wwk];
  for (let d = 1; d <= 7; d++) colX[3 + d] = colX[3] + d * dayW;

  const headerH = hasHeader ? (TITLE_H + TITLE_GAP + (hasWeekdays ? WD_H : 0)) : 0;
  const bodyTop = s.mt + headerH;
  const bodyBottom = bodyTop + pageRows.length * cellH;

  const gridRowBase = hasHeader ? (hasWeekdays ? 3 : 2) : 1;
  const yLine = (k) => bodyTop + (k - gridRowBase) * cellH;   // grid line -> mm y

  const mm = (v) => v * PT;
  const rectFill = (x, y, w, h, c) => page.fillRect(mm(x), mm(y), mm(w), mm(h), c);
  const line = (x1, y1, x2, y2, c, lw) =>
    page.line(mm(x1), mm(y1), mm(x2), mm(y2), c, mm(lw == null ? 0.2 : lw));

  // text anchored at (x,y) in mm; y is the baseline. align: left|center|right
  function text(x, y, str, o) {
    o = o || {};
    const sizeMm = o.mm || 3;
    const sizePt = sizeMm * PT;
    const w = PdfWriter.textWidth(str, sizePt, !!o.bold) / PT; // mm
    let px = x;
    if (o.align === 'center') px = x - w / 2;
    else if (o.align === 'right') px = x - w;
    page.text(px * PT, y * PT, str, { size: sizePt, color: o.color, bold: !!o.bold });
  }

  // rotated (bottom-to-top) text, centred on x within the cell
  function textV(cx, yBottom, str, o) {
    o = o || {};
    const sizeMm = o.mm || 3;
    page.text((cx + sizeMm * 0.34) * PT, yBottom * PT, str,
      { size: sizeMm * PT, color: o.color, bold: !!o.bold, rot: 90 });
  }

  /* ---- header: title + weekday band ---- */
  if (hasHeader) {
    const baseline = s.mt + 8.4;
    let tx = x0;
    if (s.headerTitle) {
      text(x0, baseline, s.headerTitle, { mm: 9, bold: true, color: '#14171c' });
      tx = x0 + PdfWriter.textWidth(s.headerTitle, 9 * PT, true) / PT + 6;
    }
    if (s.subtitle) text(tx, baseline, s.subtitle, { mm: 3, color: '#5b6470' });
    if (pages.length > 1 && s.showRange) {
      const label = s.split === 2 ? (pi === 0 ? 'Jan – Jun' : 'Jul – Dec') : 'Q' + (pi + 1);
      text(gridX2, baseline, label, { mm: 3, color: '#5b6470', align: 'right' });
    }
    line(x0, s.mt + TITLE_H, gridX2, s.mt + TITLE_H, C_STRONG, 0.6);

    if (hasWeekdays) {
      const wdTop = s.mt + TITLE_H + TITLE_GAP;
      const wdBot = wdTop + WD_H;
      const wdMid = wdTop + WD_H / 2 + 1.0;
      for (let d = 0; d < 7; d++) {
        text(colX[3 + d] + dayW / 2, wdMid, WEEKDAYS[(d + s.weekStart) % 7],
          { mm: 2.8, bold: true, color: '#49505a', align: 'center' });
      }
      if (s.showWeeks) {
        text(colX[2] + wwk / 2, wdTop + WD_H / 2 + 0.85, 'WK',
          { mm: 2.4, color: '#49505a', align: 'center' });
      }
      line(x0, wdBot, gridX2, wdBot, C_STRONG, 0.35);
      for (let d = 1; d <= 7; d++) {
        line(colX[3 + d], wdTop, colX[3 + d], wdBot, C_GRID, 0.2);
      }
      line(colX[3], wdTop, colX[3], wdBot, C_STRONG, 0.35); // sidebar | days
    }
  }
  // close the top of the grid
  line(x0, bodyTop, gridX2, bodyTop, C_STRONG, 0.35);

  /* ---- sidebar spans ---- */
  const { months, quarters } = spansOf(pageRows, gridRowBase);
  const monthStartRows = new Set(s.showMonthLines ? months.slice(1).map((sp) => sp.start) : []);

  if (s.showQuarters) {
    quarters.forEach((sp, i) => {
      const y = yLine(sp.start);
      const h = yLine(sp.end) - y;
      const col = s.colorOf[(sp.q * 3) % 12];
      rectFill(colX[0], y, wq, h, col);
      text(colX[0] + wq / 2, y + h / 2 + 0.9, 'Q' + (sp.q + 1),
        { mm: 2.6, bold: true, color: contrast(col), align: 'center' });
      line(colX[1], y, colX[1], y + h, C_GRID, 0.2);
      line(colX[0], y + h, colX[1], y + h, C_GRID, 0.2);
      if (i > 0 && monthStartRows.has(sp.start)) line(colX[0], y, colX[1], y, C_STRONG, 0.5);
    });
  }

  months.forEach((sp) => {
    const y = yLine(sp.start);
    const h = yLine(sp.end) - y;
    const col = s.colorOf[sp.m % 12];
    const label = MONTHS[sp.m];
    const tw = PdfWriter.textWidth(label, 3.2 * PT, true) / PT; // mm
    rectFill(colX[1], y, wm, h, col);
    textV(colX[1] + wm / 2, y + h / 2 + tw / 2, label, { mm: 3.2, bold: true, color: contrast(col) });
    line(colX[2], y, colX[2], y + h, C_GRID, 0.2);
    line(colX[1], y + h, colX[2], y + h, C_GRID, 0.2);
    if (monthStartRows.has(sp.start)) line(colX[1], y, colX[2], y, C_STRONG, 0.5);
  });

  /* ---- week-number column ---- */
  if (s.showWeeks) {
    pageRows.forEach((row, r) => {
      const y = bodyTop + r * cellH;
      const gRow = gridRowBase + r;
      text(colX[2] + wwk / 2, y + cellH / 2 + 0.7, String(row.weekNo),
        { mm: 2.2, color: '#6a727d', align: 'center' });
      line(colX[2], y + cellH, colX[3], y + cellH, C_GRID, 0.2);
      if (monthStartRows.has(gRow)) line(colX[2], y, colX[3], y, C_STRONG, 0.5);
    });
  }

  /* ---- day grid ---- */
  pageRows.forEach((row, r) => {
    const y = bodyTop + r * cellH;
    row.cells.forEach((cell, d) => {
      const x = colX[3 + d];
      const weekend = hasWeekdays &&
        ((d + s.weekStart) % 7 === 0 || (d + s.weekStart) % 7 === 6);

      let bg = '#ffffff';
      if (cell && !cell.out) {
        bg = mixHex(s.colorOf[cell.month % 12], 0.16);
        if (weekend) bg = mixHex(bg, 0.045, [0, 0, 0]);
      } else if (cell && cell.out) {
        bg = '#f4f5f7';
      }
      rectFill(x, y, dayW, cellH, bg);

      // right + bottom borders (shared edges, drawn per cell)
      line(x + dayW, y, x + dayW, y + cellH, C_GRID, 0.2);
      line(x, y + cellH, x + dayW, y + cellH, C_GRID, 0.2);

      // left edge: heavier where a new month starts mid-row, else the strong
      // sidebar/day divider on the first column
      const left = d > 0 ? row.cells[d - 1] : null;
      if (cell && s.showMonthLines && left && left.month !== cell.month) {
        line(x, y, x, y + cellH, C_STRONG, 0.5);
      } else if (d === 0) {
        line(x, y, x, y + cellH, C_STRONG, 0.35);
      }

      // top edge: heavier where the cell above belongs to another month
      if (cell) {
        const above = r > 0 ? pageRows[r - 1].cells[d] : undefined;
        if (s.showMonthLines && (above === null || (above && above.month !== cell.month))) {
          line(x, y, x + dayW, y, C_STRONG, 0.5);
        }
      }

      if (!cell) return;

      const pad = s.cellPad;
      const numColor = cell.out ? '#9aa3ad' : (weekend ? C_NUM_WK : C_NUM);
      text(x + pad, y + pad + 2.0, String(cell.day),
        { mm: 2.7, bold: true, color: numColor });

      if (cell.out) return; // out-of-range days carry no events

      const evts = events[cell.month + '-' + cell.day];
      if (evts && evts.length) {
        let ey = y + pad + 2.5;
        const maxW = dayW - pad * 2;
        evts.forEach((label) => {
          if (ey + 2.6 > y + cellH) return;
          rectFill(x + pad, ey, maxW, 2.6, mixHex(bg, 0.82, [20, 25, 33]));
          let t = label;
          while (t.length > 1 && PdfWriter.textWidth(t, 1.9 * PT, true) / PT > maxW - 1.2) {
            t = t.slice(0, -1);
          }
          text(x + pad + 0.6, ey + 1.85, t, { mm: 1.9, bold: true, color: '#ffffff' });
          ey += 2.9;
        });
      }
    });
  });
}

/* --------------------------- settings persistence -----------------------
   The whole panel is plain form controls, so we snapshot every field into a
   flat JSON object (keyed by id, radios by name) plus the master palette,
   and restore it on load. Versioned so a future schema change can be ignored
   instead of crashing.
   ---------------------------------------------------------------------- */

const STORAGE_KEY = 'planner-calendar:v1';

function collectFormState() {
  const data = {};
  $$('#panel input, #panel select, #panel textarea').forEach((el) => {
    if (el.type === 'radio') {
      if (el.checked) data['radio:' + el.name] = el.value;
      return;
    }
    if (!el.id) return; // palette swatch / hex inputs are stored below
    data[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  data.__colors = masterColors.slice();
  return data;
}

function applyFormState(data) {
  if (!data || typeof data !== 'object') return;
  $$('#panel input, #panel select, #panel textarea').forEach((el) => {
    if (el.type === 'radio') {
      const saved = data['radio:' + el.name];
      if (saved !== undefined) el.checked = el.value === saved;
      return;
    }
    if (!el.id || !(el.id in data)) return;
    if (el.type === 'checkbox') el.checked = !!data[el.id];
    else el.value = data[el.id];
  });
  if (Array.isArray(data.__colors) && data.__colors.length === 12) {
    for (let i = 0; i < 12; i++) {
      masterColors[i] = normalizeHex(data.__colors[i]) || masterColors[i];
    }
  }
}

let saveTimer = null;
let suppressSave = false; // set while resetting so pagehide doesn't re-save
function flushFormState() {
  if (suppressSave) return;
  clearTimeout(saveTimer);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collectFormState())); }
  catch (e) { /* storage unavailable (private mode / quota) — ignore */ }
}
function saveFormState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushFormState, 150);
}

function loadFormState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) applyFormState(JSON.parse(raw));
  } catch (e) { /* corrupt or unreadable — fall back to defaults */ }
}

function resetFormState() {
  suppressSave = true;
  clearTimeout(saveTimer);
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  location.reload();
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
  const rerender = () => { render(); saveFormState(); };
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

  $('#downloadBtn').addEventListener('click', downloadPdf);
  $('#printBtn').addEventListener('click', printPdf);
  $('#resetBtn').addEventListener('click', resetFormState);

  // make sure a pending (debounced) save is written before the tab goes away
  window.addEventListener('pagehide', flushFormState);

  $('#cellH').addEventListener('input', (e) => {
    $('#cellHOut').textContent = e.target.value + ' mm';
  });
  $('#cellPad').addEventListener('input', (e) => {
    $('#cellPadOut').textContent = e.target.value + ' mm';
  });
}

/* --------------------------------- init -------------------------------- */

loadFormState();
buildPaletteUI();
wireUI();
render();
