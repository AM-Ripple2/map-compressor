// Map Compressor - conversion core (browser, no server needed).
//
// GeoTIFF -> 8-bit pixels -> JPEG at a chosen quality -> KMZ GroundOverlay
// (and optionally an ATAK Data Package). Everything runs on the user's device;
// nothing is uploaded unless the host app explicitly shares the result.
//
// Dependencies (bare imports, resolved by CloudTAK's Vite build or an importmap):
//   geotiff@2, proj4@2, geotiff-geokeys-to-proj4, fflate

import { fromBlob } from 'geotiff';
import proj4 from 'proj4';
import * as geokeysToProj4 from 'geotiff-geokeys-to-proj4';
import { zipSync, strToU8 } from 'fflate';

const IS_IOS = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1));
// Largest canvas the browser will reliably encode (iOS Safari caps canvas area at 16.7 MP).
export const MAX_CANVAS_AREA = IS_IOS ? 16_777_216 : 200_000_000;
export const MAX_CANVAS_SIDE = IS_IOS ? 16_384 : 32_767;
const JPEG_MAX_SIDE = 65_500;

/* ------------------------------------------------------------------------ */
/* Georeferencing                                                            */
/* ------------------------------------------------------------------------ */

/** Least-squares affine [a,b,c,d,e,f] (x = a*col + b*row + c) from tie points. */
function affineFromGcps(gcps) {
    // Normal equations for x and y separately: [col row 1] * [a b c]^T = x
    const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const atx = [0, 0, 0], aty = [0, 0, 0];
    for (const g of gcps) {
        const v = [g.col, g.row, 1];
        for (let i = 0; i < 3; i++) {
            atx[i] += v[i] * g.x; aty[i] += v[i] * g.y;
            for (let j = 0; j < 3; j++) ata[i][j] += v[i] * v[j];
        }
    }
    const solve = (m, r) => { // 3x3 Cramer's rule
        const det = (q) => q[0][0] * (q[1][1] * q[2][2] - q[1][2] * q[2][1])
            - q[0][1] * (q[1][0] * q[2][2] - q[1][2] * q[2][0])
            + q[0][2] * (q[1][0] * q[2][1] - q[1][1] * q[2][0]);
        const d = det(m);
        if (Math.abs(d) < 1e-12) throw new Error('Control points are collinear');
        return [0, 1, 2].map((k) => det(m.map((row, i) => row.map((val, j) => (j === k ? r[i] : val)))) / d);
    };
    const [a, b, c] = solve(ata, atx);
    const [d, e, f] = solve(ata, aty);
    return [a, b, c, d, e, f];
}

function affineFromImage(image, geoKeys) {
    const fd = image.fileDirectory;
    let t = null;
    if (fd.ModelTransformation && fd.ModelTransformation.length >= 8) {
        const m = fd.ModelTransformation;
        t = [m[0], m[1], m[3], m[4], m[5], m[7]];
    } else if (fd.ModelTiepoint && fd.ModelPixelScale && fd.ModelTiepoint.length === 6) {
        const [i, j, , x, y] = fd.ModelTiepoint;
        const [sx, sy] = fd.ModelPixelScale;
        t = [sx, 0, x - i * sx, 0, -sy, y + j * sy];
    } else if (fd.ModelTiepoint && fd.ModelTiepoint.length >= 18) {
        const tp = fd.ModelTiepoint, gcps = [];
        for (let k = 0; k + 5 < tp.length; k += 6) gcps.push({ col: tp[k], row: tp[k + 1], x: tp[k + 3], y: tp[k + 4] });
        t = affineFromGcps(gcps);
    }
    if (!t) return null;
    if (geoKeys && geoKeys.GTRasterTypeGeoKey === 2) { // PixelIsPoint -> shift to pixel corner (as GDAL does)
        t[2] -= (t[0] + t[1]) / 2;
        t[5] -= (t[3] + t[4]) / 2;
    }
    return t;
}

