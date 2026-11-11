package com.atakmap.android.mapcompressor.plugin;

import org.gdal.gdal.Band;
import org.gdal.gdal.Dataset;
import org.gdal.gdal.ProgressCallback;
import org.gdal.gdal.TranslateOptions;
import org.gdal.gdal.gdal;
import org.gdal.gdalconst.gdalconstConstants;
import org.gdal.osr.SpatialReference;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Vector;

/**
 * Converts a GeoTIFF / orthomosaic into a compact overlay GeoTIFF using ATAK's
 * bundled GDAL, in the format verified to display (with transparency) in ATAK:
 * WGS84, JPEG-compressed 256 px tiles, RGBA alpha band when the map has empty
 * areas (otherwise 3-band YCbCr), and internal overviews.
 *
 * ATAK ignores GDAL internal masks for image overlays and its GDAL has no WebP
 * codec, which is why an alpha band with JPEG compression is used.
 */
final class GdalCompressor {

    /** What we learned about a source file. */
    static final class SourceInfo {
        String path;
        String name;
        long fileSize;
        int width;
        int height;
        int bandCount;
        boolean eightBit;
        boolean palette;
        int alphaBand;          // 1-based band index of the alpha band, or 0
        double emptyFraction;   // share of pixels that are fully transparent (0..1)
    }

    interface Progress {
        void onProgress(double fraction, String message);
    }

    private GdalCompressor() {
    }

    static SourceInfo inspect(File file) throws IOException {
        Dataset ds = open(file);
        try {
            SourceInfo info = new SourceInfo();
            info.path = file.getAbsolutePath();
            info.name = stripExtension(file.getName());
            info.fileSize = file.length();
            info.width = ds.GetRasterXSize();
            info.height = ds.GetRasterYSize();
            info.bandCount = ds.GetRasterCount();

            String wkt = ds.GetProjectionRef();
            boolean hasCrs = wkt != null && !wkt.isEmpty();
            boolean hasGcps = ds.GetGCPCount() > 0;
            if (!hasCrs && !hasGcps)
                throw new IOException("This file has no map coordinates (not a GeoTIFF).");

            Band b1 = ds.GetRasterBand(1);
            info.eightBit = b1.getDataType() == gdalconstConstants.GDT_Byte;
            info.palette = b1.GetRasterColorTable() != null;
            for (int i = 1; i <= info.bandCount; i++) {
                if (ds.GetRasterBand(i).GetColorInterpretation() == gdalconstConstants.GCI_AlphaBand) {
                    info.alphaBand = i;
                    break;
                }
            }
            info.emptyFraction = info.alphaBand > 0 ? emptyFraction(ds.GetRasterBand(info.alphaBand), info.width, info.height) : 0;
            return info;
        } finally {
            ds.delete();
        }
    }

    /** Fraction of fully transparent pixels, sampled at reduced resolution (uses overviews if present). */
    private static double emptyFraction(Band alpha, int w, int h) {
        int bw = Math.max(1, Math.min(512, w));
        int bh = Math.max(1, (int) Math.round((double) h * bw / w));
        byte[] buf = new byte[bw * bh];
        if (alpha.ReadRaster(0, 0, w, h, bw, bh, gdalconstConstants.GDT_Byte, buf) != gdalconstConstants.CE_None)
            return 0;
        int empty = 0;
        for (byte v : buf) if (v == 0) empty++;
        return (double) empty / buf.length;
    }

    /**
     * Read an RGB crop at full resolution as ARGB pixels (for the detail check).
     * Returns null when the source isn't plain 8-bit RGB(A)/grey.
     */
    static int[] readCrop(SourceInfo info, int x, int y, int size) throws IOException {
        if (!info.eightBit || info.palette) return null;
        Dataset ds = open(new File(info.path));
        try {
            int[] bands = info.bandCount >= 3 ? new int[]{1, 2, 3} : new int[]{1, 1, 1};
            byte[] buf = new byte[size * size * 3];
            if (ds.ReadRaster(x, y, size, size, size, size, gdalconstConstants.GDT_Byte, buf, bands) != gdalconstConstants.CE_None)
                return null;
            byte[] alpha = null;
            if (info.alphaBand > 0) {
                alpha = new byte[size * size];
                ds.GetRasterBand(info.alphaBand).ReadRaster(x, y, size, size, size, size, gdalconstConstants.GDT_Byte, alpha);
            }
            int n = size * size;
            int[] argb = new int[n];
            for (int i = 0; i < n; i++) {
                int r = buf[i] & 0xff, g = buf[n + i] & 0xff, b = buf[2 * n + i] & 0xff;
                int a = alpha == null ? 255 : (alpha[i] & 0xff);
                argb[i] = (a << 24) | (r << 16) | (g << 8) | b;
            }
            return argb;
        } finally {
            ds.delete();
        }
    }

    /** The written overlay and its lon/lat extent. */
    static final class Result {
        File file;
        double west, south, east, north;
    }

