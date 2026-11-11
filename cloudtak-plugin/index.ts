// Map Compressor - CloudTAK plugin entry point.
//
// Install: copy this folder to CloudTAK's  app/plugins/map-compressor/
// (CloudTAK loads every  app/plugins/*/index.ts  at build time), add the
// dependencies listed in README.md, and rebuild/redeploy CloudTAK.

import type { App } from 'vue';
import type { PluginAPI, PluginInstance } from '@tak-ps/cloudtak';
import { IconPhotoDown } from '@tabler/icons-vue';
import { setPluginAPI } from './state.ts';

const MENU_KEY = 'map-compressor';
const ROUTE_NAME = 'home-menu-map-compressor';

export default class MapCompressorPlugin implements PluginInstance {
    api: PluginAPI;

    constructor(api: PluginAPI) {
        this.api = api;
    }

    static async install(app: App, api: PluginAPI): Promise<PluginInstance> {
        setPluginAPI(api);
        api.routes.add({
            path: 'map-compressor',
            name: ROUTE_NAME,
            component: () => import('./Panel.vue'),
        }, 'home-menu');
        return new MapCompressorPlugin(api);
    }

    async enable(): Promise<void> {
        this.api.menu.add({
            key: MENU_KEY,
            label: 'Map Compressor',
            route: ROUTE_NAME,
            tooltip: 'Compress GeoTIFF maps for ATAK, iTAK & TAK Aware',
            description: 'Turn a GeoTIFF into a small georeferenced JPEG (KMZ), preview it on the map, and share it',
            icon: IconPhotoDown,
        });
    }

    async disable(): Promise<void> {
        this.api.menu.remove(MENU_KEY);
    }
}
