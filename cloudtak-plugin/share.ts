// Sharing helpers for the Map Compressor CloudTAK panel.
//
// These use the same CloudTAK API calls as CloudTAK's own sharing:
//  - Users / Channels / Broadcast: the file is stored in the user's CloudTAK Files
//    (PUT /api/import). It is then sent as a TAK "file share" with
//    PUT /api/marti/package, using `assets` and `destinations`. Recipients get the
//    standard ATAK / iTAK / TAK Aware "file received" prompt.
//  - Data Sync: POST /api/marti/missions/:guid/upload, which adds the file to the
//    Data Sync's contents.
//  - Data Package: POST /api/marti/package, which publishes it to the package list
//    for the chosen channels.

import { std, stdurl } from '../../src/std.ts';

export interface Destinations {
    uids: string[];
    groups: string[];
}

// Large orthomosaics over a slow field connection can take a while.
const UPLOAD_TIMEOUT = 300_000;

function asFile(blob: Blob, filename: string): File {
    return new File([blob], filename, { type: blob.type || 'application/octet-stream' });
}

/**
 * Store the file in the user's CloudTAK Files and return its asset id.
 *
 * CloudTAK registers the asset as soon as the upload is stored, before any map
 * preview processing, so this normally takes only a few seconds.
 */
export async function uploadToFiles(blob: Blob, filename: string, onStatus?: (s: string) => void): Promise<string> {
    const form = new FormData();
    form.append('file', asFile(blob, filename));

    onStatus?.('Uploading…');
    const res = await std(stdurl('/api/import'), {
        method: 'PUT', body: form, timeout: UPLOAD_TIMEOUT,
    }) as { imports: Array<{ uid: string }> };

    const uid = res.imports?.[0]?.uid;
    if (!uid) throw new Error('CloudTAK did not accept the upload');

    onStatus?.('Preparing to share…');
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
        const imp = await std(stdurl(`/api/import/${encodeURIComponent(uid)}`)) as {
            status: string;
            error?: string | null;
            results: Array<{ type: string; type_id: string }>;
        };

        const asset = imp.results?.find((r) => r.type === 'Asset');
        if (asset) return asset.type_id;
        if (imp.status === 'Fail') throw new Error(imp.error || 'CloudTAK could not store the file');

        await new Promise((r) => setTimeout(r, 1500));
    }

    throw new Error('Timed out waiting for CloudTAK to store the file');
}

/** Send a file stored in Files to specific users and/or channels (a TAK file share). */
export async function sendToDestinations(assetId: string, name: string, dest: Destinations): Promise<void> {
    const destinations = [
        ...dest.uids.map((uid) => ({ uid })),
        ...dest.groups.map((group) => ({ group })),
    ];
    if (!destinations.length) throw new Error('Pick at least one user or channel');

    await std(stdurl('/api/marti/package'), {
        method: 'PUT',
        timeout: UPLOAD_TIMEOUT,
        body: {
            type: 'FeatureCollection',
            name,
            public: false,
            keywords: ['map'],
            assets: [{ type: 'profile', id: assetId }],
            basemaps: [],
            features: [],
            destinations,
        },
    });
}

/** Add the file to a Data Sync (mission) the user is subscribed to. */
export async function uploadToDataSync(guid: string, blob: Blob, filename: string): Promise<void> {
    const form = new FormData();
    form.append('file', asFile(blob, filename));

    const url = stdurl(`/api/marti/missions/${encodeURIComponent(guid)}/upload`);
    url.searchParams.set('name', filename);

    await std(url, { method: 'POST', body: form, timeout: UPLOAD_TIMEOUT });
}

/** Publish as a Data Package in the TAK Server package list for the given channels. */
export async function publishDataPackage(blob: Blob, filename: string, name: string, groups: string[]): Promise<string> {
    const url = stdurl('/api/marti/package');
    url.searchParams.set('name', name);
    for (const g of groups) url.searchParams.append('groups', g);
    url.searchParams.append('keywords', 'map');

    const form = new FormData();
    form.append('file', asFile(blob, filename));

    const res = await std(url, { method: 'POST', body: form, timeout: UPLOAD_TIMEOUT }) as { UID?: string; uid?: string };
    return res.UID || res.uid || '';
}

/** Save the file on this device. */
export function downloadLocally(blob: Blob, filename: string): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}
