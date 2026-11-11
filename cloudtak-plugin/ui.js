// Map Compressor - panel UI (framework-free, so CloudTAK and the
// standalone web page run exactly the same code).
//
//   const ui = mountCompressor(element, { map })   // map: a MapLibre map (optional)
//   ui.onChange(() => ...)                          // fires when a result is ready
//   await ui.getKmz() / ui.getDataPackage()         // -> { blob, filename }
//   ui.destroy()

import {
    loadGeoTIFF, composeCanvas, canvasToImage, buildKmz, buildDataPackage,
    humanSize, safeName, canEncodeWebp,
} from './core.js';
import { buildGeoTiff } from './geotiff-write.js';

const SRC = 'map-compressor-preview';
const LYR = 'map-compressor-preview-layer';
const DETAIL = 128; // source pixels shown in the detail view (multiple of 16 = JPEG MCU)

const CSS = `
.tmc{display:flex;flex-direction:column;gap:14px;padding:12px;font-size:14px;line-height:1.4;color:inherit}
.tmc *{box-sizing:border-box}
.tmc-drop{border:2px dashed rgba(127,127,127,.45);border-radius:8px;padding:18px 12px;text-align:center;cursor:pointer}
.tmc-drop.tmc-over{border-color:var(--tmc-accent);background:rgba(32,107,196,.08)}
.tmc-drop strong{display:block;font-size:15px;margin-bottom:2px}
.tmc-muted{opacity:.7;font-size:12.5px}
.tmc-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.tmc-row>label{flex:1;min-width:120px;display:flex;flex-direction:column;gap:4px;font-size:12.5px}
.tmc select{padding:6px 8px;border-radius:6px;border:1px solid rgba(127,127,127,.45);background:transparent;color:inherit;font:inherit}
.tmc select option{color:#111}
.tmc-q{display:flex;flex-direction:column;gap:6px}
.tmc-q-head{display:flex;justify-content:space-between;align-items:baseline}
.tmc-q-val{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums}
.tmc input[type=range]{width:100%;accent-color:var(--tmc-accent);height:28px}
.tmc-scale{display:flex;justify-content:space-between;font-size:11.5px;opacity:.65}
.tmc-size{font-variant-numeric:tabular-nums}
.tmc-size b{font-size:16px}
.tmc-good{color:#2fb344}
.tmc-section{display:flex;flex-direction:column;gap:8px;border-top:1px solid rgba(127,127,127,.25);padding-top:12px}
.tmc-h{font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:.04em;opacity:.8}
.tmc-thumb{position:relative;cursor:crosshair;line-height:0;align-self:flex-start;max-width:100%}
.tmc-thumb canvas{max-width:100%;border-radius:4px}
.tmc-box{position:absolute;border:2px solid #ff3b30;box-shadow:0 0 0 1px rgba(0,0,0,.6);pointer-events:none}
.tmc-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.tmc-pair figure{margin:0;display:flex;flex-direction:column;gap:4px}
.tmc-pair canvas{width:100%;aspect-ratio:1;image-rendering:pixelated;border-radius:4px;background:#000}
.tmc-pair figcaption{font-size:12px;opacity:.75;text-align:center}
.tmc-btns{display:flex;gap:8px;flex-wrap:wrap}
.tmc-btn{flex:1;min-width:140px;padding:9px 12px;border-radius:6px;border:1px solid rgba(127,127,127,.5);background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer}
.tmc-btn.tmc-primary{background:var(--tmc-accent);border-color:var(--tmc-accent);color:#fff}
.tmc-btn:disabled{opacity:.45;cursor:default}
.tmc-status{font-size:12.5px;min-height:1.2em}
.tmc-err{color:#d63939}
.tmc-hidden{display:none!important}
`;

function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') e.className = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v);
    }
    for (const k of kids) e.append(k);
    return e;
}

function maxTextureSize() {
    try {
        const gl = document.createElement('canvas').getContext('webgl');
        const v = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return v || 4096;
    } catch { return 4096; }
}