/** Map CRS coordinates <-> lon/lat. Returns fwd(x, y) with fwd.inverse(lon, lat). */
function makeToLonLat(geoKeys) {
    const code = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey;
    if (code === 4326) {
        const id = (x, y) => [x, y];
        id.inverse = id;
        return id;
    }
    if (code === 3857 || code === 900913) return projector('EPSG:3857');
    if (code >= 32601 && code <= 32660) return projector(`+proj=utm +zone=${code - 32600} +datum=WGS84 +units=m +no_defs`);
    if (code >= 32701 && code <= 32760) return projector(`+proj=utm +zone=${code - 32700} +south +datum=WGS84 +units=m +no_defs`);
    const p = geokeysToProj4.toProj4(geoKeys);
    if (!p || !p.proj4) throw new Error('Unsupported map projection.');
    // Unit factors (e.g. US survey feet -> metres). The property name differs between library versions.
    const k = p.conversionParameters || p.coordinatesConversionParameters || { x: 1, y: 1 };
    const kx = k.x ?? 1, ky = k.y ?? 1;
    const base = projector(p.proj4);
    const fwd = (x, y) => base(x * kx, y * ky);
    fwd.inverse = (lon, lat) => { const [x, y] = base.inverse(lon, lat); return [x / kx, y / ky]; };
    return fwd;
}

function projector(def) {
    const conv = proj4(def, 'WGS84');
    const fwd = (x, y) => conv.forward([x, y]);
    fwd.inverse = (lon, lat) => conv.inverse([lon, lat]);
    return fwd;
}

/* ------------------------------------------------------------------------ */
/* Loading                                                                   */
/* ------------------------------------------------------------------------ */

function stretchTo8(band, valid) {
    const sample = [];
    const step = Math.max(1, Math.floor(band.length / 1_000_000));
    for (let i = 0; i < band.length; i += step) if (!valid || valid[i]) sample.push(band[i]);
    sample.sort((p, q) => p - q);
    let lo = sample[Math.floor(sample.length * 0.02)] ?? 0;
    let hi = sample[Math.floor(sample.length * 0.98)] ?? 255;
    if (hi <= lo) hi = lo + 1;
    const out = new Uint8ClampedArray(band.length);
    const k = 255 / (hi - lo);
    for (let i = 0; i < band.length; i++) out[i] = (band[i] - lo) * k;
    return out;
}

/**
 * Read a GeoTIFF File/Blob into RGBA pixels plus its corner coordinates.
 * @param {File|Blob} file
 * @param {{maxDim?: number}} [opts]  optional cap on the longest side
 */
