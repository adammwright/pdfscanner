// ─── PDF.js setup ────────────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';


// ─── Keywords ────────────────────────────────────────────────────────────────

const DEFAULT_KEYWORDS = [
  'tibet',
  'dalai lama',
  'communism',
  'communist',
  'soviet',
  'hong kong',
  'taiwan',
  'christianity',
  'judaism',
  'mormon church',
  "jehovah's witnesses",
  'hinduism',
  'sikhism',
  'jainism',
  "bahá'í faith",
  'zoroastrianism',
  'manichaeism',
  'shinto',
  'cheondoism',
  'caidaism',
  'wicca',
];

let keywords = loadKeywords();

function loadKeywords() {
  try {
    const saved = localStorage.getItem('pdfscanner-keywords');
    if (saved) return JSON.parse(saved);
  } catch (_) {}
  return [...DEFAULT_KEYWORDS];
}

function saveKeywords() {
  localStorage.setItem('pdfscanner-keywords', JSON.stringify(keywords));
}

function renderKeywords() {
  const container = document.getElementById('keywordTags');
  container.innerHTML = '';
  keywords.forEach(kw => {
    const tag = document.createElement('span');
    tag.className = 'kw-tag';
    tag.innerHTML =
      `${escapeHtml(kw)} <button onclick="removeKeyword('${escapeHtml(kw).replace(/'/g, "\\'")}')">×</button>`;
    container.appendChild(tag);
  });
}

function addKeyword() {
  const input = document.getElementById('keywordInput');
  const val = input.value.trim().toLowerCase();
  if (val && !keywords.includes(val)) {
    keywords.push(val);
    saveKeywords();
    renderKeywords();
  }
  input.value = '';
  input.focus();
}

function removeKeyword(kw) {
  keywords = keywords.filter(k => k !== kw);
  saveKeywords();
  renderKeywords();
}

document.getElementById('keywordInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') addKeyword();
});


// ─── File upload ─────────────────────────────────────────────────────────────

let selectedFile = null;

const dropZone  = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type === 'application/pdf') setFile(file);
});

fileInput.addEventListener('change', e => {
  if (e.target.files[0]) setFile(e.target.files[0]);
});

function setFile(file) {
  selectedFile = file;
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('fileReady').classList.add('visible');
  document.getElementById('scanBtn').disabled = false;
}


// ─── Scanning ────────────────────────────────────────────────────────────────

let scanResults  = [];
let isScanning   = false;
let lastRawBytes = null;  // Uint8Array of the last scanned PDF, kept for pdf-lib