function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function mountCompressor(root, opts = {}) {
    const map = opts.map || null;
    if (!document.getElementById('tmc-style')) document.head.append(el('style', { id: 'tmc-style' }, CSS));

    const s = {
        data: null, canvas: null, jpeg: null, quality: opts.quality ?? 70,
        background: 'none', maxDim: 8192, tifCache: null, focus: [0.5, 0.5], encodeSeq: 0, timer: 0,
        previewUrl: null, listeners: new Set(), destroyed: false,
    };

    /* ---------- DOM ---------- */
    const fileInput = el('input', { type: 'file', accept: '.tif,.tiff,.gtif,image/tiff', class: 'tmc-hidden' });
    const drop = el('div', { class: 'tmc-drop', role: 'button', tabindex: '0' },
        el('strong', {}, 'Choose a GeoTIFF map'),
        el('span', { class: 'tmc-muted' }, 'or drop it here. It stays on this device until you share it.'));
    const info = el('div', { class: 'tmc-muted tmc-hidden' });

    const maxSel = el('select', {},
        el('option', { value: '8192', selected: '' }, 'Up to 8192 px (recommended)'),
        el('option', { value: '0' }, 'Full resolution'),
        el('option', { value: '4096' }, 'Max 4096 px'),
        el('option', { value: '2048' }, 'Max 2048 px'));
    const bgSel = el('select', {},
        el('option', { value: 'none', selected: '' }, 'Transparent (recommended)'),
        el('option', { value: '#000000' }, 'Black'),
        el('option', { value: '#ffffff' }, 'White'));
    const fmtNote = el('div', { class: 'tmc-muted tmc-hidden' });
    const options = el('div', { class: 'tmc-row' },
        el('label', {}, 'Image size', maxSel),
        el('label', {}, 'Fill for empty areas', bgSel));
    const optionsWrap = el('div', { class: 'tmc-hidden', style: 'display:flex;flex-direction:column;gap:6px' }, options, fmtNote);

    const qVal = el('span', { class: 'tmc-q-val' }, String(s.quality));
    const qRange = el('input', { type: 'range', min: '10', max: '95', step: '5', value: String(s.quality), 'aria-label': 'JPEG quality' });
    const sizeLine = el('div', { class: 'tmc-size' }, '');
    const qBlock = el('div', { class: 'tmc-q tmc-section tmc-hidden' },
        el('div', { class: 'tmc-q-head' }, el('span', { class: 'tmc-h' }, 'Quality'), qVal),
        qRange,
        el('div', { class: 'tmc-scale' }, el('span', {}, 'Smaller file'), el('span', {}, 'Sharper map')),
        sizeLine);

    const opRange = el('input', { type: 'range', min: '0', max: '100', step: '5', value: '100', 'aria-label': 'Preview opacity' });
    const mapBlock = el('div', { class: 'tmc-section tmc-hidden' },
        el('span', { class: 'tmc-h' }, 'On the map'),
        el('span', { class: 'tmc-muted' }, 'The preview on the map is the compressed image, placed exactly where ATAK will put it.'),
        el('label', { class: 'tmc-muted' }, 'Preview opacity', opRange));

    const thumb = el('canvas');
    const box = el('div', { class: 'tmc-box' });
    const thumbWrap = el('div', { class: 'tmc-thumb', title: 'Tap to choose where to inspect' }, thumb, box);
    const orig = el('canvas', { width: String(DETAIL), height: String(DETAIL) });
    const comp = el('canvas', { width: String(DETAIL), height: String(DETAIL) });
    const compCap = el('figcaption', {}, '');
    const detailBlock = el('div', { class: 'tmc-section tmc-hidden' },
        el('span', { class: 'tmc-h' }, 'Detail check'),
        el('span', { class: 'tmc-muted' }, 'Tap the map below to pick a spot (e.g. small text), then compare at full pixel size.'),
        thumbWrap,
        el('div', { class: 'tmc-pair' },
            el('figure', {}, orig, el('figcaption', {}, 'Original')),
            el('figure', {}, comp, compCap)));

    const tifBtn = el('button', { class: 'tmc-btn tmc-primary', type: 'button' }, 'Download GeoTIFF');
    const kmzBtn = el('button', { class: 'tmc-btn', type: 'button' }, 'Download KMZ');
    const pkgBtn = el('button', { class: 'tmc-btn', type: 'button' }, 'Download Data Package');
    const actions = el('div', { class: 'tmc-section tmc-hidden' },
        el('span', { class: 'tmc-h' }, 'Export'),
        el('div', { class: 'tmc-btns' }, tifBtn),
        el('div', { class: 'tmc-btns' }, kmzBtn, pkgBtn),
        el('span', { class: 'tmc-muted' }, 'GeoTIFF: one file with zoom levels; empty areas stay see-through (alpha band). '
            + 'ATAK: Import Manager → “Image Overlay File”. KMZ: JPEG overlay without transparency. '
            + 'Data Package: the GeoTIFF wrapped for TAK Server / Data Sync.'));
    const status = el('div', { class: 'tmc-status' });

    const wrap = el('div', { class: 'tmc', style: `--tmc-accent:${opts.accent || '#206bc4'}` },
        fileInput, drop, info, optionsWrap, qBlock, mapBlock, detailBlock, actions, status);
    root.append(wrap);

    const show = (...els) => els.forEach((e) => e.classList.remove('tmc-hidden'));
    const setStatus = (msg, err = false) => { status.textContent = msg; status.classList.toggle('tmc-err', err); };
    const emit = () => s.listeners.forEach((fn) => { try { fn(api); } catch (e) { console.error(e); } });

    /* ---------- map preview ---------- */
    const coords = () => { const c = s.data.corners; return [c.ul, c.ur, c.lr, c.ll]; };
    const texLimit = map ? maxTextureSize() : 0;

    async function updatePreview(jpeg) {
        if (!map || s.destroyed) return;
        let blob = jpeg;
        const { width: w, height: h } = s.data;
        if (Math.max(w, h) > texLimit) { // GPU can't hold it at full size: shrink the *compressed* image
            const bmp = await createImageBitmap(jpeg);
            const k = texLimit / Math.max(w, h);
            const c = el('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
            c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
            blob = await canvasToImage(c, jpeg.type, 95);
        }
        if (!map.isStyleLoaded()) await new Promise((r) => map.once('load', r));
        const url = URL.createObjectURL(blob);
        const old = s.previewUrl;
        s.previewUrl = url;
        const src = map.getSource(SRC);
        if (src) {
            src.updateImage({ url, coordinates: coords() });
        } else {
            map.addSource(SRC, { type: 'image', url, coordinates: coords() });
            map.addLayer({ id: LYR, type: 'raster', source: SRC,
                paint: { 'raster-opacity': Number(opRange.value) / 100, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } });
        }
        if (old) setTimeout(() => URL.revokeObjectURL(old), 2000);
    }

    function removePreview() {
        if (!map) return;
        try { if (map.getLayer(LYR)) map.removeLayer(LYR); if (map.getSource(SRC)) map.removeSource(SRC); } catch { /* map gone */ }
        if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
        s.previewUrl = null;
    }

    function fitMap() {
        if (!map) return;
        const c = Object.values(s.data.corners);
        const lons = c.map((p) => p[0]), lats = c.map((p) => p[1]);
        map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
            { padding: 40, duration: 800 });
    }

    // Re-add the preview if the host switches basemap (style reload drops sources).
    const onStyle = () => { if (s.preview && !map.getSource(SRC)) updatePreview(s.preview).catch(() => {}); };
    if (map) map.on('style.load', onStyle);

    /* ---------- detail view ---------- */
    function drawThumb() {
        const { width: w, height: h } = s.data;
        const tw = Math.min(360, w), th = Math.round(h * tw / w);
        thumb.width = tw; thumb.height = th;
        thumb.getContext('2d').drawImage(s.canvas, 0, 0, tw, th);
    }

    /** Start the detail view on the busiest spot (usually small text), where JPEG loss shows first. */
    function autoFocus() {
        const tw = thumb.width, th = thumb.height;
        const px = thumb.getContext('2d').getImageData(0, 0, tw, th).data;
        const cell = Math.max(4, Math.round(Math.min(DETAIL, s.data.width, s.data.height) * tw / s.data.width));
        let best = -1;
        for (let cy = 0; cy + cell <= th; cy += Math.ceil(cell / 2)) {
            for (let cx = 0; cx + cell <= tw; cx += Math.ceil(cell / 2)) {
                let e = 0;
                for (let y = cy; y < cy + cell - 1; y++) {
                    for (let x = cx; x < cx + cell - 1; x++) {
                        const i = (y * tw + x) * 4;
                        const l = px[i] + px[i + 1] + px[i + 2];
                        e += Math.abs(l - (px[i + 4] + px[i + 5] + px[i + 6]))
                           + Math.abs(l - (px[i + tw * 4] + px[i + tw * 4 + 1] + px[i + tw * 4 + 2]));
                    }
                }
                if (e > best) { best = e; s.focus = [(cx + cell / 2) / tw, (cy + cell / 2) / th]; }
            }
        }
    }

    function detailOrigin() {
        const { width: w, height: h } = s.data;
        const size = Math.min(DETAIL, w, h);
        const align = (v, max) => Math.max(0, Math.min(max - size, Math.round(v / 16) * 16));
        return [align(s.focus[0] * w - size / 2, w), align(s.focus[1] * h - size / 2, h), size];
    }

    async function drawDetail() {
        if (!s.data) return;
        const [x0, y0, size] = detailOrigin();
        const r = thumb.width / s.data.width;
        const bw = Math.max(16, size * r); // keep the marker visible on very large maps
        Object.assign(box.style, { left: `${(x0 + size / 2) * r - bw / 2}px`, top: `${(y0 + size / 2) * r - bw / 2}px`,
            width: `${bw}px`, height: `${bw}px` });
        const o = orig.getContext('2d');
        o.imageSmoothingEnabled = false;
        o.clearRect(0, 0, DETAIL, DETAIL);
        o.drawImage(s.canvas, x0, y0, size, size, 0, 0, DETAIL, DETAIL);
        // Encode just this crop at the chosen quality: block-aligned, so it shows the same artifacts.
        const crop = el('canvas'); crop.width = size; crop.height = size;
        crop.getContext('2d').drawImage(s.canvas, x0, y0, size, size, 0, 0, size, size);
        const q = s.quality;
        const bmp = await createImageBitmap(await canvasToImage(crop, s.format, q));
        if (q !== s.quality) return; // slider moved on
        const c = comp.getContext('2d');
        c.imageSmoothingEnabled = false;
        c.clearRect(0, 0, DETAIL, DETAIL);
        c.drawImage(bmp, 0, 0, DETAIL, DETAIL);
        compCap.textContent = s.format === 'image/png' ? 'PNG (lossless)' : `${FORMAT_LABEL[s.format]} quality ${q}`;
    }

    thumbWrap.addEventListener('click', (ev) => {
        const rect = thumb.getBoundingClientRect();
        s.focus = [(ev.clientX - rect.left) / rect.width, (ev.clientY - rect.top) / rect.height];
        drawDetail();
    });

    /* ---------- output format ---------- */
    const FORMAT_LABEL = { 'image/jpeg': 'JPEG', 'image/webp': 'WebP', 'image/png': 'PNG' };
    const transparentOut = () => s.background === 'none' && s.data && s.data.transparentFraction > 0;
    function updateFormat() {
        s.format = 'image/jpeg'; // GeoTIFF tiles and KMZ are JPEG; transparency rides in the GeoTIFF mask
        const f = s.data.transparentFraction;
        const note = transparentOut()
            ? `Empty areas (${(100 * f).toFixed(f < 0.01 ? 1 : 0)}% of the map) stay transparent in the GeoTIFF. `
              + 'KMZ can\'t be transparent, so the KMZ fills them black.'
            : '';
        fmtNote.textContent = note;
        fmtNote.classList.toggle('tmc-hidden', !note);
    }

    /* ---------- encoding ---------- */
    async function encode() {
        const seq = ++s.encodeSeq;
        const q = s.quality;
        setStatus(`Compressing at quality ${q}…`);
        tifBtn.disabled = kmzBtn.disabled = pkgBtn.disabled = true;
        try {
            const jpeg = await canvasToImage(s.canvas, s.format, q);
            if (seq !== s.encodeSeq || s.destroyed) return;
            s.jpeg = jpeg;
            renderSize();
            // Build the GeoTIFF (the main output) once the slider settles, so the
            // size shown is the real file size and Download/Share are instant.
            clearTimeout(s.tifTimer);
            s.tifTimer = setTimeout(() => api.getGeoTiff().then(renderSize).catch((e) => setStatus(e.message, true)), 600);
            // Preview with real transparency when the GeoTIFF will have it (preview only).
            const preview = transparentOut()
                ? await canvasToImage(s.canvas, canEncodeWebp() ? 'image/webp' : 'image/png', q)
                : jpeg;
            if (seq !== s.encodeSeq || s.destroyed) return;
            s.preview = preview;
            updatePreview(preview).catch((e) => console.warn('Map preview failed', e));
            setStatus('');
            tifBtn.disabled = kmzBtn.disabled = pkgBtn.disabled = false;
            emit();
        } catch (e) {
            if (seq === s.encodeSeq) setStatus(e.message, true);
        }
    }

    const tifKey = () => `${s.quality}|${s.background}`;
    function renderSize() {
        if (!s.jpeg || !s.data) return;
        const c = s.tifCache;
        const tif = c && c.key === tifKey() && c.data === s.data ? c.result.blob.size : null;
        const from = s.data.fileSize;
        const pct = tif ? Math.max(0, 100 * (1 - tif / from)) : 0;
        sizeLine.innerHTML = '';
        sizeLine.append('GeoTIFF ', el('b', {}, tif ? humanSize(tif) : '…'),
            ` · KMZ ${humanSize(s.jpeg.size)} · from ${humanSize(from)} `,
            tif ? el('span', { class: 'tmc-good' }, `(${pct.toFixed(pct > 99 ? 1 : 0)}% smaller)`) : '');
    }

    function scheduleEncode(delay = 250) {
        clearTimeout(s.timer);
        s.timer = setTimeout(encode, delay);
    }

    /* ---------- loading ---------- */
    async function load(file) {
        if (!file) return;
        setStatus(`Reading ${file.name}…`);
        s.encodeSeq++;
        // Forget the previous map first, so a failed load can never export the old one.
        s.jpeg = null; s.preview = null; s.data = null; s.tifCache = null;
        tifBtn.disabled = kmzBtn.disabled = pkgBtn.disabled = true;
        removePreview();
        [info, optionsWrap, qBlock, mapBlock, detailBlock, actions].forEach((e) => e.classList.add('tmc-hidden'));
        emit();
        try {
            const data = await loadGeoTIFF(file, { maxDim: s.maxDim || undefined });
            s.data = data;
            s.file = file;
            if (s.canvas) s.canvas.width = s.canvas.height = 0;
            s.canvas = composeCanvas(data, s.background);
            info.textContent = `${data.name} · ${humanSize(data.fileSize)} · ${data.sourceWidth}×${data.sourceHeight} px · ${data.crs}`
                + (data.scaled ? ` · resized to ${data.width}×${data.height} px` : '')
                + (data.readFromOverview ? ' (from embedded overview)' : '')
                + (data.transparentFraction ? ` · ${(100 * data.transparentFraction).toFixed(0)}% empty` : '');
            show(info, optionsWrap, qBlock, detailBlock, actions);
            updateFormat();
            if (map) show(mapBlock);
            drawThumb();
            autoFocus();
            await drawDetail();
            fitMap();
            await encode();
        } catch (e) {
            console.error(e);
            setStatus(e.message || String(e), true);
        }
    }

    drop.addEventListener('click', () => fileInput.click());
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
    fileInput.addEventListener('change', () => load(fileInput.files[0]));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('tmc-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('tmc-over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('tmc-over'); load(e.dataTransfer.files[0]); });

    qRange.addEventListener('input', () => {
        s.quality = Number(qRange.value);
        qVal.textContent = String(s.quality);
        drawDetail();
        scheduleEncode();
    });
    opRange.addEventListener('input', () => {
        if (map && map.getLayer(LYR)) map.setPaintProperty(LYR, 'raster-opacity', Number(opRange.value) / 100);
    });
    bgSel.addEventListener('change', () => {
        s.background = bgSel.value;
        if (!s.data) return;
        s.canvas.width = s.canvas.height = 0;
        s.canvas = composeCanvas(s.data, s.background);
        updateFormat(); drawThumb(); drawDetail(); scheduleEncode(0);
    });
    maxSel.addEventListener('change', () => { s.maxDim = Number(maxSel.value); if (s.file) load(s.file); });

    /* ---------- public API ---------- */
    const api = {
        get ready() { return Boolean(s.jpeg && s.data) && !kmzBtn.disabled; },
        get name() { return s.data ? s.data.name : ''; },
        get quality() { return s.quality; },
        async getKmz() {
            if (!s.jpeg) throw new Error('Nothing converted yet');
            const blob = await buildKmz(s.data.name, s.jpeg, s.data.corners, s.data.height);
            return { blob, filename: `${safeName(s.data.name)}.kmz` };
        },
        /** Overlay GeoTIFF (WGS84, JPEG tiles, transparency mask, overviews). Built once per setting. */
        async getGeoTiff() {
            if (!s.jpeg) throw new Error('Nothing converted yet');
            const key = tifKey(), data = s.data;
            if (s.tifCache && s.tifCache.key === key && s.tifCache.data === data) return s.tifCache.result;
            if (s.tifPending && s.tifPending.key === key && s.tifPending.data === data) return s.tifPending.promise;
            const promise = (async () => {
                setStatus('Building GeoTIFF…');
                const blob = await buildGeoTiff(data, {
                    quality: s.quality, transparent: s.background === 'none', background: s.background,
                    onProgress: (f) => { if (s.data === data) setStatus(`Building GeoTIFF… ${Math.round(f * 100)}%`); },
                });
                const result = { blob, filename: `${safeName(data.name)}.tif` };
                s.tifCache = { key, data, result };
                if (s.data === data && tifKey() === key) setStatus('');
                return result;
            })();
            s.tifPending = { key, data, promise };
            try { return await promise; } finally { if (s.tifPending?.promise === promise) s.tifPending = null; }
        },
        /** ATAK Data Package wrapping the GeoTIFF. */
        async getDataPackage() {
            const { blob: tif, filename } = await api.getGeoTiff();
            const blob = await buildDataPackage(s.data.name, tif, filename);
            return { blob, filename: `${safeName(s.data.name)}.zip` };
        },
        /** Load a File/Blob programmatically (e.g. from a host's own file list). */
        loadFile: (file) => load(file),
        onChange(fn) { s.listeners.add(fn); return () => s.listeners.delete(fn); },
        setStatus,
        destroy() {
            s.destroyed = true;
            clearTimeout(s.timer);
            clearTimeout(s.tifTimer);
            removePreview();
            if (map) map.off('style.load', onStyle);
            if (s.canvas) s.canvas.width = s.canvas.height = 0;
            wrap.remove();
        },
    };

    tifBtn.addEventListener('click', async () => {
        try { tifBtn.disabled = true; const { blob, filename } = await api.getGeoTiff(); download(blob, filename); }
        catch (e) { setStatus(e.message, true); } finally { tifBtn.disabled = false; }
    });
    kmzBtn.addEventListener('click', async () => {
        try { const { blob, filename } = await api.getKmz(); download(blob, filename); } catch (e) { setStatus(e.message, true); }
    });
    pkgBtn.addEventListener('click', async () => {
        try { const { blob, filename } = await api.getDataPackage(); download(blob, filename); } catch (e) { setStatus(e.message, true); }
    });

    return api;
}
