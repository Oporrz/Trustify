/* ===========================================================================
   Trustify AI Pro (drop-in, ready-to-paste)
   - OCR (eng+tha)
   - QR decode (jsQR)
   - Auto-extract GTIN/Lot
   - Perceptual Hash similarity
   - Confidence Breakdown
   - PDF Report (jsPDF)
   - Live OCR (Tesseract worker) + Attach UI
   =========================================================================== */

/* ------------------------ Dynamic loader ------------------------ */
const __loadScript = (src) => new Promise((res, rej) => {
  if ([...document.scripts].some(s => s.src === src)) return res();
  const el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = rej;
  document.head.appendChild(el);
});

async function ensureLibs() {
  // Tesseract.js (OCR)
  if (typeof Tesseract === 'undefined') {
    await __loadScript('https://unpkg.com/tesseract.js@5.0.1/dist/tesseract.min.js');
  }
  // jsQR (QR)
  if (typeof jsQR === 'undefined') {
    await __loadScript('https://unpkg.com/jsqr@1.4.0/dist/jsQR.js');
  }
  // jsPDF (PDF)
  if (typeof window.jspdf === 'undefined') {
    await __loadScript('https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js');
  }
}

/* -------------------- Canvas/Image helpers --------------------- */
async function fileToImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image(); img.src = url;
  await new Promise(r => img.onload = r);
  return img;
}
function imageToCanvas(img, maxW = 1600) {
  const scale = Math.min(1, maxW / img.width);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return cv;
}
function canvasImageData(canvas) {
  const ctx = canvas.getContext('2d');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/* --------------------------- OCR core -------------------------- */
async function runOCR(file) {
  await ensureLibs();
  try {
    const img = await fileToImage(file);
    const canvas = imageToCanvas(img, 1600);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
    const { data } = await Tesseract.recognize(blob, 'eng+tha', { logger: () => {} });
    const text = (data.text || '').replace(/\s+/g, ' ').trim();
    return { text, ok: true, canvas };
  } catch (e) {
    console.error('OCR error:', e);
    return { text: '', ok: false, canvas: null };
  }
}

/* ---------------------- QR/Barcode decoders -------------------- */
async function decodeWithJsQR(canvas) {
  try {
    const imgData = canvasImageData(canvas);
    const qr = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'dontInvert' });
    if (!qr) return null;
    return {
      text: qr.data || '',
      box: qr.location ? {
        x: Math.min(qr.location.topLeftCorner.x, qr.location.bottomLeftCorner.x),
        y: Math.min(qr.location.topLeftCorner.y, qr.location.topRightCorner.y),
        w: Math.abs(qr.location.topRightCorner.x - qr.location.topLeftCorner.x),
        h: Math.abs(qr.location.bottomLeftCorner.y - qr.location.topLeftCorner.y),
      } : null,
      format: 'QR'
    };
  } catch { return null; }
}

// (1D barcodes — สามารถเพิ่ม Quagga2 ภายหลัง)
async function decodeBarcodes(file) {
  await ensureLibs();
  try {
    const img = await fileToImage(file);
    const canvas = imageToCanvas(img, 1600);
    const qr = await decodeWithJsQR(canvas);
    return { ok: true, qr, barcodes: [], canvas }; // barcodes=[] for now
  } catch (e) {
    console.error('decodeBarcodes error:', e);
    return { ok: false, qr: null, barcodes: [], canvas: null };
  }
}

/* ------------------- Auto-extract GTIN/BATCH ------------------- */
const RE_GTIN  = /(?<!\d)\d{12,14}(?!\d)/g;      // 12–14 digits
const RE_BATCH = /\b(batch|lot)[:\s\-]*([A-Za-z0-9\-]{3,})/i;

function extractCandidates(ocrText) {
  const text = ocrText || '';
  const gtins = (text.match(RE_GTIN) || []).slice(0, 5);
  const mBatch = text.match(RE_BATCH);
  const batch = mBatch ? mBatch[2] : null;
  return { gtins, batch };
}