async function startScan() {
  if (!selectedFile || isScanning) return;
  if (keywords.length === 0) {
    alert('Please add at least one keyword before scanning.');
    return;
  }

  isScanning    = true;
  scanResults   = [];
  lastRawBytes  = null;

  const scanBtn        = document.getElementById('scanBtn');
  const progressSec    = document.getElementById('progressSection');
  const resultsSec     = document.getElementById('resultsSection');
  const progressFill   = document.getElementById('progressFill');
  const progressLabel  = document.getElementById('progressLabel');

  scanBtn.disabled        = true;
  scanBtn.textContent     = 'Scanning…';
  progressSec.style.display = 'block';
  resultsSec.style.display  = 'none';
  progressFill.style.width  = '0%';
  progressLabel.textContent = 'Loading PDF…';

  try {
    lastRawBytes = new Uint8Array(await selectedFile.arrayBuffer());
    const pdf    = await pdfjsLib.getDocument({ data: lastRawBytes.slice() }).promise;
    const total  = pdf.numPages;

    // Track which pages have already been flagged for images (one row per page)
    const flaggedImagePages = new Set();

    for (let pageNum = 1; pageNum <= total; pageNum++) {
      // Update progress bar
      const pct = Math.round((pageNum / total) * 100);
      progressFill.style.width  = pct + '%';
      progressLabel.textContent = `Page ${pageNum} of ${total}…`;

      const page = await pdf.getPage(pageNum);

      // ── Text extraction + character map ──────────────────────────────────
      const textContent = await page.getTextContent();
      const items = textContent.items;

      // Build charMap in parallel with the joined string so we can reverse-look-up
      // which text item (and position within it) corresponds to any character index.
      // charMap[i] = { itemIndex, charOffset }  (-1 means a manufactured space)
      const charMap = [];
      let pageText  = '';

      for (let idx = 0; idx < items.length; idx++) {
        if (idx > 0) {
          charMap.push({ itemIndex: -1, charOffset: 0 });
          pageText += ' ';
        }
        for (let ci = 0; ci < items[idx].str.length; ci++) {
          charMap.push({ itemIndex: idx, charOffset: ci });
          pageText += items[idx].str[ci];
        }
      }

      // ── Keyword search ───────────────────────────────────────────────────
      for (const keyword of keywords) {
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex   = new RegExp(escaped, 'gi');
        let match;

        while ((match = regex.exec(pageText)) !== null) {
          const start   = Math.max(0, match.index - 60);
          const end     = Math.min(pageText.length, match.index + keyword.length + 60);
          const snippet = pageText.substring(start, end).trim();
          const context =
            (start > 0 ? '…' : '') +
            snippet +
            (end < pageText.length ? '…' : '');

          const rects = computeHighlightRects(items, charMap, match.index, keyword.length);

          scanResults.push({
            keyword,
            page: pageNum,
            context,
            type: 'keyword',
            rects,
          });
        }
      }

      // ── Image detection ──────────────────────────────────────────────────
      if (!flaggedImagePages.has(pageNum)) {
        const ops = await page.getOperatorList();

        // These OPS codes indicate raster image painting in PDF.js v3
        const imageOpCodes = new Set([
          pdfjsLib.OPS.paintImageXObject,
          pdfjsLib.OPS.paintInlineImageXObject,
          pdfjsLib.OPS.paintImageMaskXObject,
        ].filter(op => op !== undefined));

        const hasImages = ops.fnArray.some(fn => imageOpCodes.has(fn));

        if (hasImages) {
          flaggedImagePages.add(pageNum);
          scanResults.push({
            keyword: '[image]',
            page: pageNum,
            context: 'Page contains one or more embedded images — review manually for maps',
            type: 'image',
          });
        }
      }

      // Yield to the browser so the UI stays responsive on long documents
      await new Promise(r => setTimeout(r, 0));
    }

    const kwCount  = scanResults.filter(r => r.type === 'keyword').length;
    const imgCount = flaggedImagePages.size;
    progressLabel.textContent =
      `Scan complete — ${kwCount} keyword match${kwCount !== 1 ? 'es' : ''}, ` +
      `${imgCount} page${imgCount !== 1 ? 's' : ''} with images`;

    displayResults();

  } catch (err) {
    progressLabel.textContent = `Error: ${err.message}`;
    console.error(err);
  } finally {
    isScanning          = false;
    scanBtn.disabled    = false;
    scanBtn.textContent = 'Scan PDF';
  }
}


// ─── Results display ─────────────────────────────────────────────────────────

