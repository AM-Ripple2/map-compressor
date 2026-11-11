<template>
    <MenuTemplate name='Map Compressor'>
        <div ref='host' />

        <div
            v-if='ready'
            class='px-3 pb-4 d-flex flex-column gap-2'
        >
            <div class='subheader'>
                Share
            </div>

            <label class='form-label small mb-0'>Share as</label>
            <select
                v-model='shareFormat'
                class='form-select'
                :disabled='busy'
            >
                <option value='geotiff'>
                    GeoTIFF (keeps transparency, recommended)
                </option>
                <option value='kmz'>
                    KMZ (JPEG overlay, no transparency)
                </option>
            </select>

            <div class='row g-2'>
                <div class='col-12'>
                    <button
                        type='button'
                        class='btn btn-primary w-100'
                        :disabled='busy'
                        title='Send to specific users, channels or Data Syncs, or broadcast to your active channels'
                        @click='showShare = true'
                    >
                        <IconShare2
                            :size='18'
                            stroke='1'
                            class='me-1'
                        />
                        Share / Broadcast…
                    </button>
                </div>
                <div class='col-6'>
                    <button
                        type='button'
                        class='btn btn-outline-secondary w-100'
                        :disabled='busy'
                        title='Publish to the TAK Server Data Package list for chosen channels'
                        @click='showPackage = !showPackage'
                    >
                        <IconPackage
                            :size='18'
                            stroke='1'
                            class='me-1'
                        />
                        Data Package
                    </button>
                </div>
                <div class='col-6'>
                    <button
                        type='button'
                        class='btn btn-outline-secondary w-100'
                        :disabled='busy'
                        title='Save the file on this device'
                        @click='download'
                    >
                        <IconDownload
                            :size='18'
                            stroke='1'
                            class='me-1'
                        />
                        Download
                    </button>
                </div>
            </div>

            <div
                v-if='showPackage'
                class='border rounded p-2 d-flex flex-column gap-2'
            >
                <div class='text-secondary small'>
                    Publishes a Data Package that users on these channels can download from the
                    TAK Server package list (ATAK, WinTAK, iTAK and TAK Aware).
                </div>
                <GroupSelect
                    v-model='groups'
                    :active='true'
                    direction='IN'
                />
                <button
                    type='button'
                    class='btn btn-primary w-100'
                    :disabled='!groups.length || busy'
                    @click='publish'
                >
                    <span v-if='busy'>Publishing…</span>
                    <span v-else-if='groups.length'>Publish to {{ groups.length }} channel{{ groups.length === 1 ? '' : 's' }}</span>
                    <span v-else>Pick at least one channel</span>
                </button>
            </div>

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

        <ShareModal
            v-if='showShare && ui'
            :name='ui.name'
            :get-file='getFile'
            @close='showShare = false'
            @done='shared'
        />
    </MenuTemplate>
</template>

<script setup lang='ts'>
import { ref, shallowRef, onMounted, onBeforeUnmount, useTemplateRef } from 'vue';
import { IconShare2, IconPackage, IconDownload } from '@tabler/icons-vue';
import MenuTemplate from '../../src/components/CloudTAK/util/MenuTemplate.vue';
import GroupSelect from '../../src/components/CloudTAK/util/GroupSelect.vue';
import { mountCompressor, type CompressorUI } from './ui.js';
import { getPluginAPI } from './state.ts';
import ShareModal from './ShareModal.vue';
import { publishDataPackage, downloadLocally } from './share.ts';

const host = useTemplateRef<HTMLDivElement>('host');
const ui = shallowRef<CompressorUI>();
const ready = ref(false);
const groups = ref<string[]>([]);
const busy = ref(false);
const showShare = ref(false);
const showPackage = ref(false);
const message = ref('');
const messageIsError = ref(false);
const packageUid = ref('');
const shareFormat = ref<'geotiff' | 'kmz'>('geotiff');

onMounted(() => {
    if (!host.value) return;
    const api = getPluginAPI();
    ui.value = mountCompressor(host.value, { map: api.map });
    ui.value.onChange((u) => {
        ready.value = u.ready;
        message.value = '';
        packageUid.value = '';
    });
});

onBeforeUnmount(() => {
    ui.value?.destroy();
    ui.value = undefined;
});

/** The current overlay in the chosen format, built at the current quality. */
async function getFile(): Promise<{ blob: Blob; filename: string }> {
    if (!ui.value) throw new Error('Load a map first');
    return shareFormat.value === 'geotiff' ? await ui.value.getGeoTiff() : await ui.value.getKmz();
}

function report(msg: unknown, isError = false): void {
    message.value = msg instanceof Error ? msg.message : String(msg);
    messageIsError.value = isError;
}

function shared(summary: string): void {
    showShare.value = false;
    packageUid.value = '';
    report(summary);
}

async function publish(): Promise<void> {
    if (!ui.value || !groups.value.length) return;
    busy.value = true;
    packageUid.value = '';
    report('');
    try {
        const { blob, filename } = await getFile();
        packageUid.value = await publishDataPackage(blob, filename, ui.value.name, groups.value);
        report(`Published "${ui.value.name}" as a Data Package (${shareFormat.value === 'geotiff' ? 'GeoTIFF' : 'KMZ'}, quality ${ui.value.quality}).`);
    } catch (err) {
        report(err, true);
    } finally {
        busy.value = false;
    }
}

async function download(): Promise<void> {
    busy.value = true;
    try {
        const { blob, filename } = await getFile();
        downloadLocally(blob, filename);
        report(`Saved ${filename}.`);
    } catch (err) {
        report(err, true);
    } finally {
        busy.value = false;
    }
}

function openPackage(): void {
    if (packageUid.value) getPluginAPI().router.push(`/menu/packages/${packageUid.value}`);
}
</script>
