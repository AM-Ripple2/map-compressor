// Map Compressor - baseline JPEG encoder for N interleaved components
// (no colour transform, no chroma subsampling). Browsers can only encode
// 3-channel YCbCr JPEG; TIFF tiles for an RGBA GeoTIFF need 4 raw components
// (R, G, B, alpha), which is what this produces. Written from ITU-T T.81
// (baseline sequential DCT, Annex K example tables).

const ZIGZAG = new Uint8Array([
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63]);

// Annex K.1 luminance quantisation table (natural order)
const BASE_Q = [
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];

// Annex K.3 luminance Huffman tables
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_VALS = [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
    0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
    0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
    0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
    0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
    0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa];

function buildHuff(bits, vals) {
    const code = new Uint16Array(256), size = new Uint8Array(256);
    let c = 0, k = 0;
    for (let len = 1; len <= 16; len++) {
        for (let i = 0; i < bits[len - 1]; i++) { code[vals[k]] = c; size[vals[k]] = len; c++; k++; }
        c <<= 1;
    }
    return { code, size };
}
const DC = buildHuff(DC_BITS, DC_VALS);
const AC = buildHuff(AC_BITS, AC_VALS);

// AAN scale factors for the float forward DCT
const AAN = [1, 1.387039845, 1.306562965, 1.175875602, 1, 0.785694958, 0.541196100, 0.275899379];

function quantTables(quality) {
    const q = Math.min(100, Math.max(1, Math.round(quality)));
    const scale = q < 50 ? 5000 / q : 200 - 2 * q;
    const qt = new Uint8Array(64);              // natural order
    for (let i = 0; i < 64; i++) qt[i] = Math.min(255, Math.max(1, Math.floor((BASE_Q[i] * scale + 50) / 100)));
    const div = new Float32Array(64);           // 1 / (q * AAN scaling * 8)
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) div[r * 8 + c] = 1 / (qt[r * 8 + c] * AAN[r] * AAN[c] * 8);
    return { qt, div };
}

class BitWriter {
    constructor(cap = 1 << 16) { this.buf = new Uint8Array(cap); this.len = 0; this.acc = 0; this.n = 0; }
    byte(b) {
        if (this.len >= this.buf.length) { const nb = new Uint8Array(this.buf.length * 2); nb.set(this.buf); this.buf = nb; }
        this.buf[this.len++] = b;
    }
    bytes(arr) { for (const b of arr) this.byte(b); }
    bits(value, count) {
        for (let i = count - 1; i >= 0; i--) {
            this.acc = (this.acc << 1) | ((value >> i) & 1);
            if (++this.n === 8) { this.byte(this.acc); if (this.acc === 0xff) this.byte(0); this.acc = 0; this.n = 0; }
        }
    }
    flush() { if (this.n) this.bits(0x7f, 8 - this.n); }
}

const tmp = new Float32Array(64);
const coef = new Int32Array(64);

/** Forward DCT (float AAN) + quantisation of one 8x8 block (values already level-shifted). */
function fdctQuant(blk, div) {
    for (let i = 0; i < 64; i += 8) { // rows
        const t0 = blk[i] + blk[i + 7], t7 = blk[i] - blk[i + 7];
        const t1 = blk[i + 1] + blk[i + 6], t6 = blk[i + 1] - blk[i + 6];
        const t2 = blk[i + 2] + blk[i + 5], t5 = blk[i + 2] - blk[i + 5];
        const t3 = blk[i + 3] + blk[i + 4], t4 = blk[i + 3] - blk[i + 4];
        let t10 = t0 + t3, t13 = t0 - t3, t11 = t1 + t2, t12 = t1 - t2;
        tmp[i] = t10 + t11; tmp[i + 4] = t10 - t11;
        let z1 = (t12 + t13) * 0.707106781;
        tmp[i + 2] = t13 + z1; tmp[i + 6] = t13 - z1;
        t10 = t4 + t5; t11 = t5 + t6; t12 = t6 + t7;
        const z5 = (t10 - t12) * 0.382683433, z2 = 0.541196100 * t10 + z5, z4 = 1.306562965 * t12 + z5, z3 = t11 * 0.707106781;
        const z11 = t7 + z3, z13 = t7 - z3;
        tmp[i + 5] = z13 + z2; tmp[i + 3] = z13 - z2; tmp[i + 1] = z11 + z4; tmp[i + 7] = z11 - z4;
    }
    for (let i = 0; i < 8; i++) { // columns
        const t0 = tmp[i] + tmp[i + 56], t7 = tmp[i] - tmp[i + 56];
        const t1 = tmp[i + 8] + tmp[i + 48], t6 = tmp[i + 8] - tmp[i + 48];
        const t2 = tmp[i + 16] + tmp[i + 40], t5 = tmp[i + 16] - tmp[i + 40];
        const t3 = tmp[i + 24] + tmp[i + 32], t4 = tmp[i + 24] - tmp[i + 32];
        let t10 = t0 + t3, t13 = t0 - t3, t11 = t1 + t2, t12 = t1 - t2;
        tmp[i] = t10 + t11; tmp[i + 32] = t10 - t11;
        const z1 = (t12 + t13) * 0.707106781;
        tmp[i + 16] = t13 + z1; tmp[i + 48] = t13 - z1;
        t10 = t4 + t5; t11 = t5 + t6; t12 = t6 + t7;
        const z5 = (t10 - t12) * 0.382683433, z2 = 0.541196100 * t10 + z5, z4 = 1.306562965 * t12 + z5, z3 = t11 * 0.707106781;
        const z11 = t7 + z3, z13 = t7 - z3;
        tmp[i + 40] = z13 + z2; tmp[i + 24] = z13 - z2; tmp[i + 8] = z11 + z4; tmp[i + 56] = z11 - z4;
    }
    for (let i = 0; i < 64; i++) coef[i] = Math.round(tmp[i] * div[i]);
}

