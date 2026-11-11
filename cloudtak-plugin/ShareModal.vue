<template>
    <TablerModal size='lg'>
        <div class='modal-status bg-yellow' />
        <div class='modal-header'>
            <span class='modal-title'>Share "{{ name }}"</span>
            <div class='ms-auto btn-list'>
                <div
                    class='d-flex align-items-center'
                    title='Users selected'
                >
                    <IconUsers
                        :size='20'
                        stroke='1'
                    /><span class='mx-2'>{{ selectedUsers.size }}</span>
                </div>
                <div
                    class='d-flex align-items-center'
                    title='Channels selected'
                >
                    <IconAffiliate
                        :size='20'
                        stroke='1'
                    /><span class='mx-2'>{{ selectedGroups.size }}</span>
                </div>
                <div
                    class='d-flex align-items-center'
                    title='Data Syncs selected'
                >
                    <IconCloudPin
                        :size='20'
                        stroke='1'
                    /><span class='mx-2'>{{ selectedMissions.size }}</span>
                </div>
            </div>
            <button
                type='button'
                class='btn-close'
                aria-label='Close'
                :disabled='busy'
                @click='emit("close")'
            />
        </div>

        <div class='modal-body'>
            <div class='mx-2'>
                <TablerInput
                    v-model='filter'
                    icon='search'
                    label=''
                    placeholder='Filter...'
                />
            </div>
            <TablerPillGroup
                v-model='mode'
                :options='[
                    { value: "users", label: "Users" },
                    { value: "groups", label: "Channels" },
                    { value: "missions", label: "Data Syncs" }
                ]'
                :disabled='loading || busy'
            />

            <div
                class='col-12 overflow-auto'
                style='height: 45vh;'
            >
                <TablerLoading v-if='loading' />
                <template v-else-if='mode === "users"'>
                    <TablerNone
                        v-if='!visibleContacts.length'
                        label='No users online'
                        :create='false'
                    />
                    <COTContact
                        v-for='c of visibleContacts'
                        v-else
                        :key='c.uid'
                        :contact='c'
                        :button-chat='false'
                        :fly-to-click='false'
                        :selected='selectedUsers.has(c.uid)'
                        class='rounded'
                        @click='toggle(selectedUsers, c.uid)'
                    />
                </template>
                <template v-else-if='mode === "groups"'>
                    <TablerNone
                        v-if='!visibleChannels.length'
                        label='No active channels'
                        :create='false'
                    />
                    <div
                        v-for='ch in visibleChannels'
                        v-else
                        :key='ch.name'
                        class='col-12 py-2 px-2 cloudtak-hover rounded cursor-pointer user-select-none'
                        @click='toggle(selectedGroups, ch.name)'
                    >
                        <IconCheck
                            v-if='selectedGroups.has(ch.name)'
                            :size='24'
                            stroke='1'
                        />
                        <IconAffiliate
                            v-else
                            :size='24'
                            stroke='1'
                        />
                        <span
                            class='mx-2'
                            v-text='ch.name'
                        />
                    </div>
                </template>
                <template v-else>
                    <TablerNone
                        v-if='!visibleMissions.length'
                        label='Not subscribed to any Data Syncs'
                        :create='false'
                    />
                    <div
                        v-for='m in visibleMissions'
                        v-else
                        :key='m.guid'
                        class='col-12 py-2 px-2 cloudtak-hover rounded cursor-pointer user-select-none'
                        @click='toggle(selectedMissions, m.guid)'
                    >
                        <IconCheck
                            v-if='selectedMissions.has(m.guid)'
                            :size='24'
                            stroke='1'
                        />
                        <IconCloudPin
                            v-else
                            :size='24'
                            stroke='1'
                        />
                        <span
                            class='mx-2'
                            v-text='m.name'
                        />
                    </div>
                </template>
            </div>

            <div
                v-if='status'
                class='small mt-2'
                :class='statusIsError ? "text-danger" : "text-secondary"'
                v-text='status'
            />
        </div>

        <div class='modal-footer'>
            <div class='row g-2 w-100'>
                <div class='col-6'>
                    <TablerButton
                        class='w-100 btn-primary'
                        :disabled='busy || loading || !anySelected'
                        @click='shareSelected'
                    >
                        <IconShare2
                            :size='20'
                            stroke='1'
                            class='me-1'
                        />
                        <span>Share</span>
                    </TablerButton>
                </div>
                <div class='col-6'>
                    <TablerButton
                        class='w-100 btn-secondary'
                        :title='broadcastChannels.length ? "Sends to: " + broadcastChannels.join(", ") : "No channels are turned on"'
                        :disabled='busy || loading || !broadcastChannels.length'
                        @click='broadcast'
                    >
                        <IconBroadcast
                            :size='20'
                            stroke='1'
                            class='me-1'
                        />
                        <span>Broadcast ({{ broadcastChannels.length }} active channel{{ broadcastChannels.length === 1 ? '' : 's' }})</span>
                    </TablerButton>
                </div>
            </div>
        </div>
    </TablerModal>
</template>

