import type { Map as MapLibreMap } from 'maplibre-gl';

export interface CompressorResult {
    blob: Blob;
    filename: string;
}

export interface CompressorUI {
    readonly ready: boolean;
    readonly name: string;
    readonly quality: number;
    loadFile(file: File | Blob): Promise<void>;
    getGeoTiff(): Promise<CompressorResult>;
    getKmz(): Promise<CompressorResult>;
    getDataPackage(): Promise<CompressorResult>;
    onChange(fn: (ui: CompressorUI) => void): () => void;
    setStatus(message: string, isError?: boolean): void;
    destroy(): void;
}

export function mountCompressor(root: HTMLElement, opts?: {
    map?: MapLibreMap | null;
    quality?: number;
    accent?: string;
}): CompressorUI;