/* --------------------- Perceptual Hash (aHash) ----------------- */
function canvasToAHash(canvas, size = 32) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.drawImage(canvas, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  // grayscale
  const gray = [];
  for (let i = 0; i < data.length; i += 4) {
    gray.push(0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]);
  }
  const avg = gray.reduce((a, b) => a + b, 0) / gray.length;
  const bits = gray.map(v => (v >= avg ? 1 : 0));
  return bits;
}
function hammingDistanceBits(a, b) {
  const n = Math.min(a.length, b.length);
  let d = 0; for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++;
  return d + Math.abs(a.length - b.length);
}
function bitsSimilarityPercent(a, b) {
  const n = Math.max(a.length, b.length);
  if (!n) return 0;
  const dist = hammingDistanceBits(a, b);
  return Math.round(100 * (1 - dist / n));
}

async function compareWithGallery(gtin, canvasForNow) {
  if (!gtin || !canvasForNow) return { ok:false, best:null, list:[] };
  const api = (path, opts={}) => fetch((window.CFG?.BACKEND_URL || location.origin) + path, opts);
  try {
    const imgs = await api(`/api/products/${encodeURIComponent(gtin)}/images`).then(r=>r.json());
    if (!imgs || !imgs.length) return { ok:true, best:null, list:[] };

    const nowHash = canvasToAHash(canvasForNow);
    const list = [];
    for (const it of imgs.slice(0, 15)) {
      const url = (window.CFG?.BACKEND_URL || location.origin) + it.image_url;
      const im = await new Promise((res, rej)=>{
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => res(img); img.onerror = rej; img.src = url;
      });
      const cv = imageToCanvas(im, 800);
      const hsh = canvasToAHash(cv);
      const sim = bitsSimilarityPercent(nowHash, hsh);
      list.push({ url, angle: it.angle || '-', uploaded_at: it.uploaded_at, similarity: sim });
    }
    list.sort((a,b)=>b.similarity - a.similarity);
    return { ok:true, best:list[0] || null, list };
  } catch (e) {
    console.warn('compareWithGallery error', e);
    return { ok:false, best:null, list:[] };
  }
}

/* --------------------- Confidence Breakdown -------------------- */
function scoreWithBreakdown(item = {}, ocrText = '', decoded = {}) {
  const lines = [];
  let score = 40; lines.push({ reason:'base', delta:+40 });

  const t = (ocrText||'').toLowerCase();
  if (item.brand && t.includes(String(item.brand).toLowerCase())) { score += 15; lines.push({ reason:'brand-hit', delta:+15 }); }
  if (item.name  && t.includes(String(item.name ).toLowerCase())) { score += 10; lines.push({ reason:'name-hit',  delta:+10 }); }
  if (item.gtin  && (ocrText||'').includes(String(item.gtin)))     { score += 20; lines.push({ reason:'gtin-hit',  delta:+20 }); }
  if (item.batch && t.includes(String(item.batch).toLowerCase()))  { score +=  5; lines.push({ reason:'batch-hit', delta:+5  }); }
  if (decoded?.qr?.text)                                          { score += 15; lines.push({ reason:'qr-found',  delta:+15 }); }
  if (item.status === 'verified')                                  { score += 10; lines.push({ reason:'status-verified', delta:+10 }); }
  if ((item.trust_score||0) >= 90)                                 { score += 10; lines.push({ reason:'high-trust',      delta:+10 }); }

  score = Math.max(1, Math.min(99, score));
  let label = 'uncertain';
  if (score >= 85) label = 'likely genuine';
  else if (score <= 55) label = 'counterfeit';

  return { confidence: score, label, breakdown: lines };
}

/* -------------------------- Highlighter ------------------------ */
function escapeHTML(s) {
  return s.replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
}
function escapeReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function highlightMatches(text, opts = {}) {
  const { gtin, brand, batch } = opts;
  if (!text) return '';
  let html = escapeHTML(text);
  const tokens = [];
  if (gtin)  tokens.push({ key:'gtin',  re: new RegExp(escapeReg(gtin), 'g') });
  if (brand) tokens.push({ key:'brand', re: new RegExp(escapeReg(brand), 'gi') });
  if (batch) tokens.push({ key:'batch', re: new RegExp(escapeReg(batch), 'gi') });
  tokens.push({ key:'gtin-candidate', re: /(?<!\d)\d{12,14}(?!\d)/g });
  tokens.forEach(tok => {
    html = html.replace(tok.re, (m) => `<mark data-hit="${tok.key}">${escapeHTML(m)}</mark>`);
  });
  return html;
}

