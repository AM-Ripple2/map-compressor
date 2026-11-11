#!/usr/bin/env python3
"""
Map Compressor
==================

Batch-convert GeoTIFF maps into small, georeferenced JPEGs that ATAK can load.

For every GeoTIFF it finds, the tool:
  1. reads the georeferencing (CRS + geotransform, or ground control points),
  2. converts the pixels to 8-bit RGB (or grayscale) and fills no-data areas,
  3. encodes a JPEG at the chosen quality (default 70),
  4. re-attaches the georeferencing, and
  5. writes the result to an output folder.

Output formats (comma-separated with --format, default "kmz,geotiff"):
  kmz      -> name.kmz: JPEG + KML GroundOverlay. ATAK Import Manager ->
              "Image Overlay File". Empty areas are filled (black/white).
  geotiff  -> name.tif: WGS84, JPEG-compressed, zoom levels, and an alpha band
              that keeps empty areas (e.g. orthomosaic borders) see-through in ATAK.
  jpeg     -> name.jpg + .jgw + .prj + .jpg.aux.xml for the atak/imagery/ folder.

Optionally (--package NAME) the overlays are bundled into one ATAK Data Package
(.zip with MANIFEST/manifest.xml) so a whole map set imports in one step.

Requires:  pip install rasterio pillow numpy
"""

from __future__ import annotations

import argparse
import math
import sys
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape

import numpy as np
from PIL import Image

try:
    import rasterio
    from rasterio.control import GroundControlPoint
    from rasterio.crs import CRS
    from rasterio.enums import ColorInterp, Resampling
    from rasterio.transform import Affine, array_bounds
    from rasterio.warp import calculate_default_transform, reproject
except ImportError:  # pragma: no cover
    sys.exit("This tool needs rasterio:  pip install rasterio pillow numpy")

__version__ = "0.1.0"

Image.MAX_IMAGE_PIXELS = None          # maps are big; we trust local files
JPEG_MAX_DIM = 65500                   # hard limit of the JPEG format
TIFF_EXTS = {".tif", ".tiff", ".gtif", ".gtiff"}
WGS84 = CRS.from_epsg(4326)


class NotGeoreferenced(Exception):
    pass


@dataclass
class Raster:
    """An 8-bit image plus where it sits on the earth."""
    pixels: np.ndarray            # (h, w, 3) RGB or (h, w) grayscale, uint8
    valid: np.ndarray             # (h, w) bool, False = no-data
    crs: CRS
    transform: Affine | None      # set when georeferenced by geotransform
    gcps: list | None = None      # set when georeferenced by control points


# --------------------------------------------------------------------------- #
# Reading
# --------------------------------------------------------------------------- #

