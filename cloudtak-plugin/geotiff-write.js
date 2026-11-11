// Map Compressor - in-browser GeoTIFF writer.
//
// Produces a compact overlay GeoTIFF that TAK clients read natively:
//   * WGS84 (EPSG:4326), north-up, square ground pixels
//   * 3-band JPEG-compressed (YCbCr) 256x256 tiles at the chosen quality
//   * maps with empty areas: 4-band RGBA (alpha band) so they stay see-through.
//     ATAK ignores a separate GDAL mask (draws it black) but honours an alpha
//     band; ATAK's GDAL has no WebP codec, so the tiles are JPEG.
//   * internal overviews (zoom levels) at the same quality
// Written directly from the TIFF 6.0 / GeoTIFF 1.0 specifications. 3-band tiles
// use the browser's JPEG encoder; 4-band tiles use jpeg-multi.js.

import { encodeJpegMulti } from './jpeg-multi.js';

const TILE = 256;
const R2D = 180 / Math.PI;

/* ------------------------------------------------------------------------ */
/* Resampling onto a WGS84 grid                                              */
/* ------------------------------------------------------------------------ */

/**
 * Resample a loaded map (from loadGeoTIFF) onto a north-up lon/lat grid whose
 * pixels are square on the ground and match the map's own ground resolution.
 */
export function warpToWgs84(map, maxSide = 32_767) {
    const { corners, width: w, height: h, rgba, toPixel } = map;
    const pts = Object.values(corners);
    const west = Math.min(...pts.map((p) => p[0])), east = Math.max(...pts.map((p) => p[0]));
    const south = Math.min(...pts.map((p) => p[1])), north = Math.max(...pts.map((p) => p[1]));
    const cos = Math.cos(((north + south) / 2) / R2D);
    const { ul, ur } = corners;
    const groundPx = Math.hypot((ur[0] - ul[0]) * 111_320 * cos, (ur[1] - ul[1]) * 111_320) / w;
    let yres = groundPx / 111_320;
    let xres = yres / Math.max(0.05, cos);
    let W = Math.max(1, Math.round((east - west) / xres));
    let H = Math.max(1, Math.round((north - south) / yres));
    if (Math.max(W, H) > maxSide) { // keep within browser canvas limits
        const k = maxSide / Math.max(W, H);
        W = Math.max(1, Math.round(W * k)); H = Math.max(1, Math.round(H * k));
        xres = (east - west) / W; yres = (north - south) / H;
    }

    // Source pixel position for every 16th output pixel (exact projection),
    // bilinearly interpolated in between (fast, sub-pixel accurate at map scales).
    const G = 16, gw = Math.ceil(W / G) + 1, gh = Math.ceil(H / G) + 1;
    const gx = new Float64Array(gw * gh), gy = new Float64Array(gw * gh);
    for (let j = 0; j < gh; j++) {
        for (let i = 0; i < gw; i++) {
            const [c, r] = toPixel(west + (i * G + 0.5) * xres, north - (j * G + 0.5) * yres);
            gx[j * gw + i] = c - 0.5; gy[j * gw + i] = r - 0.5;
        }
    }

    const out = new Uint8ClampedArray(W * H * 4);
    const wx = new Float64Array(4), wy = new Float64Array(4);
    const cr = (t, wgt) => { // Catmull-Rom cubic weights
        const t2 = t * t, t3 = t2 * t;
        wgt[0] = 0.5 * (-t3 + 2 * t2 - t); wgt[1] = 0.5 * (3 * t3 - 5 * t2 + 2);
        wgt[2] = 0.5 * (-3 * t3 + 4 * t2 + t); wgt[3] = 0.5 * (t3 - t2);
    };
    for (let y = 0; y < H; y++) {
        const jy = Math.floor(y / G), fy = (y - jy * G) / G;
        for (let x = 0; x < W; x++) {
            const ix = Math.floor(x / G), fx = (x - ix * G) / G;
            const k00 = jy * gw + ix, k01 = k00 + 1, k10 = k00 + gw, k11 = k10 + 1;
            const sx = (gx[k00] * (1 - fx) + gx[k01] * fx) * (1 - fy) + (gx[k10] * (1 - fx) + gx[k11] * fx) * fy;
            const sy = (gy[k00] * (1 - fx) + gy[k01] * fx) * (1 - fy) + (gy[k10] * (1 - fx) + gy[k11] * fx) * fy;
            if (sx < -0.5 || sy < -0.5 || sx > w - 0.5 || sy > h - 0.5) continue; // outside the map
            const x0 = Math.floor(sx), y0 = Math.floor(sy);
            const ax = sx - x0, ay = sy - y0;
            const o = (y * W + x) * 4;
            // Interior: sharp bicubic (Catmull-Rom) on the 4x4 neighbourhood.
            if (x0 >= 1 && y0 >= 1 && x0 + 2 < w && y0 + 2 < h) {
                cr(ax, wx); cr(ay, wy);
                let r = 0, g = 0, b = 0, full = true;
                for (let j = 0; j < 4 && full; j++) {
                    const rowBase = (y0 - 1 + j) * w;
                    for (let i = 0; i < 4; i++) {
                        const p = (rowBase + x0 - 1 + i) * 4;
                        if (rgba[p + 3] === 0) { full = false; break; }
                        const k = wx[i] * wy[j];
                        r += rgba[p] * k; g += rgba[p + 1] * k; b += rgba[p + 2] * k;
                    }
                }
                if (full) { out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255; continue; }
            }
            // Near edges/empty areas: alpha-weighted bilinear so empty (black) neighbours don't darken the map.
            const cx0 = Math.max(0, Math.min(w - 1, x0)), cy0 = Math.max(0, Math.min(h - 1, y0));
            const x1 = Math.min(w - 1, cx0 + 1), y1 = Math.min(h - 1, cy0 + 1);
            const bx = Math.max(0, Math.min(1, sx - cx0)), by = Math.max(0, Math.min(1, sy - cy0));
            const p4 = [(cy0 * w + cx0) * 4, (cy0 * w + x1) * 4, (y1 * w + cx0) * 4, (y1 * w + x1) * 4];
            const wt = [(1 - bx) * (1 - by), bx * (1 - by), (1 - bx) * by, bx * by];
            let r = 0, g = 0, b = 0, a = 0;
            for (let n = 0; n < 4; n++) {
                const aw = wt[n] * rgba[p4[n] + 3];
                r += rgba[p4[n]] * aw; g += rgba[p4[n] + 1] * aw; b += rgba[p4[n] + 2] * aw; a += aw;
            }
            if (a < 127.5) continue; // mostly empty -> transparent
            out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = 255;
        }
    }
    return { width: W, height: H, rgba: out, west, north, xres, yres };
}