/* -------------------------- Draw boxes ------------------------- */
function drawDetections(canvas, det = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = '#22c55e'; ctx.font = '16px system-ui';
  if (det.qr?.box) {
    const {x,y,w,h} = det.qr.box;
    ctx.strokeStyle = '#0ea5e9'; ctx.strokeRect(x,y,w,h);
    ctx.fillStyle = '#0ea5e9'; ctx.fillText('QR', x+4, y-6 < 12 ? y+16 : y-6);
  }
  ctx.restore();
}

/* ------------------------- PDF Report -------------------------- */
async function generatePDFReport({ item, ocrText, highlightsHTML, resultCanvas, decoded, breakdown, ai }) {
  await ensureLibs();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'pt', format:'a4' });

  const line = (y) => { doc.setDrawColor(220); doc.line(40,y,555,y); };

  // Title
  doc.setFont('helvetica','bold'); doc.setFontSize(18);
  doc.text('Trustify Scan Report', 40, 50);
  doc.setFontSize(11); doc.setFont('helvetica','normal');
  doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 70);
  line(80);

  // Product
  doc.setFont('helvetica','bold'); doc.setFontSize(13);
  doc.text('Product Info', 40, 105);
  doc.setFont('helvetica','normal'); doc.setFontSize(11);
  const p = item || {};
  doc.text(`Name: ${p.name || '-'}`, 40, 125);
  doc.text(`Brand: ${p.brand || '-'}`, 40, 142);
  doc.text(`GTIN: ${p.gtin || '-'}`, 300, 125);
  doc.text(`Batch: ${p.batch || '-'}`, 300, 142);
  line(160);

  // AI Result
  doc.setFont('helvetica','bold'); doc.setFontSize(13);
  doc.text('AI Result', 40, 185);
  doc.setFont('helvetica','normal'); doc.setFontSize(12);
  doc.text(`Label: ${ai.label}  |  Confidence: ${ai.confidence}%`, 40, 205);
  // Breakdown
  doc.setFontSize(11);
  let y = 225;
  breakdown.forEach(b => {
    doc.text(`• ${b.reason}  (${b.delta > 0 ? '+' : ''}${b.delta})`, 50, y);
    y += 16;
  });
  line(y+6); y += 20;

  // QR/Barcode
  doc.setFont('helvetica','bold'); doc.setFontSize(13);
  doc.text('Detected Codes', 40, y);
  doc.setFont('helvetica','normal'); doc.setFontSize(11);
  y += 20;
  if (decoded?.qr?.text) { doc.text(`QR: ${decoded.qr.text}`, 40, y); y += 16; }
  if (decoded?.barcodes?.length) {
    doc.text(`Barcodes: ${decoded.barcodes.map(b=>b.text).join(', ')}`, 40, y); y += 16;
  }
  line(y+6); y += 20;

  // OCR text
  doc.setFont('helvetica','bold'); doc.setFontSize(13);
  doc.text('OCR Text (raw)', 40, y);
  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  const split = doc.splitTextToSize(ocrText || '(empty)', 515);
  y += 18; doc.text(split, 40, y);
  y += (split.length * 12) + 10;
  line(y+6); y += 20;

  // Image
  if (resultCanvas) {
    const dataURL = resultCanvas.toDataURL('image/jpeg', 0.9);
    const imgW = 515, imgH = resultCanvas.height * (imgW / resultCanvas.width);
    if (y + imgH > 780) { doc.addPage(); y = 50; }
    doc.setFont('helvetica','bold'); doc.setFontSize(13);
    doc.text('Analyzed Image', 40, y);
    y += 10;
    doc.addImage(dataURL, 'JPEG', 40, y, imgW, imgH);
    y += imgH + 10;
  }

  return doc;
}