function category(v) { let a = v < 0 ? -v : v, n = 0; while (a) { n++; a >>= 1; } return n; }

function encodeBlock(bw, dc) { // coef is natural order, dc = previous DC (returns new DC)
    const d = coef[0] - dc;
    const cd = category(d);
    bw.bits(DC.code[cd], DC.size[cd]);
    if (cd) bw.bits(d < 0 ? d + (1 << cd) - 1 : d, cd);
    let run = 0;
    for (let k = 1; k < 64; k++) {
        const v = coef[ZIGZAG[k]];
        if (v === 0) { run++; continue; }
        while (run > 15) { bw.bits(AC.code[0xf0], AC.size[0xf0]); run -= 16; }
        const c = category(v), sym = (run << 4) | c;
        bw.bits(AC.code[sym], AC.size[sym]);
        bw.bits(v < 0 ? v + (1 << c) - 1 : v, c);
        run = 0;
    }
    if (run) bw.bits(AC.code[0], AC.size[0]); // EOB
    return coef[0];
}

/**
 * Encode an interleaved 8-bit image (width*height*nc bytes) as a baseline JPEG
 * with nc components, each sampled 1x1, no colour transform.
 * width and height must be multiples of 8 (TIFF tiles are 256x256).
 */
export function encodeJpegMulti(data, width, height, nc, quality) {
    const { qt, div } = quantTables(quality);
    const bw = new BitWriter(width * height);
    bw.bytes([0xff, 0xd8]);                                        // SOI
    bw.bytes([0xff, 0xdb, 0, 67, 0]);                              // DQT, table 0
    for (let k = 0; k < 64; k++) bw.byte(qt[ZIGZAG[k]]);
    bw.bytes([0xff, 0xc0, 0, 8 + 3 * nc, 8, height >> 8, height & 255, width >> 8, width & 255, nc]); // SOF0
    for (let c = 0; c < nc; c++) bw.bytes([c + 1, 0x11, 0]);
    const dht = [0x00, ...DC_BITS, ...DC_VALS, 0x10, ...AC_BITS, ...AC_VALS];
    bw.bytes([0xff, 0xc4, (dht.length + 2) >> 8, (dht.length + 2) & 255, ...dht]); // DHT
    bw.bytes([0xff, 0xda, 0, 6 + 2 * nc, nc]);                    // SOS
    for (let c = 0; c < nc; c++) bw.bytes([c + 1, 0x00]);
    bw.bytes([0, 63, 0]);

    const blk = new Float32Array(64);
    const prev = new Int32Array(nc);
    const row = width * nc;
    for (let by = 0; by < height; by += 8) {
        for (let bx = 0; bx < width; bx += 8) {
            for (let c = 0; c < nc; c++) {
                const base = by * row + bx * nc + c;
                const first = data[base];
                let flat = true;
                for (let y = 0, k = 0; y < 8; y++) {
                    let p = base + y * row;
                    for (let x = 0; x < 8; x++, k++, p += nc) { const v = data[p]; blk[k] = v - 128; if (v !== first) flat = false; }
                }
                if (flat) { // constant block: DC only (very common for alpha and empty areas)
                    coef.fill(0);
                    coef[0] = Math.round((first - 128) * 8 / qt[0]);
                } else {
                    fdctQuant(blk, div);
                }
                prev[c] = encodeBlock(bw, prev[c]);
            }
        }
    }
    bw.flush();
    bw.bytes([0xff, 0xd9]);                                        // EOI
    return bw.buf.slice(0, bw.len);
}
