/* ============================================================
   pdf.js — a tiny dependency-free PDF writer.

   Only what a calendar needs: filled / stroked rectangles, straight
   lines, and text in the two base-14 Helvetica faces (upright or
   rotated). Coordinates are given with a top-left origin in points;
   the writer flips them to PDF's bottom-left space.

   Loaded before script.js. Exposes window.PdfWriter.
   ============================================================ */

(function (root) {
  'use strict';

  // ---- number formatting (PDF has no exponent notation) ----------------
  function num(v) {
    if (!isFinite(v)) v = 0;
    var r = Math.round(v * 1000) / 1000;
    return String(r);
  }

  function hexToRgb(hex) {
    var m = String(hex || '#000').replace('#', '');
    if (m.length === 3) m = m[0] + m[0] + m[1] + m[1] + m[2] + m[2];
    var n = parseInt(m, 16);
    if (isNaN(n)) n = 0;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  // ---- WinAnsi escape for pdf strings ---------------------------------
  var WINANSI = {
    0x2013: 0x96, 0x2014: 0x97, 0x2018: 0x91, 0x2019: 0x92,
    0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2026: 0x85,
    0x20ac: 0x80,
  };
  function pdfString(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (WINANSI[c] !== undefined) c = WINANSI[c];
      else if (c > 255) c = 63; // '?'
      var ch = String.fromCharCode(c);
      if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
      else out += ch;
    }
    return '(' + out + ')';
  }

  // ---- Helvetica metrics (units / 1000) --------------------------------
  var W_REG = {
    ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667,
    "'": 191, '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333,
    '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584,
    '?': 556, '@': 1015, '[': 278, '\\': 278, ']': 278, '^': 469, '_': 556,
    '`': 333, '{': 334, '|': 260, '}': 334, '~': 584,
    A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
    J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
    S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
    a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
    j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
    s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  };
  var W_BOLD = {
    ' ': 278, '!': 333, '"': 474, '#': 556, '$': 556, '%': 889, '&': 722,
    "'": 238, '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333,
    '.': 278, '/': 278, ':': 333, ';': 333, '<': 584, '=': 584, '>': 584,
    '?': 611, '@': 975, '[': 333, '\\': 278, ']': 333, '^': 584, '_': 556,
    '`': 333, '{': 389, '|': 280, '}': 389, '~': 584,
    A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
    J: 556, K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
    S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
    a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278,
    j: 278, k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389,
    s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
  };
  for (var d = 0; d <= 9; d++) { W_REG[String(d)] = 556; W_BOLD[String(d)] = 556; }

  function textWidth(str, size, bold) {
    var table = bold ? W_BOLD : W_REG;
    var w = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str[i];
      w += (table[c] !== undefined ? table[c] : 556);
    }
    return (w / 1000) * size;
  }

  // ---- a single page's content builder --------------------------------
  function Page(w, h) {
    this.w = w;
    this.h = h;
    // "2 J" = projecting (square) line caps: separate strokes that meet at a
    // corner overlap instead of leaving a notch, so the stepped month
    // boundary joins cleanly.
    this.ops = ['2 J'];
  }
  // top-left y -> PDF y
  Page.prototype._y = function (y) { return this.h - y; };
  Page.prototype._fill = function (hex) {
    var c = hexToRgb(hex);
    this.ops.push(num(c[0]) + ' ' + num(c[1]) + ' ' + num(c[2]) + ' rg');
  };
  Page.prototype._stroke = function (hex) {
    var c = hexToRgb(hex);
    this.ops.push(num(c[0]) + ' ' + num(c[1]) + ' ' + num(c[2]) + ' RG');
  };

  Page.prototype.fillRect = function (x, y, w, h, hex) {
    this._fill(hex);
    this.ops.push(num(x) + ' ' + num(this._y(y + h)) + ' ' + num(w) + ' ' + num(h) + ' re f');
  };

  Page.prototype.line = function (x1, y1, x2, y2, hex, lw) {
    this._stroke(hex);
    this.ops.push(num(lw || 0.2) + ' w');
    this.ops.push(num(x1) + ' ' + num(this._y(y1)) + ' m ' +
      num(x2) + ' ' + num(this._y(y2)) + ' l S');
  };

  // x,y = baseline origin (top-left space). opts: {size, color, bold, rot}
  Page.prototype.text = function (x, y, str, opts) {
    opts = opts || {};
    if (str === '' || str == null) return;
    var size = opts.size || 9;
    var font = opts.bold ? 'F2' : 'F1';
    this._fill(opts.color || '#000000');
    var py = this._y(y);
    var head = 'BT /' + font + ' ' + num(size) + ' Tf ';
    if (!opts.rot) {
      this.ops.push(head + num(x) + ' ' + num(py) + ' Td ' + pdfString(String(str)) + ' Tj ET');
    } else {
      // rot: 90 = reading bottom-to-top
      this.ops.push(head + '0 1 -1 0 ' + num(x) + ' ' + num(py) + ' Tm ' +
        pdfString(String(str)) + ' Tj ET');
    }
  };

  // ---- the document ----------------------------------------------------
  function PdfWriter() { this.pages = []; }
  PdfWriter.prototype.addPage = function (w, h) {
    var p = new Page(w, h);
    this.pages.push(p);
    return p;
  };

  function toBytes(str) {
    var b = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xff;
    return b;
  }

  PdfWriter.prototype.build = function () {
    var objs = [];               // 1-based object bodies (strings/bytes)
    var pageObjNums = [];
    var contentObjNums = [];
    var next = 5;                // 1 catalog, 2 pages, 3 F1, 4 F2

    this.pages.forEach(function (p, i) {
      var pageNum = next++;
      var contentNum = next++;
      pageObjNums.push(pageNum);
      contentObjNums.push(contentNum);
      var content = p.ops.join('\n');
      objs[pageNum] =
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + num(p.w) + ' ' + num(p.h) +
        '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + contentNum + ' 0 R >>';
      objs[contentNum] =
        '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream';
    });

    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[2] = '<< /Type /Pages /Kids [' +
      pageObjNums.map(function (n) { return n + ' 0 R'; }).join(' ') +
      '] /Count ' + pageObjNums.length + ' >>';
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

    var count = next - 1;        // highest object number
    var chunks = [];
    var len = 0;
    var offsets = [];
    function push(s) {
      var b = (typeof s === 'string') ? toBytes(s) : s;
      chunks.push(b);
      len += b.length;
    }

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    for (var i = 1; i <= count; i++) {
      offsets[i] = len;
      push(i + ' 0 obj\n');
      push(objs[i]);
      push('\nendobj\n');
    }
    var xref = len;
    var x = 'xref\n0 ' + (count + 1) + '\n0000000000 65535 f \n';
    for (var j = 1; j <= count; j++) {
      x += ('0000000000' + offsets[j]).slice(-10) + ' 00000 n \n';
    }
    x += 'trailer\n<< /Size ' + (count + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    push(x);

    // flatten
    var out = new Uint8Array(len);
    var pos = 0;
    for (var k = 0; k < chunks.length; k++) { out.set(chunks[k], pos); pos += chunks[k].length; }
    return out;
  };

  PdfWriter.textWidth = textWidth;

  root.PdfWriter = PdfWriter;
})(typeof window !== 'undefined' ? window : globalThis);