/** Halve an RGBA image (2x2 alpha-weighted average) for an overview level. */
function halve(img) {
    const { width: w, height: h, rgba } = img;
    const W = Math.max(1, Math.ceil(w / 2)), H = Math.max(1, Math.ceil(h / 2));
    const out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            let r = 0, g = 0, b = 0, a = 0, n = 0;
            for (let dy = 0; dy < 2; dy++) {
                const sy = Math.min(h - 1, 2 * y + dy);
                for (let dx = 0; dx < 2; dx++) {
                    const i = (sy * w + Math.min(w - 1, 2 * x + dx)) * 4;
                    const al = rgba[i + 3];
                    r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al; a += al; n++;
                }
            }
            if (a < 2 * 255) continue; // keep a pixel only if at least half of it is map
            const o = (y * W + x) * 4;
            out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = 255;
        }
    }
    return { width: W, height: H, rgba: out };
}

/* ------------------------------------------------------------------------ */
/* Tile encoding                                                             */
/* ------------------------------------------------------------------------ */

function jpegSampling(bytes) {
    // Read the SOF marker to learn the chroma subsampling the browser used.
    for (let i = 2; i < bytes.length - 9;) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const m = bytes[i + 1];
        const len = (bytes[i + 2] << 8) | bytes[i + 3];
        if (m >= 0xc0 && m <= 0xc2) {
            const n = bytes[i + 9];
            if (n !== 3) return [1, 1];
            const s0 = bytes[i + 11], s1 = bytes[i + 14];
            return [(s0 >> 4) / (s1 >> 4), (s0 & 15) / (s1 & 15)];
        }
        i += 2 + len;
    }
    return [2, 2];
}