export async function loadGeoTIFF(file, opts = {}) {
    const tiff = await fromBlob(file);
    const image = await tiff.getImage();
    const geoKeys = image.getGeoKeys() || {};
    const t = affineFromImage(image, geoKeys);
    if (!t || !(geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey || geoKeys.GTModelTypeGeoKey)) {
        throw new Error('This TIFF has no georeferencing (no coordinates). Use a GeoTIFF.');
    }

    const W = image.getWidth(), H = image.getHeight();
    let scale = 1;
    const limitSide = Math.min(opts.maxDim || Infinity, MAX_CANVAS_SIDE, JPEG_MAX_SIDE);
    scale = Math.min(scale, limitSide / Math.max(W, H), Math.sqrt(MAX_CANVAS_AREA / (W * H)));
    const w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
    const n = w * h;

    const fd = image.fileDirectory;
    const bps = image.getBitsPerSample ? image.getBitsPerSample() : (fd.BitsPerSample?.[0] ?? 8);
    const fmt = fd.SampleFormat?.[0] ?? 1;
    const spp = image.getSamplesPerPixel();
    const photometric = fd.PhotometricInterpretation;
    const resampleMethod = photometric === 3 ? 'nearest' : 'bilinear';
    const noData = image.getGDALNoData();
    const extra = fd.ExtraSamples ? Array.from(fd.ExtraSamples) : [];

    // Read from the smallest embedded overview that is still at least the output size
    // (PIX4D/GDAL "embedded overviews"). Much faster, and avoids decoding gigapixels.
    let src = image;
    const count = await tiff.getImageCount();
    for (let i = 1; i < count; i++) {
        const ov = await tiff.getImage(i);
        if ((ov.fileDirectory.NewSubfileType || 0) & 4) continue; // transparency mask, not an overview
        if (ov.getSamplesPerPixel() !== spp) continue;
        if (ov.getWidth() >= w && ov.getHeight() >= h && ov.getWidth() < src.getWidth()) src = ov;
    }

    const rgba = new Uint8ClampedArray(n * 4);
    if (fd.ColorMap && spp === 1 && bps <= 16) {
        // Palette image. Apply the colour table ourselves: some writers store a ColorMap
        // without tagging the image as Palette (GDAL honours it, so we do too).
        const cm = fd.ColorMap, size = cm.length / 3;
        const [idx] = await src.readRasters({ samples: [0], width: w, height: h, resampleMethod: 'nearest' });
        for (let i = 0; i < n; i++) {
            const v = idx[i];
            rgba[i * 4] = cm[v] >> 8; rgba[i * 4 + 1] = cm[size + v] >> 8; rgba[i * 4 + 2] = cm[2 * size + v] >> 8;
            rgba[i * 4 + 3] = noData !== null && v === noData ? 0 : 255;
        }
    } else if (bps <= 8 && fmt === 1) {
        const rgb = await src.readRGB({ interleave: true, enableAlpha: true, width: w, height: h, resampleMethod });
        const ch = rgb.length / n;
        for (let i = 0, j = 0; i < n; i++, j += ch) {
            const r = rgb[j], g = rgb[j + 1], b = rgb[j + 2];
            let a = ch === 4 ? rgb[j + 3] : 255;
            if (noData !== null && r === noData && g === noData && b === noData) a = 0;
            rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
        }
        // 4-band RGB whose 4th band isn't tagged as alpha (common in exports): treat as alpha.
        if (ch === 3 && spp === 4 && photometric === 2 && !extra.length && noData === null) {
            const [al] = await src.readRasters({ samples: [3], width: w, height: h, resampleMethod: 'nearest' });
            for (let i = 0; i < n; i++) rgba[i * 4 + 3] = al[i] > 0 ? 255 : 0;
        }
    } else {
        const samples = spp >= 3 ? [0, 1, 2] : [0];
        const bands = await src.readRasters({ samples, width: w, height: h, resampleMethod });
        const valid = new Uint8Array(n).fill(1);
        if (noData !== null) for (let i = 0; i < n; i++) if (bands[0][i] === noData) valid[i] = 0;
        const out = bands.map((b) => stretchTo8(b, valid));
        for (let i = 0; i < n; i++) {
            rgba[i * 4] = out[0][i];
            rgba[i * 4 + 1] = out[samples.length === 3 ? 1 : 0][i];
            rgba[i * 4 + 2] = out[samples.length === 3 ? 2 : 0][i];
            rgba[i * 4 + 3] = valid[i] ? 255 : 0;
        }
    }

    // Corner coordinates (of the full-resolution image; scaling doesn't move them).
    const toLonLat = makeToLonLat(geoKeys);
    const px = (col, row) => toLonLat(t[0] * col + t[1] * row + t[2], t[3] * col + t[4] * row + t[5]);
    const corners = { ul: px(0, 0), ur: px(W, 0), lr: px(W, H), ll: px(0, H) };
    for (const c of Object.values(corners)) {
        if (!Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[1]) > 90) {
            throw new Error('Could not convert this map\'s coordinates to latitude/longitude.');
        }
    }

    let transparent = 0;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) transparent++;

    const epsg = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey;
    // lon/lat -> pixel (col, row) in the loaded (possibly downscaled) image.
    const det = t[0] * t[4] - t[1] * t[3];
    const sx = w / W, sy = h / H;
    const toPixel = (lon, lat) => {
        const [x, y] = toLonLat.inverse(lon, lat);
        const dx = x - t[2], dy = y - t[5];
        return [((t[4] * dx - t[1] * dy) / det) * sx, ((-t[3] * dx + t[0] * dy) / det) * sy];
    };

    return {
        toPixel,
        name: file.name ? file.name.replace(/\.(tiff?|gtiff?)$/i, '') : 'map',
        fileSize: file.size,
        sourceWidth: W, sourceHeight: H,
        readFromOverview: src !== image ? `${src.getWidth()}×${src.getHeight()}` : null,
        width: w, height: h, scaled: scale < 1,
        rgba, corners,
        transparentFraction: transparent / n,
        crs: epsg && epsg !== 32767 ? `EPSG:${epsg}` : 'custom projection',
        epsg: epsg || null,
    };
}

/* ------------------------------------------------------------------------ */
/* Encoding                                                                  */
/* ------------------------------------------------------------------------ */

function newCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
}

/**
 * Flatten RGBA onto a solid background (JPEG has no transparency), or with
 * background 'none' keep the empty areas transparent.
 */
export function composeCanvas(map, background = '#000000') {
    const src = newCanvas(map.width, map.height);
    src.getContext('2d').putImageData(new ImageData(map.rgba, map.width, map.height), 0, 0);
    if (background === 'none') return src;
    const out = newCanvas(map.width, map.height);
    const ctx = out.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    src.width = src.height = 0; // free memory
    return out;
}

