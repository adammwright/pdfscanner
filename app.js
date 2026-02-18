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

let scanResults = [];
let isScanning  = false;

async function startScan() {
  if (!selectedFile || isScanning) return;
  if (keywords.length === 0) {
    alert('Please add at least one keyword before scanning.');
    return;
  }

  isScanning   = true;
  scanResults  = [];

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
    const buffer = await selectedFile.arrayBuffer();
    const pdf    = await pdfjsLib.getDocument({ data: buffer }).promise;
    const total  = pdf.numPages;

    // Track which pages have already been flagged for images (one row per page)
    const flaggedImagePages = new Set();

    for (let pageNum = 1; pageNum <= total; pageNum++) {
      // Update progress bar
      const pct = Math.round((pageNum / total) * 100);
      progressFill.style.width  = pct + '%';
      progressLabel.textContent = `Page ${pageNum} of ${total}…`;

      const page = await pdf.getPage(pageNum);

      // ── Text extraction ──────────────────────────────────────────────────
      const textContent = await page.getTextContent();
      // Join items; PDF.js splits text at layout boundaries so we normalise spacing
      const pageText = textContent.items.map(i => i.str).join(' ').replace(/\s+/g, ' ');

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

          scanResults.push({
            keyword,
            page: pageNum,
            context,
            type: 'keyword',
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


// ─── Init ────────────────────────────────────────────────────────────────────
renderKeywords();
