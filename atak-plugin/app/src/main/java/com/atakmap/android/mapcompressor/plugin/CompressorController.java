package com.atakmap.android.mapcompressor.plugin;

import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.SeekBar;
import android.widget.Spinner;
import android.widget.TextView;

import com.atakmap.android.grg.GRGMapComponent;
import com.atakmap.android.gui.ImportFileBrowserDialog;
import com.atakmap.android.importexport.ImportExportMapComponent;
import com.atakmap.android.importexport.ImportReceiver;
import com.atakmap.android.importexport.send.SendDialog;
import com.atakmap.android.ipc.AtakBroadcast;
import com.atakmap.android.maps.MapView;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Drives the Map Compressor pane: everything runs on this device. */
final class CompressorController {

    private static final int[] MAX_DIMS = {8192, 0, 4096, 2048};
    private static final String[] SIZE_LABELS = {"Up to 8192 px (recommended)", "Full resolution", "Up to 4096 px", "Up to 2048 px"};
    private static final String[] FILL_LABELS = {"Transparent (recommended)", "Black"};
    private static final int CROP = 192;

    private final Context pluginContext;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private final TextView info, qualityValue, estimate, status, detailCaption;
    private final View options;
    private final Spinner size, fill;
    private final SeekBar quality;
    private final ImageView detailOriginal, detailCompressed;
    private final Button convert, share;
    private final ProgressBar progressBar;

    private GdalCompressor.SourceInfo source;
    private int spot;
    private int[] cropPixels;
    private File lastOutput;
    private boolean busy;