def _stretch_to_uint8(band: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Linear 2-98% stretch of a non-8-bit band into 0-255."""
    vals = band[valid] if valid.any() else band.ravel()
    if vals.size > 2_000_000:                       # sample big rasters
        vals = vals[:: vals.size // 2_000_000]
    lo, hi = np.percentile(vals.astype(np.float64), (2, 98))
    if hi <= lo:
        hi = lo + 1
    out = (band.astype(np.float32) - lo) * (255.0 / (hi - lo))
    return np.clip(out, 0, 255).astype(np.uint8)


def load_raster(path: Path, max_dim: int | None, background: int) -> Raster:
    with rasterio.open(path) as src:
        gcps, gcp_crs = src.gcps
        has_geotransform = src.crs is not None and not src.transform.is_identity
        if not has_geotransform and not (gcps and gcp_crs):
            raise NotGeoreferenced("no CRS/geotransform or GCPs found")

        # Decide output size (optional downscale, and never above JPEG limit).
        limit = min(max_dim or JPEG_MAX_DIM, JPEG_MAX_DIM)
        scale = min(1.0, limit / max(src.width, src.height))
        out_w = max(1, round(src.width * scale))
        out_h = max(1, round(src.height * scale))

        # Pick bands.
        ci = list(src.colorinterp)
        colormap = None
        if src.count == 1 and ci[0] == ColorInterp.palette:
            try:
                colormap = src.colormap(1)
            except ValueError:
                colormap = None
        if src.count >= 3:
            idx = {c: i + 1 for i, c in enumerate(ci)}
            rgb = (ColorInterp.red, ColorInterp.green, ColorInterp.blue)
            bands = [idx[c] for c in rgb] if all(c in idx for c in rgb) else [1, 2, 3]
        else:
            bands = [1]

        resampling = Resampling.nearest if colormap else Resampling.average
        data = src.read(bands, out_shape=(len(bands), out_h, out_w), resampling=resampling)
        valid = src.dataset_mask(out_shape=(out_h, out_w), resampling=Resampling.nearest) > 0
        # Many exported RGBA maps leave band 4 untagged; treat it as alpha.
        if (src.count == 4 and ci[3] == ColorInterp.undefined
                and len(set(bands)) == 3 and 4 not in bands and src.nodata is None):
            alpha = src.read(4, out_shape=(out_h, out_w), resampling=Resampling.nearest)
            valid &= alpha > 0

        sx, sy = src.width / out_w, src.height / out_h
        transform = src.transform * Affine.scale(sx, sy) if has_geotransform else None
        crs = src.crs if has_geotransform else gcp_crs
        if not has_geotransform:
            gcps = [GroundControlPoint(row=g.row / sy, col=g.col / sx, x=g.x, y=g.y, z=g.z or 0.0)
                    for g in gcps]
        else:
            gcps = None

    # Convert to 8-bit display pixels.
    if colormap:
        lut = np.zeros((max(256, max(colormap) + 1), 3), np.uint8)
        for k, v in colormap.items():
            lut[k] = v[:3]
        pixels = lut[data[0]]
    else:
        if data.dtype != np.uint8:
            data = np.stack([_stretch_to_uint8(b, valid) for b in data])
        pixels = np.moveaxis(data, 0, -1) if data.shape[0] == 3 else data[0]

    pixels = np.ascontiguousarray(pixels)
    pixels[~valid] = background
    return Raster(pixels, valid, crs, transform, gcps)


# --------------------------------------------------------------------------- #
# Reprojection (used for KMZ, which must be WGS84 north-up, and for GCP files)
# --------------------------------------------------------------------------- #

def _is_rotated(t: Affine) -> bool:
    return abs(t.b) > 1e-12 or abs(t.d) > 1e-12


def _corner_gcps(t: Affine, w: int, h: int) -> list:
    pts = [(0, 0), (w, 0), (0, h), (w, h), (w / 2, h / 2)]
    return [GroundControlPoint(row=r, col=c, x=(t * (c, r))[0], y=(t * (c, r))[1], z=0.0)
            for c, r in pts]


def warp(r: Raster, dst_crs: CRS, background: int) -> Raster:
    h, w = r.valid.shape
    src_kw = {}
    if r.gcps:
        gcps = r.gcps
    elif _is_rotated(r.transform):
        gcps = _corner_gcps(r.transform, w, h)
    else:
        gcps = None

    if gcps:
        dst_t, dw, dh = calculate_default_transform(r.crs, dst_crs, w, h, gcps=gcps)
        src_kw["gcps"] = gcps
    else:
        left, bottom, right, top = array_bounds(h, w, r.transform)
        dst_t, dw, dh = calculate_default_transform(r.crs, dst_crs, w, h,
                                                    left, bottom, right, top)
        src_kw["src_transform"] = r.transform

    if dst_crs.is_geographic:
        # Default output pixels are square in *degrees*, which over-samples east-west
        # by 1/cos(latitude). Make them square on the ground instead (fewer pixels,
        # same detail).
        lat = dst_t.f + dst_t.e * dh / 2
        bottom = dst_t.f + dst_t.e * dh
        # Match the source's ground resolution (the default choice is coarser).
        yres = pixel_size_m(r) / 111_320 if r.transform is not None else abs(dst_t.e)
        xres = yres / max(0.05, math.cos(math.radians(lat)))
        left, top = dst_t.c, dst_t.f
        right = left + dst_t.a * dw
        dst_t = Affine(xres, 0, left, 0, -yres, top)
        dw = max(1, round((right - left) / xres))
        dh = max(1, round((top - bottom) / yres))

    bands = r.pixels[None, ...] if r.pixels.ndim == 2 else np.moveaxis(r.pixels, -1, 0)
    out = np.full((bands.shape[0], dh, dw), background, np.uint8)
    reproject(np.ascontiguousarray(bands), out, src_crs=r.crs, dst_transform=dst_t,
              dst_crs=dst_crs, resampling=Resampling.cubic, **src_kw)  # sharper than bilinear
    valid = np.zeros((dh, dw), np.uint8)
    reproject(r.valid.astype(np.uint8), valid, src_crs=r.crs, dst_transform=dst_t,
              dst_crs=dst_crs, resampling=Resampling.nearest, **src_kw)
    valid = valid > 0

    pixels = out[0] if out.shape[0] == 1 else np.moveaxis(out, 0, -1)
    pixels = np.ascontiguousarray(pixels)
    pixels[~valid] = background
    return Raster(pixels, valid, dst_crs, dst_t)


def fit_within(r: Raster, max_dim: int | None) -> Raster:
    """Shrink after reprojection if it grew past the size limit."""
    limit = min(max_dim or JPEG_MAX_DIM, JPEG_MAX_DIM)
    h, w = r.valid.shape
    if max(h, w) <= limit:
        return r
    s = limit / max(h, w)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    img = Image.fromarray(r.pixels).resize((nw, nh), Image.LANCZOS)
    msk = Image.fromarray(r.valid.astype(np.uint8) * 255).resize((nw, nh), Image.NEAREST)
    t = r.transform * Affine.scale(w / nw, h / nh)
    return Raster(np.asarray(img), np.asarray(msk) > 0, r.crs, t)


# --------------------------------------------------------------------------- #
# Writing
# --------------------------------------------------------------------------- #

def _jpeg_bytes_to(path: Path, pixels: np.ndarray, quality: int) -> None:
    # Baseline (non-progressive) JPEG: GDAL/ATAK read these fastest.
    Image.fromarray(pixels).save(path, "JPEG", quality=quality, optimize=True)


def write_georeferenced_jpeg(r: Raster, out_jpg: Path, quality: int) -> list[Path]:
    t = r.transform
    _jpeg_bytes_to(out_jpg, r.pixels, quality)

    # World file: pixel size / rotation / centre of upper-left pixel.
    jgw = out_jpg.with_suffix(".jgw")
    cx = t.c + t.a / 2 + t.b / 2
    cy = t.f + t.d / 2 + t.e / 2
    jgw.write_text("\n".join(f"{v:.12f}" for v in (t.a, t.d, t.b, t.e, cx, cy)) + "\n")

    prj = out_jpg.with_suffix(".prj")
    try:
        prj.write_text(r.crs.to_wkt(morph_to_esri_dialect=True))
    except Exception:
        prj.write_text(r.crs.to_wkt())

    # GDAL sidecar: carries the CRS, which a world file alone cannot.
    aux = out_jpg.with_name(out_jpg.name + ".aux.xml")
    aux.write_text(
        "<PAMDataset>\n"
        f"  <SRS>{escape(r.crs.to_wkt())}</SRS>\n"
        f"  <GeoTransform>{t.c!r}, {t.a!r}, {t.b!r}, {t.f!r}, {t.d!r}, {t.e!r}</GeoTransform>\n"
        "</PAMDataset>\n"
    )
    return [out_jpg, jgw, prj, aux]


def quad_corners(r: Raster) -> tuple[list, float]:
    """Lon/lat of the image corners (KML order: LL, LR, UR, UL) and the worst
    error, in metres, of drawing the image as that 4-corner quad instead of
    reprojecting it pixel-by-pixel."""
    from rasterio.warp import transform as tx
    h, w = r.valid.shape
    t = r.transform
    us = np.linspace(0, 1, 9)
    grid = [(u, v) for v in us for u in us]
    xs, ys = zip(*[t * (u * w, v * h) for u, v in grid])
    lon, lat = tx(r.crs, WGS84, list(xs), list(ys))
    lon, lat = np.array(lon).reshape(9, 9), np.array(lat).reshape(9, 9)
    ul, ur, ll, lr = (lon[0, 0], lat[0, 0]), (lon[0, -1], lat[0, -1]), \
                     (lon[-1, 0], lat[-1, 0]), (lon[-1, -1], lat[-1, -1])
    U, V = np.meshgrid(us, us)
    bl_lon = (1-U)*(1-V)*ul[0] + U*(1-V)*ur[0] + (1-U)*V*ll[0] + U*V*lr[0]
    bl_lat = (1-U)*(1-V)*ul[1] + U*(1-V)*ur[1] + (1-U)*V*ll[1] + U*V*lr[1]
    m_per_deg = 111_320.0
    err = np.hypot((bl_lon - lon) * m_per_deg * np.cos(np.radians(lat)),
                   (bl_lat - lat) * m_per_deg)
    return [ll, lr, ur, ul], float(err.max())


def pixel_size_m(r: Raster) -> float:
    (ll, lr, ur, ul), _ = quad_corners(r)
    h, w = r.valid.shape
    width_m = math.hypot((ur[0] - ul[0]) * 111_320 * math.cos(math.radians(ul[1])),
                         (ur[1] - ul[1]) * 111_320)
    return width_m / max(w, 1)


def _north_up(quad: list, height: int) -> bool:
    """True when the 4 corners form a north-up lon/lat rectangle (within 1/4 pixel)."""
    ll, lr, ur, ul = quad
    tol = abs(ul[1] - ll[1]) / height / 4
    return (abs(ul[1] - ur[1]) <= tol and abs(ll[1] - lr[1]) <= tol
            and abs(ul[0] - ll[0]) <= tol and abs(ur[0] - lr[0]) <= tol)


def write_kmz(r: Raster, out_kmz: Path, quality: int, name: str,
              quad: list | None = None) -> Path:
    """KMZ GroundOverlay. With `quad`, the image keeps its own projection and is
    pinned by its 4 corners (gx:LatLonQuad, the same form ATAK's Rubber Sheet
    tool writes). Otherwise `r` must be WGS84 north-up and a LatLonBox is used."""
    img_name = f"files/{_safe(name)}.jpg"
    if quad and _north_up(quad, r.valid.shape[0]):
        # Corners already form a lon/lat rectangle: use the classic LatLonBox,
        # which every KML client (incl. iOS TAK apps) understands.
        ll, lr, ur, ul = quad
        n, so = (ul[1] + ur[1]) / 2, (ll[1] + lr[1]) / 2
        e, wv = (ur[0] + lr[0]) / 2, (ul[0] + ll[0]) / 2
        geo = (f"    <LatLonBox>\n      <north>{n:.10f}</north>\n"
               f"      <south>{so:.10f}</south>\n      <east>{e:.10f}</east>\n"
               f"      <west>{wv:.10f}</west>\n    </LatLonBox>")
    elif quad:
        coords = " ".join(f"{lo:.10f},{la:.10f},0" for lo, la in quad)
        geo = f"    <gx:LatLonQuad>\n      <coordinates>{coords}</coordinates>\n    </gx:LatLonQuad>"
    else:
        h, w = r.valid.shape
        west, south, east, north = array_bounds(h, w, r.transform)
        geo = (f"    <LatLonBox>\n      <north>{north:.10f}</north>\n"
               f"      <south>{south:.10f}</south>\n      <east>{east:.10f}</east>\n"
               f"      <west>{west:.10f}</west>\n    </LatLonBox>")
    kml = f"""<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <GroundOverlay>
    <name>{escape(name)}</name>
    <Icon><href>{img_name}</href></Icon>
{geo}
  </GroundOverlay>
</kml>
"""
    tmp_jpg = out_kmz.with_suffix(".tmp.jpg")
    _jpeg_bytes_to(tmp_jpg, r.pixels, quality)
    try:
        with zipfile.ZipFile(out_kmz, "w") as z:
            z.writestr("doc.kml", kml, compress_type=zipfile.ZIP_DEFLATED)
            z.write(tmp_jpg, img_name, compress_type=zipfile.ZIP_STORED)  # already compressed
    finally:
        tmp_jpg.unlink(missing_ok=True)
    return out_kmz


def write_data_package(kmzs: list[Path], out_zip: Path, name: str) -> Path:
    """ATAK Data Package (a.k.a. Mission Package): zip + MANIFEST/manifest.xml."""
    pkg_uid = str(uuid.uuid4())
    entries = []
    with zipfile.ZipFile(out_zip, "w") as z:
        for k in kmzs:
            entry = f"{uuid.uuid4().hex}/{k.name}"
            z.write(k, entry, compress_type=zipfile.ZIP_STORED)
            entries.append(entry)
        contents = "\n".join(
            f'    <Content ignore="false" zipEntry="{escape(e)}"/>' for e in entries)
        manifest = f"""<MissionPackageManifest version="2">
  <Configuration>
    <Parameter name="uid" value="{pkg_uid}"/>
    <Parameter name="name" value="{escape(name)}"/>
  </Configuration>
  <Contents>
{contents}
  </Contents>
</MissionPackageManifest>
"""
        z.writestr("MANIFEST/manifest.xml", manifest, compress_type=zipfile.ZIP_DEFLATED)
    return out_zip


# --------------------------------------------------------------------------- #
# Driver
# --------------------------------------------------------------------------- #

def _safe(s: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in s)


def _human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} GB"


def find_inputs(paths: list[Path], recursive: bool) -> list[tuple[Path, Path]]:
    """Return (file, path relative to its input root) pairs."""
    found = []
    for p in paths:
        if p.is_dir():
            it = p.rglob("*") if recursive else p.glob("*")
            for f in sorted(it):
                if f.is_file() and f.suffix.lower() in TIFF_EXTS and not f.name.startswith("._"):
                    found.append((f, f.relative_to(p)))
        elif p.is_file():
            found.append((p, Path(p.name)))
        else:
            print(f"! not found: {p}", file=sys.stderr)
    return found


def write_geotiff(r: Raster, out: Path, quality: int, background: int) -> Path:
    """Overlay GeoTIFF that TAK clients read natively: WGS84 (EPSG:4326),
    JPEG-compressed 256 px tiles, and internal overviews (zoom levels).

    Maps with empty areas get an RGBA *alpha band* so those areas stay
    see-through. (ATAK ignores GDAL's separate internal mask and draws masked
    areas black, but it honours an alpha band; ATAK's GDAL also has no WebP
    codec, so JPEG is used.) Maps without empty areas are written as standard
    3-band YCbCr JPEG, which is about half the size.
    """
    r84 = r if (r.crs == WGS84 and not _is_rotated(r.transform)) else warp(r, WGS84, background)
    h, w = r84.valid.shape
    rgb = np.repeat(r84.pixels[None], 3, axis=0) if r84.pixels.ndim == 2 else np.moveaxis(r84.pixels, -1, 0)
    has_empty = not r84.valid.all()
    profile = dict(driver="GTiff", width=w, height=h, dtype="uint8", crs=WGS84, transform=r84.transform,
                   compress="JPEG", jpeg_quality=quality, tiled=True, blockxsize=256, blockysize=256)
    if has_empty:
        rgb = rgb.copy()
        rgb[:, ~r84.valid] = 0
        bands = np.concatenate([rgb, (r84.valid.astype(np.uint8) * 255)[None]])
        profile.update(count=4, photometric="RGB", alpha="YES")
    else:
        bands = rgb
        profile.update(count=3, photometric="YCBCR")
    # Zoom levels use the same quality: ATAK shows them at most zoom levels.
    with rasterio.Env(JPEG_QUALITY_OVERVIEW=quality):
        with rasterio.open(out, "w", **profile) as ds:
            ds.write(np.ascontiguousarray(bands))
            levels, f = [], 2
            while max(w, h) / f >= 256:
                levels.append(f)
                f *= 2
            if levels:
                ds.build_overviews(levels, Resampling.average)
    return out


FORMATS = ("kmz", "geotiff", "jpeg")
FOLDER = {"kmz": "kmz", "geotiff": "geotiff", "jpeg": "jpeg"}


def convert_all(inputs: list[Path], out_dir: Path, quality: int = 70,
                formats: tuple[str, ...] = ("kmz", "geotiff"),
                max_dim: int | None = None, recursive: bool = False,
                background: str = "black", package: str | None = None) -> dict:
    if isinstance(formats, str):
        formats = tuple(f.strip() for f in formats.split(",") if f.strip())
    bad = [f for f in formats if f not in FORMATS]
    if bad or not formats:
        raise ValueError(f"unknown format(s) {bad}; choose from {', '.join(FORMATS)}")
    bg = 255 if background == "white" else 0
    out_dir.mkdir(parents=True, exist_ok=True)
    files = find_inputs(inputs, recursive)
    if not files:
        print("No GeoTIFF files found.")
        return {"ok": 0, "failed": 0}

    sub = len(formats) > 1                 # one sub-folder per format when making several
    def target(fmt, stem, ext):
        p = out_dir / (FOLDER[fmt] if sub else "") / stem.parent / (stem.name + ext)
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    totals = {f: 0 for f in formats}
    total_in = ok = failed = 0
    made: dict[str, list[Path]] = {f: [] for f in formats}
    for i, (src, rel) in enumerate(files, 1):
        stem = rel.parent / rel.stem          # keep dots inside names (e.g. "V1.0")
        print(f"[{i}/{len(files)}] {rel} ... ", end="", flush=True)
        try:
            r = load_raster(src, max_dim, bg)
            if r.gcps:                      # control points -> real geotransform first
                r = fit_within(warp(r, r.crs, bg), max_dim)
            sizes = {}
            if "kmz" in formats:
                kmz = target("kmz", stem, ".kmz")
                quad, err_m = quad_corners(r)
                if err_m <= max(1.0, pixel_size_m(r)):
                    write_kmz(r, kmz, quality, stem.name, quad=quad)
                else:                                                  # large area: reproject
                    r84 = r if (r.crs == WGS84 and not _is_rotated(r.transform)) else warp(r, WGS84, bg)
                    write_kmz(fit_within(r84, max_dim), kmz, quality, stem.name)
                made["kmz"].append(kmz)
                sizes["kmz"] = kmz.stat().st_size
            if "geotiff" in formats:
                tif = write_geotiff(r, target("geotiff", stem, ".tif"), quality, bg)
                made["geotiff"].append(tif)
                sizes["geotiff"] = tif.stat().st_size
            if "jpeg" in formats:
                outs = write_georeferenced_jpeg(r, target("jpeg", stem, ".jpg"), quality)
                sizes["jpeg"] = sum(p.stat().st_size for p in outs)
            size_in = src.stat().st_size
            total_in += size_in
            for f, n in sizes.items():
                totals[f] += n
            empty = 100 * (1 - r.valid.mean())
            print(f"{_human(size_in)} -> " + ", ".join(f"{f.upper()} {_human(n)}" for f, n in sizes.items())
                  + (f"  ({empty:.0f}% empty: transparent in GeoTIFF)" if empty >= 0.5 and "geotiff" in formats else ""))
            ok += 1
        except NotGeoreferenced as e:
            print(f"SKIPPED ({e})")
            failed += 1
        except Exception as e:  # keep going on bad files
            print(f"FAILED ({type(e).__name__}: {e})")
            failed += 1

    pkg_path = None
    pkg_files = made.get("geotiff") or made.get("kmz") or []
    if package and pkg_files:
        pkg_path = write_data_package(pkg_files, out_dir / f"{_safe(package)}.zip", package)
        print(f"\nATAK data package ({'GeoTIFF' if made.get('geotiff') else 'KMZ'}): "
              f"{pkg_path} ({_human(pkg_path.stat().st_size)})")

    print(f"\nDone: {ok} converted, {failed} skipped/failed.")
    if total_in:
        print(f"Original total: {_human(total_in)}. "
              + ", ".join(f"{f.upper()}: {_human(n)} ({100 * (1 - n / total_in):.0f}% smaller)"
                          for f, n in totals.items()))
    print(f"Output: {out_dir.resolve()}")
    return {"ok": ok, "failed": failed, "package": pkg_path, "files": made}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="map_compress",
        description="Convert GeoTIFF maps and orthomosaics into small georeferenced overlays for TAK.")
    ap.add_argument("inputs", nargs="+", type=Path, help="GeoTIFF files and/or folders")
    ap.add_argument("-o", "--output", type=Path, default=Path("atak_maps"),
                    help="output folder (default: ./atak_maps)")
    ap.add_argument("-q", "--quality", type=int, default=70,
                    help="JPEG quality 1-95 (default 70)")
    ap.add_argument("-f", "--format", default="kmz,geotiff",
                    help="comma-separated: kmz (JPEG KMZ overlay), geotiff (JPEG GeoTIFF with "
                         "transparency), jpeg (JPG + world-file sidecars). Default: kmz,geotiff")
    ap.add_argument("--max-dim", type=int, default=None,
                    help="optional: downscale so the longest side is at most N pixels")
    ap.add_argument("-r", "--recursive", action="store_true", help="search sub-folders")
    ap.add_argument("--background", choices=["black", "white"], default="black",
                    help="fill colour for empty areas in KMZ/JPEG output (GeoTIFF keeps them transparent)")
    ap.add_argument("--package", metavar="NAME",
                    help="also bundle the overlays (GeoTIFFs if made, else KMZs) into one ATAK "
                         "Data Package NAME.zip")
    ap.add_argument("--version", action="version", version=__version__)
    a = ap.parse_args(argv)

    if not 1 <= a.quality <= 95:
        ap.error("--quality must be between 1 and 95")
    formats = tuple(f.strip().lower() for f in a.format.split(",") if f.strip())
    if not formats or any(f not in FORMATS for f in formats):
        ap.error(f"--format must be a comma-separated list of: {', '.join(FORMATS)}")
    if a.package and not ({"kmz", "geotiff"} & set(formats)):
        ap.error("--package needs kmz or geotiff output")

    res = convert_all(a.inputs, a.output, a.quality, formats, a.max_dim,
                      a.recursive, a.background, a.package)
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