let webpOk;
/** Can this browser *encode* WebP? (Safari decodes WebP but encodes it as PNG.) */
export function canEncodeWebp() {
    if (webpOk === undefined) {
        try { webpOk = newCanvas(1, 1).toDataURL('image/webp').startsWith('data:image/webp'); } catch { webpOk = false; }
    }
    return webpOk;
}

export function canvasToImage(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encoding failed (image too large for this browser?)'))),
            type, type === 'image/png' ? undefined : Math.min(0.95, Math.max(0.05, quality / 100)));
    });
}

export const extensionFor = (type) => ({ 'image/webp': 'webp', 'image/png': 'png' }[type] || 'jpg');

export function canvasToJpeg(canvas, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encoding failed (image too large for this browser?)'))),
            'image/jpeg', Math.min(0.95, Math.max(0.05, quality / 100)));
    });
}

/* ------------------------------------------------------------------------ */
/* Packaging                                                                 */
/* ------------------------------------------------------------------------ */

const xmlEscape = (s) => String(s).replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch]));
export const safeName = (s) => String(s).replace(/[^A-Za-z0-9._ -]+/g, '_').trim() || 'map';

/** True when the corners form a north-up lon/lat rectangle (within 1/4 pixel). */
export function isNorthUp(corners, height) {
    const { ul, ur, lr, ll } = corners;
    const tol = Math.abs(ul[1] - ll[1]) / height / 4;
    return Math.abs(ul[1] - ur[1]) <= tol && Math.abs(ll[1] - lr[1]) <= tol
        && Math.abs(ul[0] - ll[0]) <= tol && Math.abs(ur[0] - lr[0]) <= tol;
}

/**
 * KML GroundOverlay. North-up maps use the classic LatLonBox (readable by every
 * KML client); others use gx:LatLonQuad, the form ATAK's Rubber Sheet tool writes,
 * so the image is pinned by its 4 corners without resampling.
 */
export function buildKml(name, href, corners, height) {
    const { ul, ur, lr, ll } = corners;
    const f = (v) => v.toFixed(10);
    const geo = isNorthUp(corners, height)
        ? `    <LatLonBox>\n      <north>${f((ul[1] + ur[1]) / 2)}</north>\n      <south>${f((ll[1] + lr[1]) / 2)}</south>\n`
          + `      <east>${f((ur[0] + lr[0]) / 2)}</east>\n      <west>${f((ul[0] + ll[0]) / 2)}</west>\n    </LatLonBox>`
        : `    <gx:LatLonQuad>\n      <coordinates>${[ll, lr, ur, ul].map((c) => `${f(c[0])},${f(c[1])},0`).join(' ')}</coordinates>\n    </gx:LatLonQuad>`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <GroundOverlay>
    <name>${xmlEscape(name)}</name>
    <Icon><href>${xmlEscape(href)}</href></Icon>
${geo}
  </GroundOverlay>
</kml>
`;
}

/** @returns {Promise<Blob>} KMZ containing doc.kml + files/<name>.<jpg|webp|png> */
export async function buildKmz(name, imageBlob, corners, height) {
    const href = `files/${safeName(name)}.${extensionFor(imageBlob.type)}`;
    const jpg = new Uint8Array(await imageBlob.arrayBuffer());
    const zip = zipSync({
        'doc.kml': [strToU8(buildKml(name, href, corners, height)), { level: 6 }],
        [href]: [jpg, { level: 0 }],
    });
    return new Blob([zip], { type: 'application/vnd.google-earth.kmz' });
}

/** ATAK Data Package (Mission Package): zip + MANIFEST/manifest.xml around one overlay file. */
export async function buildDataPackage(name, fileBlob, filename = `${safeName(name)}.kmz`) {
    const uid = crypto.randomUUID();
    const entry = `${uid.replace(/-/g, '')}/${filename}`;
    const manifest = `<MissionPackageManifest version="2">
  <Configuration>
    <Parameter name="uid" value="${uid}"/>
    <Parameter name="name" value="${xmlEscape(name)}"/>
  </Configuration>
  <Contents>
    <Content ignore="false" zipEntry="${xmlEscape(entry)}"/>
  </Contents>
</MissionPackageManifest>
`;
    const zip = zipSync({
        [entry]: [new Uint8Array(await fileBlob.arrayBuffer()), { level: 0 }],
        'MANIFEST/manifest.xml': [strToU8(manifest), { level: 6 }],
    });
    return new Blob([zip], { type: 'application/zip' });
}

export function humanSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