    /**
     * Convert. maxDim = 0 keeps full resolution.
     */
    static Result convert(SourceInfo info, File out, int quality, int maxDim, boolean transparent,
                          final Progress progress) throws IOException {
        Dataset src = open(new File(info.path));
        Dataset warped = null;
        Dataset result = null;
        try {
            // 1. Reproject to WGS84 (a virtual dataset: nothing is written yet).
            SpatialReference wgs84 = new SpatialReference();
            wgs84.ImportFromEPSG(4326);
            String srcWkt = src.GetProjectionRef();
            if (srcWkt == null || srcWkt.isEmpty()) srcWkt = src.GetGCPProjection();
            warped = gdal.AutoCreateWarpedVRT(src, srcWkt, wgs84.ExportToWkt(), gdalconstConstants.GRA_Cubic, 0.125);
            if (warped == null) throw new IOException("Could not reproject: " + gdal.GetLastErrorMsg());

            int w = warped.GetRasterXSize(), h = warped.GetRasterYSize();
            int ow = w, oh = h;
            if (maxDim > 0 && Math.max(w, h) > maxDim) {
                double k = (double) maxDim / Math.max(w, h);
                ow = Math.max(1, (int) Math.round(w * k));
                oh = Math.max(1, (int) Math.round(h * k));
            }

            // 2. Encode as a JPEG-compressed, tiled GeoTIFF.
            boolean withAlpha = transparent && info.alphaBand > 0 && info.emptyFraction > 0
                    && warped.GetRasterCount() >= 4;
            List<String> opts = new ArrayList<>(Arrays.asList(
                    "-of", "GTiff",
                    "-co", "TILED=YES", "-co", "BLOCKXSIZE=256", "-co", "BLOCKYSIZE=256",
                    "-co", "COMPRESS=JPEG", "-co", "JPEG_QUALITY=" + quality,
                    "-r", "cubic"));
            if (ow != w || oh != h) {
                opts.addAll(Arrays.asList("-outsize", String.valueOf(ow), String.valueOf(oh)));
            }
            if (info.palette) {
                opts.addAll(Arrays.asList("-expand", withAlpha ? "rgba" : "rgb"));
            } else if (!info.eightBit) {
                opts.addAll(Arrays.asList("-ot", "Byte", "-scale"));
            }
            if (withAlpha) {
                int alpha = warped.GetRasterCount(); // warped VRT puts alpha last
                opts.addAll(Arrays.asList("-b", "1", "-b", "2", "-b", "3", "-b", String.valueOf(alpha),
                        "-co", "PHOTOMETRIC=RGB", "-co", "ALPHA=YES"));
            } else if (info.palette) {
                opts.addAll(Arrays.asList("-co", "PHOTOMETRIC=YCBCR"));
            } else if (info.bandCount >= 3) {
                opts.addAll(Arrays.asList("-b", "1", "-b", "2", "-b", "3", "-co", "PHOTOMETRIC=YCBCR"));
            } else {
                opts.addAll(Arrays.asList("-b", "1", "-b", "1", "-b", "1", "-co", "PHOTOMETRIC=YCBCR"));
            }

            if (out.exists() && !out.delete()) throw new IOException("Cannot replace " + out);
            ProgressCallback cb = new ProgressCallback() {
                @Override
                public int run(double complete, String message) {
                    if (progress != null) progress.onProgress(complete * 0.8, "Compressing…");
                    return 1;
                }
            };
            result = gdal.Translate(out.getAbsolutePath(), warped, new TranslateOptions(new Vector<>(opts)), cb);
            if (result == null) throw new IOException("Conversion failed: " + gdal.GetLastErrorMsg());

            // 3. Internal zoom levels (ATAK needs them to display large overlays).
            List<Integer> levels = new ArrayList<>();
            for (int f = 2; Math.max(ow, oh) / f >= 256; f *= 2) levels.add(f);
            if (!levels.isEmpty()) {
                int[] lv = new int[levels.size()];
                for (int i = 0; i < lv.length; i++) lv[i] = levels.get(i);
                if (progress != null) progress.onProgress(0.8, "Building zoom levels…");
                gdal.SetConfigOption("JPEG_QUALITY_OVERVIEW", String.valueOf(quality));
                try {
                    result.BuildOverviews("AVERAGE", lv);
                } finally {
                    gdal.SetConfigOption("JPEG_QUALITY_OVERVIEW", null);
                }
            }
            result.FlushCache();

            // Extent of the overlay (WGS84, north-up) so the map can zoom to it.
            double[] gt = result.GetGeoTransform();
            Result r = new Result();
            r.file = out;
            r.west = gt[0];
            r.north = gt[3];
            r.east = gt[0] + gt[1] * result.GetRasterXSize();
            r.south = gt[3] + gt[5] * result.GetRasterYSize();
            if (progress != null) progress.onProgress(1.0, "Done");
            return r;
        } finally {
            if (result != null) result.delete();
            if (warped != null) warped.delete();
            src.delete();
        }
    }

    private static Dataset open(File f) throws IOException {
        Dataset ds = gdal.Open(f.getAbsolutePath(), gdalconstConstants.GA_ReadOnly);
        if (ds == null) throw new IOException("Cannot open " + f.getName() + ": " + gdal.GetLastErrorMsg());
        return ds;
    }

    static String stripExtension(String n) {
        int i = n.lastIndexOf('.');
        return i > 0 ? n.substring(0, i) : n;
    }
}