function displayResults() {
  const section  = document.getElementById('resultsSection');
  const tbody    = document.getElementById('resultsBody');
  const countEl  = document.getElementById('resultCount');

  const kwCount  = scanResults.filter(r => r.type === 'keyword').length;
  const imgCount = scanResults.filter(r => r.type === 'image').length;

  countEl.textContent =
    `${kwCount} keyword match${kwCount !== 1 ? 'es' : ''} · ` +
    `${imgCount} page${imgCount !== 1 ? 's' : ''} with images`;

  tbody.innerHTML = '';

  if (scanResults.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="3" class="empty-state">No findings — document appears clean.</td></tr>';
  } else {
    for (const r of scanResults) {
      const tr = document.createElement('tr');
      if (r.type === 'image') tr.classList.add('row-image');
      tr.innerHTML = `
        <td class="col-kw">${escapeHtml(r.keyword)}</td>
        <td class="col-pg">${r.page}</td>
        <td class="col-ctx">${escapeHtml(r.context)}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


// ─── CSV export ──────────────────────────────────────────────────────────────

function downloadCSV() {
  const rows = [['Keyword', 'Page', 'Context']];

  for (const r of scanResults) {
    rows.push([
      `"${r.keyword}"`,
      r.page,
      `"${r.context.replace(/"/g, '""')}"`,
    ]);
  }

  const csv  = rows.map(r => r.join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');

  a.href     = url;
  a.download = `scan-${selectedFile.name.replace(/\.pdf$/i, '')}-${today()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


// ─── Utilities ───────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}


// ─── Highlight rectangle computation ─────────────────────────────────────────

/**
 * Compute bounding-box rectangles for a keyword match so pdf-lib can draw
 * yellow highlights at the correct position on the page.
 *
 * @param {Array}  items      - textContent.items for the page (from PDF.js)
 * @param {Array}  charMap    - parallel array: charMap[pos] = {itemIndex, charOffset}
 * @param {number} matchStart - match.index from regex.exec()
 * @param {number} matchLen   - keyword.length
 * @returns {Array<{x, y, width, height}>}  one rect per spanned text item
 */
function computeHighlightRects(items, charMap, matchStart, matchLen) {
  if (!charMap.length) return [];

  const clampedStart = Math.min(matchStart, charMap.length - 1);
  const clampedEnd   = Math.min(matchStart + matchLen - 1, charMap.length - 1);
  const startEntry   = charMap[clampedStart];
  const endEntry     = charMap[clampedEnd];

  if (!startEntry || !endEntry) return [];
  if (startEntry.itemIndex === -1 || endEntry.itemIndex === -1) return [];

  // ── Case 1: entire match is within one text item ──────────────────────────
  if (startEntry.itemIndex === endEntry.itemIndex) {
    const item      = items[startEntry.itemIndex];
    const charWidth = item.width / Math.max(item.str.length, 1);
    return [{
      x:      item.transform[4] + startEntry.charOffset * charWidth,
      y:      item.transform[5],
      width:  matchLen * charWidth,
      height: item.height,
    }];
  }

  // ── Case 2: match spans multiple text items ───────────────────────────────
  const touched = new Set();
  for (let pos = clampedStart; pos <= clampedEnd; pos++) {
    if (charMap[pos].itemIndex !== -1) touched.add(charMap[pos].itemIndex);
  }

  return Array.from(touched).map(idx => {
    const item      = items[idx];
    const charWidth = item.width / Math.max(item.str.length, 1);

    if (idx === startEntry.itemIndex) {
      // Start item: x begins at the matched character
      const xOff = startEntry.charOffset * charWidth;
      return { x: item.transform[4] + xOff, y: item.transform[5],
               width: item.width - xOff,    height: item.height };
    }
    if (idx === endEntry.itemIndex) {
      // End item: x begins at item start, width covers only matched chars
      return { x: item.transform[4], y: item.transform[5],
               width: (endEntry.charOffset + 1) * charWidth, height: item.height };
    }
    // Middle items: highlight the full item
    return { x: item.transform[4], y: item.transform[5],
             width: item.width,    height: item.height };
  });
}


// ─── Annotated PDF export ─────────────────────────────────────────────────────

async function downloadAnnotatedPDF() {
  if (!lastRawBytes || scanResults.length === 0) {
    alert('Run a scan first, then download the annotated PDF.');
    return;
  }

  const btn = document.getElementById('annotatedPdfBtn');
  btn.disabled    = true;
  btn.textContent = 'Building PDF…';

  try {
    const { PDFDocument, rgb } = window['PDFLib'];

    // Load the original PDF into pdf-lib (uses a fresh copy of the bytes)
    const pdfDoc = await PDFDocument.load(lastRawBytes);
    const pages  = pdfDoc.getPages();

    // ── Draw yellow highlights over keyword matches ────────────────────────
    for (const result of scanResults) {
      if (result.type !== 'keyword' || !result.rects?.length) continue;

      const page = pages[result.page - 1];
      if (!page) continue;

      for (const rect of result.rects) {
        if (rect.width <= 0 || rect.height <= 0) continue;
        page.drawRectangle({
          x:       rect.x,
          y:       rect.y,
          width:   rect.width,
          height:  rect.height,
          color:   rgb(1, 1, 0),   // yellow
          opacity: 0.35,
        });
      }
    }

    // ── Draw amber image-detected labels in top-right corner ──────────────
    for (const result of scanResults) {
      if (result.type !== 'image') continue;

      const page = pages[result.page - 1];
      if (!page) continue;

      const { width: pw, height: ph } = page.getSize();

      page.drawRectangle({
        x: pw - 162, y: ph - 32, width: 158, height: 24,
        color: rgb(1, 0.8, 0), opacity: 0.92,
      });
      page.drawText('Image detected \u2013 check for maps', {
        x: pw - 159, y: ph - 25,
        size: 7,
        color: rgb(0.2, 0.1, 0),
      });
    }

    // ── Serialise and trigger download ────────────────────────────────────
    const annotatedBytes = await pdfDoc.save();
    const blob = new Blob([annotatedBytes], { type: 'application/pdf' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');

    a.href     = url;
    a.download = `scan-${selectedFile.name.replace(/\.pdf$/i, '')}-annotated-${today()}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

  } catch (err) {
    alert(`Could not build annotated PDF: ${err.message}`);
    console.error(err);
  } finally {
    btn.disabled    = false;
    btn.textContent = '⬇ Download Annotated PDF';
  }
}


// ─── Init ────────────────────────────────────────────────────────────────────
renderKeywords();