    CompressorController(Context pluginContext, View root) {
        this.pluginContext = pluginContext;
        info = root.findViewById(R.id.mc_info);
        options = root.findViewById(R.id.mc_options);
        size = root.findViewById(R.id.mc_size);
        fill = root.findViewById(R.id.mc_fill);
        quality = root.findViewById(R.id.mc_quality);
        qualityValue = root.findViewById(R.id.mc_quality_value);
        estimate = root.findViewById(R.id.mc_estimate);
        detailOriginal = root.findViewById(R.id.mc_detail_original);
        detailCompressed = root.findViewById(R.id.mc_detail_compressed);
        detailCaption = root.findViewById(R.id.mc_detail_caption);
        convert = root.findViewById(R.id.mc_convert);
        share = root.findViewById(R.id.mc_share);
        progressBar = root.findViewById(R.id.mc_progress);
        status = root.findViewById(R.id.mc_status);

        size.setAdapter(adapter(SIZE_LABELS));
        fill.setAdapter(adapter(FILL_LABELS));
        quality.setProgress(12); // quality 70
        updateQualityLabel();

        root.findViewById(R.id.mc_pick).setOnClickListener(v -> pickFile());
        root.findViewById(R.id.mc_next_spot).setOnClickListener(v -> { spot++; loadCrop(); });
        convert.setOnClickListener(v -> runConversion());
        share.setOnClickListener(v -> shareOutput());
        quality.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar s, int p, boolean fromUser) { updateQualityLabel(); refreshPreview(); }
            @Override public void onStartTrackingTouch(SeekBar s) { }
            @Override public void onStopTrackingTouch(SeekBar s) { }
        });
        AdapterView.OnItemSelectedListener refresh = new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> p, View v, int pos, long id) { refreshPreview(); }
            @Override public void onNothingSelected(AdapterView<?> p) { }
        };
        size.setOnItemSelectedListener(refresh);
        fill.setOnItemSelectedListener(refresh);
    }

    void dispose() {
        worker.shutdownNow();
    }

    /* ---------------- file selection ---------------- */

    private void pickFile() {
        if (busy) return;
        String start = new File(Environment.getExternalStorageDirectory(), "Download").getAbsolutePath();
        ImportFileBrowserDialog.show("Choose a GeoTIFF", start, new String[]{"tif", "tiff"},
                new ImportFileBrowserDialog.DialogDismissed() {
                    @Override public void onFileSelected(File f) { if (f != null) inspect(f); }
                    @Override public void onDialogClosed() { }
                }, MapView.getMapView().getContext());
    }

    private void inspect(final File f) {
        setBusy(true, "Reading " + f.getName() + "…");
        worker.execute(() -> {
            try {
                final GdalCompressor.SourceInfo s = GdalCompressor.inspect(f);
                ui.post(() -> {
                    source = s;
                    lastOutput = null;
                    share.setEnabled(false);
                    spot = 0;
                    info.setText(String.format(Locale.US, "%s\n%s · %d × %d px%s", s.name, human(s.fileSize), s.width, s.height,
                            s.emptyFraction > 0.001 ? String.format(Locale.US, " · %.0f%% empty", 100 * s.emptyFraction) : ""));
                    options.setVisibility(View.VISIBLE);
                    setBusy(false, "");
                    loadCrop();
                });
            } catch (final Exception e) {
                ui.post(() -> { source = null; options.setVisibility(View.GONE); info.setText(""); setBusy(false, e.getMessage()); });
            }
        });
    }

    /* ---------------- detail check + size estimate ---------------- */

    private void loadCrop() {
        if (source == null) return;
        final GdalCompressor.SourceInfo s = source;
        // Cycle through a few spots: centre, then the four quarter points.
        double[][] spots = {{0.5, 0.5}, {0.25, 0.25}, {0.75, 0.25}, {0.25, 0.75}, {0.75, 0.75}};
        double[] p = spots[spot % spots.length];
        final int c = Math.min(CROP, Math.min(s.width, s.height));
        final int x = Math.max(0, Math.min(s.width - c, (int) (p[0] * s.width) - c / 2));
        final int y = Math.max(0, Math.min(s.height - c, (int) (p[1] * s.height) - c / 2));
        worker.execute(() -> {
            try {
                final int[] px = GdalCompressor.readCrop(s, x, y, c);
                ui.post(() -> {
                    cropPixels = px;
                    if (px == null) {
                        detailOriginal.setImageDrawable(null);
                        detailCompressed.setImageDrawable(null);
                        detailCaption.setText("Not available for this map type");
                    } else {
                        detailOriginal.setImageBitmap(Bitmap.createBitmap(px, c, c, Bitmap.Config.ARGB_8888));
                    }
                    refreshPreview();
                });
            } catch (Exception e) {
                ui.post(() -> setStatus(e.getMessage()));
            }
        });
    }

    private void refreshPreview() {
        if (source == null) return;
        int q = qualityValue();
        boolean alphaOut = transparentSelected() && source.alphaBand > 0 && source.emptyFraction > 0;
        double bytesPerPixel;
        if (cropPixels != null) {
            int c = (int) Math.round(Math.sqrt(cropPixels.length));
            int[] flat = cropPixels.clone();
            for (int i = 0; i < flat.length; i++) flat[i] |= 0xff000000; // JPEG has no alpha
            Bitmap bmp = Bitmap.createBitmap(flat, c, c, Bitmap.Config.ARGB_8888);
            ByteArrayOutputStream jpg = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, q, jpg);
            byte[] bytes = jpg.toByteArray();
            detailCompressed.setImageBitmap(BitmapFactory.decodeByteArray(bytes, 0, bytes.length));
            detailCaption.setText("Quality " + q);
            bytesPerPixel = (double) bytes.length / (c * c);
        } else {
            bytesPerPixel = 0.25 + q / 400.0; // rough fallback
        }
        // Estimate: sample density x output pixels x zoom levels (~+33%), x2 for the alpha-band
        // layout (no chroma subsampling), scaled down for empty areas.
        int maxDim = MAX_DIMS[size.getSelectedItemPosition()];
        double k = maxDim > 0 && Math.max(source.width, source.height) > maxDim
                ? (double) maxDim / Math.max(source.width, source.height) : 1.0;
        double pixels = source.width * k * source.height * k;
        double est = bytesPerPixel * pixels * 1.33 * (alphaOut ? 2.0 : 1.0) * (1.0 - 0.8 * source.emptyFraction);
        estimate.setText(String.format(Locale.US, "Estimated GeoTIFF: about %s (from %s)%s", human((long) est), human(source.fileSize),
                alphaOut ? "\nEmpty areas will stay see-through." : ""));
    }

    /* ---------------- conversion, import, share ---------------- */

    private void runConversion() {
        if (source == null || busy) return;
        final GdalCompressor.SourceInfo s = source;
        final int q = qualityValue();
        final int maxDim = MAX_DIMS[size.getSelectedItemPosition()];
        final boolean transparent = transparentSelected();
        File dir = new File(Environment.getExternalStorageDirectory(), "atak/grg");
        if (!dir.isDirectory() && !dir.mkdirs()) { setStatus("Cannot create " + dir); return; }
        final File out = new File(dir, safe(s.name) + "_q" + q + ".tif");
        setBusy(true, "Compressing…");
        progressBar.setVisibility(View.VISIBLE);
        progressBar.setProgress(0);
        worker.execute(() -> {
            try {
                GdalCompressor.convert(s, out, q, maxDim, transparent,
                        (f, msg) -> ui.post(() -> { progressBar.setProgress((int) (f * 100)); setStatus(msg); }));
                ui.post(() -> {
                    lastOutput = out;
                    share.setEnabled(true);
                    progressBar.setVisibility(View.GONE);
                    setBusy(false, String.format(Locale.US, "Saved %s (%s, %.0f%% smaller). Adding to map…",
                            out.getName(), human(out.length()), 100.0 * (1 - (double) out.length() / s.fileSize)));
                    importToMap(out);
                });
            } catch (final Exception e) {
                ui.post(() -> { progressBar.setVisibility(View.GONE); setBusy(false, "Failed: " + e.getMessage()); });
            }
        });
    }

    private void importToMap(File f) {
        Intent i = new Intent(ImportExportMapComponent.ACTION_IMPORT_DATA);
        i.putExtra(ImportReceiver.EXTRA_URI, Uri.fromFile(f).toString());
        i.putExtra(ImportReceiver.EXTRA_CONTENT, GRGMapComponent.IMPORTER_CONTENT_TYPE);
        i.putExtra(ImportReceiver.EXTRA_MIME_TYPE, GRGMapComponent.IMPORTER_TIFF_MIME_TYPE);
        i.putExtra(ImportReceiver.EXTRA_ZOOM_TO_FILE, true);
        i.putExtra(ImportReceiver.EXTRA_SHOW_NOTIFICATIONS, true);
        AtakBroadcast.getInstance().sendBroadcast(i);
    }

    private void shareOutput() {
        if (lastOutput == null || !lastOutput.exists()) return;
        new SendDialog.Builder(MapView.getMapView())
                .setName(lastOutput.getName())
                .addFile(lastOutput, GRGMapComponent.IMPORTER_CONTENT_TYPE)
                .show();
    }

    /* ---------------- helpers ---------------- */

    private ArrayAdapter<String> adapter(String[] items) {
        ArrayAdapter<String> a = new ArrayAdapter<>(pluginContext, android.R.layout.simple_spinner_item, items);
        a.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        return a;
    }

    private int qualityValue() {
        return 10 + 5 * quality.getProgress();
    }

    private boolean transparentSelected() {
        return fill.getSelectedItemPosition() == 0;
    }

    private void updateQualityLabel() {
        qualityValue.setText(String.valueOf(qualityValue()));
    }

    private void setBusy(boolean b, String msg) {
        busy = b;
        convert.setEnabled(!b);
        setStatus(msg);
    }

    private void setStatus(String msg) {
        status.setText(msg == null ? "" : msg);
        status.setTextColor(msg != null && msg.startsWith("Failed") ? Color.rgb(255, 120, 120) : Color.WHITE);
    }

    private static String safe(String s) {
        return s.replaceAll("[^A-Za-z0-9._ -]+", "_").trim();
    }

    static String human(long n) {
        if (n < 1024) return n + " B";
        if (n < 1024L * 1024) return String.format(Locale.US, "%.1f KB", n / 1024.0);
        if (n < 1024L * 1024 * 1024) return String.format(Locale.US, "%.1f MB", n / (1024.0 * 1024));
        return String.format(Locale.US, "%.2f GB", n / (1024.0 * 1024 * 1024));
    }
}
