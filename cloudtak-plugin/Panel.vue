<template>
    <MenuTemplate name='Map Compressor'>
        <div ref='host' />

        <div
            v-if='ready'
            class='px-3 pb-4 d-flex flex-column gap-2'
        >
            <div class='subheader'>
                Share to TAK Server
            </div>
            <div class='text-secondary small'>
                Publishes the overlay as a Data Package to the channels you pick. ATAK, WinTAK,
                iTAK and TAK Aware users on those channels can then download it.
            </div>

            <label class='form-label small mb-0'>Share as</label>
            <select
                v-model='shareFormat'
                class='form-select'
            >
                <option value='geotiff'>
                    GeoTIFF (keeps transparency, recommended)
                </option>
                <option value='kmz'>
                    KMZ (JPEG overlay, no transparency)
                </option>
            </select>

            <GroupSelect
                v-model='groups'
                :active='true'
                direction='IN'
            />

            <button
                type='button'
                class='btn btn-primary w-100'
                :disabled='!groups.length || sharing'
                @click='share'
            >
                <span v-if='sharing'>Sharing…</span>
                <span v-else-if='groups.length'>Share to {{ groups.length }} channel{{ groups.length === 1 ? '' : 's' }}</span>
                <span v-else>Pick at least one channel</span>
            </button>

            <div
                v-if='message'
                :class='messageIsError ? "text-danger" : "text-success"'
                class='small'
            >
                {{ message }}
                <a
                    v-if='packageUid'
                    href='#'
                    @click.prevent='openPackage'
                >Open package</a>
            </div>
        </div>
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { ref, onMounted, onBeforeUnmount, useTemplateRef } from 'vue';
import MenuTemplate from '../../src/components/CloudTAK/util/MenuTemplate.vue';
import GroupSelect from '../../src/components/CloudTAK/util/GroupSelect.vue';
import { std, stdurl } from '../../src/std.ts';
import { mountCompressor, type CompressorUI } from './ui.js';
import { getPluginAPI } from './state.ts';

const host = useTemplateRef<HTMLDivElement>('host');
const ready = ref(false);
const groups = ref<string[]>([]);
const sharing = ref(false);
const message = ref('');
const messageIsError = ref(false);
const packageUid = ref('');
const shareFormat = ref<'geotiff' | 'kmz'>('geotiff');

let ui: CompressorUI | undefined;

onMounted(() => {
    if (!host.value) return;
    const api = getPluginAPI();
    ui = mountCompressor(host.value, { map: api.map });
    ui.onChange((u) => {
        ready.value = u.ready;
        message.value = '';
        packageUid.value = '';
    });
});

onBeforeUnmount(() => {
    ui?.destroy();
    ui = undefined;
});

async function share(): Promise<void> {
    if (!ui || !groups.value.length) return;
    sharing.value = true;
    message.value = '';
    packageUid.value = '';
    try {
        // Upload the overlay; CloudTAK wraps a single file into a proper Data Package
        // (MANIFEST included) and publishes it to TAK Server for the chosen channels.
        const { blob, filename } = shareFormat.value === 'geotiff' ? await ui.getGeoTiff() : await ui.getKmz();
        const url = stdurl('/api/marti/package');
        url.searchParams.set('name', ui.name);
        for (const g of groups.value) url.searchParams.append('groups', g);
        url.searchParams.append('keywords', 'map');

        const form = new FormData();
        form.append('file', new File([blob], filename, { type: blob.type || 'application/octet-stream' }));

        // Generous timeout: field connections can be slow and maps are megabytes.
        const res = await std(url, { method: 'POST', body: form, timeout: 180_000 }) as { UID?: string; uid?: string; Name?: string };
        packageUid.value = res.UID || res.uid || '';
        message.value = `Shared "${ui.name}" as ${shareFormat.value === 'geotiff' ? 'GeoTIFF' : 'KMZ'} (quality ${ui.quality}).`;
        messageIsError.value = false;
    } catch (err) {
        message.value = err instanceof Error ? err.message : String(err);
        messageIsError.value = true;
    } finally {
        sharing.value = false;
    }
}

function openPackage(): void {
    if (packageUid.value) getPluginAPI().router.push(`/menu/packages/${packageUid.value}`);
}
</script>
