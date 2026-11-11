package com.atakmap.android.mapcompressor.plugin;

import android.content.Context;
import android.view.View;

import com.atak.plugins.impl.PluginContextProvider;
import com.atak.plugins.impl.PluginLayoutInflater;

import gov.tak.api.plugin.IPlugin;
import gov.tak.api.plugin.IServiceController;
import gov.tak.api.ui.IHostUIService;
import gov.tak.api.ui.Pane;
import gov.tak.api.ui.PaneBuilder;
import gov.tak.api.ui.ToolbarItem;
import gov.tak.api.ui.ToolbarItemAdapter;
import gov.tak.platform.marshal.MarshalManager;

/**
 * Map Compressor ATAK plugin: adds a toolbar button that opens the compressor pane.
 * Uses only plugin APIs present in ATAK 5.6, 5.7 and 5.8.
 */
public class MapCompressorPlugin implements IPlugin {

    private final Context pluginContext;
    private final IHostUIService uiService;
    private final ToolbarItem toolbarItem;
    private Pane pane;
    private CompressorController controller;

    public MapCompressorPlugin(IServiceController serviceController) {
        final PluginContextProvider ctxProvider = serviceController.getService(PluginContextProvider.class);
        pluginContext = ctxProvider != null ? ctxProvider.getPluginContext() : null;
        if (pluginContext != null) pluginContext.setTheme(R.style.ATAKPluginTheme);
        uiService = serviceController.getService(IHostUIService.class);

        // A stable identifier lets ATAK remember where the user placed the button.
        toolbarItem = new ToolbarItem.Builder(
                pluginContext.getString(R.string.app_name),
                MarshalManager.marshal(
                        // White-on-transparent glyph: ATAK tints toolbar icons, so a filled icon shows as a blank square.
                        pluginContext.getResources().getDrawable(R.drawable.ic_toolbar),
                        android.graphics.drawable.Drawable.class,
                        gov.tak.api.commons.graphics.Bitmap.class))
                .setListener(new ToolbarItemAdapter() {
                    @Override
                    public void onClick(ToolbarItem item) {
                        showPane();
                    }
                })
                .setIdentifier(pluginContext.getPackageName())
                .build();
    }

    @Override
    public void onStart() {
        if (uiService != null) uiService.addToolbarItem(toolbarItem);
    }

    @Override
    public void onStop() {
        if (uiService != null) uiService.removeToolbarItem(toolbarItem);
        if (controller != null) controller.dispose();
    }

    private void showPane() {
        if (pane == null) {
            View root = PluginLayoutInflater.inflate(pluginContext, R.layout.compressor_pane, null);
            controller = new CompressorController(pluginContext, root);
            pane = new PaneBuilder(root)
                    .setMetaValue(Pane.RELATIVE_LOCATION, Pane.Location.Default)
                    .setMetaValue(Pane.PREFERRED_WIDTH_RATIO, 0.4D)
                    .setMetaValue(Pane.PREFERRED_HEIGHT_RATIO, 0.6D)
                    .build();
        }
        if (!uiService.isPaneVisible(pane)) uiService.showPane(pane, null);
    }
}