<script setup lang='ts'>
// Share dialog modelled on CloudTAK's own Share dialog: pick Users, Channels and/or
// Data Syncs, or Broadcast to every channel that is turned on.
import { ref, computed, onMounted, watch } from 'vue';
import type { Ref } from 'vue';
import { useObservable } from '@vueuse/rxjs';
import { from } from 'rxjs';
import {
    TablerNone,
    TablerInput,
    TablerModal,
    TablerLoading,
    TablerButton,
    TablerPillGroup,
} from '@tak-ps/vue-tabler';
import {
    IconUsers,
    IconCheck,
    IconBroadcast,
    IconAffiliate,
    IconCloudPin,
    IconShare2,
} from '@tabler/icons-vue';
import { liveQuery } from '../../src/database.ts';
import ContactManager from '../../src/base/contact.ts';
import Subscription from '../../src/base/subscription.ts';
import COTContact from '../../src/components/CloudTAK/util/Contact.vue';
import { useMapStore } from '../../src/stores/map.ts';
import type { ContactList, GroupChannel } from '../../src/types.ts';
import { uploadToFiles, sendToDestinations, uploadToDataSync } from './share.ts';

const props = defineProps<{
    name: string;
    getFile: () => Promise<{ blob: Blob; filename: string }>;
}>();

const emit = defineEmits<{
    close: [];
    done: [summary: string];
}>();

const mapStore = useMapStore();

const loading = ref(true);
const busy = ref(false);
const status = ref('');
const statusIsError = ref(false);
const filter = ref('');
const mode = ref<'users' | 'groups' | 'missions'>('users');

const selectedUsers = ref(new Set<string>());
const selectedGroups = ref(new Set<string>());
const selectedMissions = ref(new Set<string>());

const contacts: Ref<ContactList | undefined> = useObservable(
    from(liveQuery(async () => await ContactManager.list())),
);
const channels = ref<GroupChannel[]>([]);
const missions = ref<Array<{ guid: string; name: string }>>([]);

const f = computed(() => filter.value.toLowerCase());
const visibleContacts = computed(() => (contacts.value || [])
    .filter((c) => c.callsign && c.callsign.toLowerCase().includes(f.value)));
// Same rule as CloudTAK's Share dialog: channels that are on and that you receive.
const visibleChannels = computed(() => channels.value
    .filter((c) => c.active && c.direction.includes('IN'))
    .filter((c) => c.name.toLowerCase().includes(f.value)));
const visibleMissions = computed(() => missions.value
    .filter((m) => m.name.toLowerCase().includes(f.value)));

// Broadcast goes only to channels that are turned on.
const broadcastChannels = computed(() => channels.value.filter((c) => c.active).map((c) => c.name));

const anySelected = computed(() => selectedUsers.value.size + selectedGroups.value.size + selectedMissions.value.size > 0);

watch(mode, () => { filter.value = ''; });

onMounted(async () => {
    try {
        channels.value = await mapStore.worker.profile.loadChannels();
        missions.value = Array.from(await Subscription.localList({ role: 'MISSION_SUBSCRIBER' }));
    } catch (err) {
        setStatus(err, true);
    } finally {
        loading.value = false;
    }
});

function toggle(set: Ref<Set<string>>['value'], key: string): void {
    if (busy.value) return;
    if (set.has(key)) set.delete(key);
    else set.add(key);
}

function setStatus(msg: unknown, isError = false): void {
    status.value = msg instanceof Error ? msg.message : String(msg);
    statusIsError.value = isError;
}

async function send(uids: string[], groups: string[], missionGuids: string[]): Promise<string[]> {
    const { blob, filename } = await props.getFile();
    const parts: string[] = [];

    if (uids.length || groups.length) {
        const assetId = await uploadToFiles(blob, filename, (s) => setStatus(s));
        setStatus('Sending…');
        await sendToDestinations(assetId, props.name, { uids, groups });
        if (uids.length) parts.push(`${uids.length} user${uids.length === 1 ? '' : 's'}`);
        if (groups.length) parts.push(`${groups.length} channel${groups.length === 1 ? '' : 's'}`);
    }

    const names = new Map(missions.value.map((m) => [m.guid, m.name]));
    for (const guid of missionGuids) {
        setStatus(`Adding to Data Sync "${names.get(guid) || guid}"…`);
        await uploadToDataSync(guid, blob, filename);
    }
    if (missionGuids.length) parts.push(`${missionGuids.length} Data Sync${missionGuids.length === 1 ? '' : 's'}`);

    return parts;
}

async function run(fn: () => Promise<string>): Promise<void> {
    busy.value = true;
    try {
        const summary = await fn();
        emit('done', summary);
    } catch (err) {
        setStatus(err, true);
    } finally {
        busy.value = false;
    }
}

function shareSelected(): Promise<void> {
    return run(async () => {
        const parts = await send(
            Array.from(selectedUsers.value),
            Array.from(selectedGroups.value),
            Array.from(selectedMissions.value),
        );
        return `Shared "${props.name}" with ${parts.join(', ')}.`;
    });
}

function broadcast(): Promise<void> {
    return run(async () => {
        await send([], broadcastChannels.value, []);
        return `Broadcast "${props.name}" to ${broadcastChannels.value.join(', ')}.`;
    });
}
</script>