async function encodeLevel(img, quality, background, withAlpha, onTile) {
    const { width: w, height: h, rgba } = img;
    const tx = Math.ceil(w / TILE), ty = Math.ceil(h / TILE);
    const jpegs = [];
    let sampling = null;
    let canvas, ctx, tileData;
    if (!withAlpha) {
        canvas = document.createElement('canvas');
        canvas.width = TILE; canvas.height = TILE;
        ctx = canvas.getContext('2d');
        tileData = new ImageData(TILE, TILE);
    }
    const raw = withAlpha ? new Uint8Array(TILE * TILE * 4) : null;
    for (let j = 0; j < ty; j++) {
        for (let i = 0; i < tx; i++) {
            const d = withAlpha ? raw : tileData.data;
            for (let y = 0; y < TILE; y++) {
                const sy = j * TILE + y;
                for (let x = 0; x < TILE; x++) {
                    const sx = i * TILE + x, o = (y * TILE + x) * 4;
                    const s = (sy * w + sx) * 4;
                    if (sx < w && sy < h && rgba[s + 3]) {
                        d[o] = rgba[s]; d[o + 1] = rgba[s + 1]; d[o + 2] = rgba[s + 2]; d[o + 3] = 255;
                    } else if (withAlpha) {
                        d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0;   // empty: fully transparent
                    } else {
                        d[o] = background[0]; d[o + 1] = background[1]; d[o + 2] = background[2]; d[o + 3] = 255;
                    }
                }
            }
            let bytes;
            if (withAlpha) {
                bytes = encodeJpegMulti(raw, TILE, TILE, 4, quality);
                if (((j * tx + i) & 7) === 7) await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
            } else {
                ctx.putImageData(tileData, 0, 0);
                const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', Math.min(0.95, Math.max(0.05, quality / 100))));
                bytes = new Uint8Array(await blob.arrayBuffer());
                if (!sampling) sampling = jpegSampling(bytes);
            }
            jpegs.push(bytes);
            onTile?.();
        }
    }
    if (canvas) canvas.width = canvas.height = 0;
    return { width: w, height: h, jpegs, sampling: sampling || [2, 2] };
}

/* ------------------------------------------------------------------------ */
/* TIFF container                                                            */
/* ------------------------------------------------------------------------ */

const T = { SHORT: 3, LONG: 4, DOUBLE: 12 };
const SIZE = { 3: 2, 4: 4, 12: 8 };

function writeTiff(ifds) {
    // Layout: header | all tile data | all IFDs (+ their out-of-line values)
    const chunks = [];
    let off = 8;
    for (const ifd of ifds) {
        ifd.offsets = []; ifd.counts = [];
        for (const t of ifd.tiles) {
            ifd.offsets.push(off); ifd.counts.push(t.length);
            chunks.push(t); off += t.length;
        }
    }
    if (off % 2) { chunks.push(new Uint8Array(1)); off++; }

    const entriesOf = (ifd) => [...ifd.tags,
        [324, T.LONG, ifd.offsets], [325, T.LONG, ifd.counts]].sort((a, b) => a[0] - b[0]);
    // Size the IFD area.
    let ifdBytes = 0;
    for (const ifd of ifds) {
        const e = entriesOf(ifd);
        let extra = 0;
        for (const [, type, vals] of e) { const n = vals.length * SIZE[type]; if (n > 4) extra += n + (n % 2); }
        ifdBytes += 2 + e.length * 12 + 4 + extra;
    }
    const buf = new ArrayBuffer(ifdBytes);
    const dv = new DataView(buf);
    let p = 0;
    const firstIfd = off;
    ifds.forEach((ifd, idx) => {
        const e = entriesOf(ifd);
        const ifdStart = p;
        let extra = ifdStart + 2 + e.length * 12 + 4;
        dv.setUint16(p, e.length, true); p += 2;
        for (const [tag, type, vals] of e) {
            dv.setUint16(p, tag, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, vals.length, true);
            const n = vals.length * SIZE[type];
            let q = n > 4 ? extra : p + 8;
            if (n > 4) { dv.setUint32(p + 8, firstIfd + extra, true); extra += n + (n % 2); }
            for (const v of vals) {
                if (type === T.SHORT) { dv.setUint16(q, v, true); q += 2; }
                else if (type === T.LONG) { dv.setUint32(q, v, true); q += 4; }
                else { dv.setFloat64(q, v, true); q += 8; }
            }
            p += 12;
        }
        dv.setUint32(p, idx < ifds.length - 1 ? firstIfd + extra : 0, true); // next IFD
        p = extra;
    });

    const header = new Uint8Array(8);
    const hv = new DataView(header.buffer);
    header[0] = 0x49; header[1] = 0x49; hv.setUint16(2, 42, true); hv.setUint32(4, firstIfd, true);
    return new Blob([header, ...chunks, new Uint8Array(buf)], { type: 'image/tiff' });
}

