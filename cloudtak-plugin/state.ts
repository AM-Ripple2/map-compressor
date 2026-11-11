import type { PluginAPI } from '@tak-ps/cloudtak';

let pluginAPI: PluginAPI | undefined;

export function setPluginAPI(api: PluginAPI): void {
    pluginAPI = api;
}

export function getPluginAPI(): PluginAPI {
    if (!pluginAPI) throw new Error('Map Compressor plugin is not installed');
    return pluginAPI;
}