/* ----------------------- Main entry function ------------------- */
async function analyzeImage(file, item = {}) {
  const [ocr, dec] = await Promise.all([ runOCR(file), decodeBarcodes(file) ]);

  // Auto-extract
  const { gtins, batch } = extractCandidates(ocr.text);
  const suggested = {
    gtin: (item?.gtin && gtins.includes(String(item.gtin))) ? item.gtin : (gtins[0] || null),
    batch: item?.batch || batch || null
  };

  // Highlight
  const highlightsHTML = highlightMatches(ocr.text, { gtin: item.gtin || suggested.gtin, brand: item.brand, batch: item.batch || suggested.batch });

  // Scoring + breakdown
  const sc = scoreWithBreakdown(item, ocr.text, dec);

  // Similarity กับรูปในฐาน (ถ้ามี GTIN)
  let sim = { ok:false, best:null, list:[] };
  if (item?.gtin || suggested.gtin) {
    const key = item?.gtin || suggested.gtin;
    sim = await compareWithGallery(key, dec.canvas || ocr.canvas);
    // bonus: ถ้าคล้ายมาก > 85% ช่วยเพิ่มความมั่นใจอีก 5
    if (sim?.best?.similarity >= 85 && sc.confidence <= 94) {
      sc.confidence += 5;
      sc.breakdown.push({ reason:'image-similarity>85%', delta:+5 });
      if (sc.confidence >= 85 && sc.label !== 'likely genuine') sc.label = 'likely genuine';
    }
  }

  // วาดกรอบตรวจจับบน canvas
  drawDetections(dec.canvas || ocr.canvas, { qr: dec.qr, barcodes: dec.barcodes });

  return {
    ok: (ocr.ok || dec.ok),
    ocrText: ocr.text,
    highlightsHTML,
    suggested,            // { gtin, batch } ที่ auto-extract มาได้
    decoded: dec,         // { qr, barcodes, canvas }
    ai: { confidence: sc.confidence, label: sc.label },
    breakdown: sc.breakdown,
    similarity: sim,      // { ok, best:{url, similarity}, list:[...] }
    canvas: dec.canvas || ocr.canvas
  };
}

/* ------------------------- Live OCR (worker) ------------------- */
const LiveOCR = (() => {
  let mediaStream=null, videoEl=null, canvasEl=null, ctx=null, worker=null, timer=null, running=false;
  const intervalMs = 900;     // ความถี่ OCR (ms)
  const maxW = 640;           // ลดขนาดภาพก่อน OCR
  const whitelist = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_/.'; // เร่งความเร็ว

  async function ensureTess() { if (typeof Tesseract === 'undefined') await __loadScript('https://unpkg.com/tesseract.js@5.0.1/dist/tesseract.min.js'); }

  async function init(videoSelector='#liveVideo') {
    await ensureTess();

    videoEl = document.querySelector(videoSelector);
    if (!videoEl) {
      videoEl = document.createElement('video');
      videoEl.id = 'liveVideo';
      videoEl.autoplay = true; videoEl.playsInline = true; videoEl.muted = true;
      videoEl.style = 'width:100%;max-width:480px;border-radius:12px;display:block;margin:auto;';
      document.body.appendChild(videoEl);
    }
    canvasEl = document.createElement('canvas');
    ctx = canvasEl.getContext('2d', { willReadFrequently:true });

    // เปิดกล้อง
    mediaStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' }, audio:false });
    videoEl.srcObject = mediaStream;

    // เตรียม worker
    worker = await Tesseract.createWorker('eng+tha', 1, {
      // logger: m => console.log(m),
      tessedit_char_whitelist: whitelist,
      preserve_interword_spaces: '1'
    });
  }

  function _scaleTo(imgW, imgH, targetW=maxW) {
    const ratio = targetW / imgW;
    return { w: Math.round(imgW*ratio), h: Math.round(imgH*ratio) };
  }

  async function start(onResult) {
    if (!videoEl) await init();
    if (running) return;
    running = true;

    await videoEl.play();

    timer = setInterval(async () => {
      if (!running) return;
      const vw = videoEl.videoWidth || 640, vh = videoEl.videoHeight || 480;
      const { w, h } = _scaleTo(vw, vh, maxW);
      canvasEl.width = w; canvasEl.height = h;

      // (optional) ROI กลางภาพเพื่อลดงาน OCR
      const roi = { sx: 0, sy: Math.max(0, (vh*0.25)), sw: vw, sh: Math.min(vh*0.5, vh) };
      ctx.drawImage(videoEl, roi.sx, roi.sy, roi.sw, roi.sh, 0, 0, w, h);

      try {
        const { data } = await worker.recognize(canvasEl, { rectangle: null });
        const text = (data?.text || '').replace(/\s+/g,' ').trim();

        // heuristics: หา GTIN
        const gtins = (text.match(/\b\d{12,14}\b/g) || []).slice(0,3);
        const brandHits = [];
        const brand = (localStorage.getItem('last_brand') || '').toLowerCase();
        if (brand && text.toLowerCase().includes(brand)) brandHits.push(brand);

        onResult && onResult({ text, gtins, brandHits, conf: Math.round((data?.confidence||0)) });

        // Auto-fill ช่องกรอกถ้ามี GTIN
        if (gtins[0]) {
          const manual = document.getElementById('manual') || document.querySelector('input[name=code]');
          if (manual && !manual.value) manual.value = gtins[0];
        }
      } catch (e) {
        console.warn('live ocr error:', e.message);
      }
    }, intervalMs);
  }

  async function stop() {
    running = false;
    if (timer) { clearInterval(timer); timer=null; }
    if (mediaStream) { mediaStream.getTracks().forEach(t=>t.stop()); mediaStream=null; }
    if (worker) { await worker.terminate(); worker=null; }
  }

  return { init, start, stop, get running(){ return running; } };
})();