/* ------------------------------------------------------------------------ */
/* Public API                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Build the overlay GeoTIFF.
 * @param {object} map  result of loadGeoTIFF()
 * @param {{quality:number, transparent?:boolean, background?:string, onProgress?:(f:number)=>void}} opts
 * @returns {Promise<Blob>}
 */
export async function buildGeoTiff(map, opts) {
    const { quality = 70, transparent = true, background = '#000000', onProgress } = opts || {};
    const bg = background === 'none' ? [0, 0, 0]
        : [1, 3, 5].map((k) => parseInt(background.slice(k, k + 2), 16));
    // Already lat/lon and north-up: keep the map's own pixel grid (no resampling).
    const { ul, ur, ll } = map.corners;
    const northUp = Math.abs(ul[1] - ur[1]) < 1e-12 && Math.abs(ul[0] - ll[0]) < 1e-12;
    const base = map.epsg === 4326 && northUp
        ? { width: map.width, height: map.height, rgba: new Uint8ClampedArray(map.rgba), west: ul[0], north: ul[1],
            xres: (ur[0] - ul[0]) / map.width, yres: (ul[1] - ll[1]) / map.height }
        : warpToWgs84(map);
    if (!transparent) { // fill empty areas instead of masking them
        const d = base.rgba;
        for (let i = 0; i < d.length; i += 4) if (!d[i + 3]) { d[i] = bg[0]; d[i + 1] = bg[1]; d[i + 2] = bg[2]; d[i + 3] = 255; }
    }

    const levels = [base];
    while (Math.max(levels.at(-1).width, levels.at(-1).height) > TILE) levels.push(halve(levels.at(-1)));
    const totalTiles = levels.reduce((n, l) => n + Math.ceil(l.width / TILE) * Math.ceil(l.height / TILE), 0);
    let done = 0;
    const tick = () => { done++; if (onProgress && done % 16 === 0) onProgress(done / totalTiles); };

    let withAlpha = false;
    if (transparent) for (let i = 3; i < base.rgba.length; i += 4) if (!base.rgba[i]) { withAlpha = true; break; }

    // Zoom levels use the same quality: ATAK shows them at most zoom levels, so
    // compressing them harder makes the overlay look soft.
    const encoded = [];
    for (let k = 0; k < levels.length; k++) {
        encoded.push(await encodeLevel(levels[k], quality, bg, withAlpha, tick));
    }

    const ifds = [];
    encoded.forEach((lvl, k) => {
        const tags = [[256, T.LONG, [lvl.width]], [257, T.LONG, [lvl.height]], [284, T.SHORT, [1]],
            [322, T.SHORT, [TILE]], [323, T.SHORT, [TILE]],
            [254, T.LONG, [k === 0 ? 0 : 1]],                  // NewSubfileType: 1 = reduced-resolution overview
            [259, T.SHORT, [7]]];                               // JPEG
        if (withAlpha) {
            tags.push([258, T.SHORT, [8, 8, 8, 8]], [262, T.SHORT, [2]], [277, T.SHORT, [4]], // RGB + 1 extra
                [338, T.SHORT, [2]]);                                                       // ExtraSamples: unassociated alpha
        } else {
            tags.push([258, T.SHORT, [8, 8, 8]], [262, T.SHORT, [6]], [277, T.SHORT, [3]],  // YCbCr
                [530, T.SHORT, lvl.sampling]);                                              // YCbCrSubSampling, as encoded
        }
        if (k === 0) {
            tags.push([33550, T.DOUBLE, [base.xres, base.yres, 0]]);                 // ModelPixelScale
            tags.push([33922, T.DOUBLE, [0, 0, 0, base.west, base.north, 0]]);       // ModelTiepoint
            tags.push([34735, T.SHORT, [1, 1, 0, 4,                                   // GeoKeyDirectory
                1024, 0, 1, 2,      // GTModelType = geographic
                1025, 0, 1, 1,      // GTRasterType = PixelIsArea
                2048, 0, 1, 4326,   // GeographicType = WGS84
                2054, 0, 1, 9102]]); // angular unit = degree
        }
        ifds.push({ tags, tiles: lvl.jpegs });
    });
    onProgress?.(1);
    return writeTiff(ifds);
}