/* ---------------------- Attach Live OCR UI --------------------- */
function attachLiveOCRUI() {
  const wrap = document.getElementById('live-ocr-wrap') || document.body;
  const bar = document.createElement('div');
  bar.style = 'display:flex;gap:8px;justify-content:center;margin:10px 0;';
  bar.innerHTML = `
    <button id="btnLiveOCR" class="btn primary">Start Live OCR</button>
    <span id="liveOCRStatus" class="muted">idle</span>
  `;
  wrap.prepend(bar);

  const $btn = bar.querySelector('#btnLiveOCR');
  const $st  = bar.querySelector('#liveOCRStatus');

  $btn.onclick = async () => {
    if (!LiveOCR.running) {
      await LiveOCR.init('#liveVideo');
      await LiveOCR.start(({text, gtins, brandHits, conf}) => {
        const box = document.getElementById('ocrBox') || document.getElementById('result');
        if (box) box.textContent = `Live OCR (${conf}): ${text}`;
        if (gtins[0]) { $st.textContent = `GTIN: ${gtins[0]} (conf ${conf})`; }
        else { $st.textContent = `scanning... (${conf})`; }
      });
      $btn.textContent = 'Stop Live OCR';
      $st.textContent = 'scanning...';
    } else {
      await LiveOCR.stop();
      $btn.textContent = 'Start Live OCR';
      $st.textContent = 'stopped';
    }
  };

  // เพิ่มวิดีโอ preview ถ้ายังไม่มี
  if (!document.getElementById('liveVideo')) {
    const v = document.createElement('video');
    v.id='liveVideo'; v.autoplay=true; v.playsInline=true; v.muted=true;
    v.style='width:100%;max-width:480px;border-radius:12px;display:block;margin:10px auto;';
    wrap.appendChild(v);
  }
}

/* ---------------------- Quick test (optional) ------------------ */
function testDialog() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const res = await analyzeImage(f, { name:'Demo', brand:'Trustify' });
    console.log('[TrustifyAI test] result:', res);
    alert(`AI: ${res.ai.label} (${res.ai.confidence}%)\nSuggested GTIN: ${res.suggested.gtin || '-'} / Batch: ${res.suggested.batch || '-'}`);
  };
  inp.click();
}

/* -------------------------- Public API ------------------------- */
window.TrustifyAI = {
  analyzeImage,
  runOCR,
  decodeBarcodes,
  highlightMatches,
  generatePDFReport,
  compareWithGallery,
  scoreWithBreakdown,
  testDialog,
  LiveOCR,
  attachLiveOCRUI
};

console.log('✅ Trustify AI Pro loaded (OCR+QR, auto GTIN/Batch, pHash similarity, breakdown, PDF, Live OCR)');
