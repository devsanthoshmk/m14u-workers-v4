import { Capacitor } from '@capacitor/core';
import NativePlayback, { type NativeCapabilities } from '@/plugins/NativePlayback';

export const isNative = () => Capacitor.isNativePlatform();
export const isAndroid = () => Capacitor.getPlatform() === 'android';

export const DEFAULT_V1_CAPABILITIES: NativeCapabilities = {
    abiVersion: 1,
    sourceRefresh: false,
    localMedia: false,
    headlessResolver: false,
    resolverAbi: '',
    saavnUnprimed: false,
};

let cachedCapabilities: NativeCapabilities | null = null;
let pendingCapabilities: Promise<NativeCapabilities> | null = null;

function normalizeCapabilities(raw: unknown): NativeCapabilities {
    if (!raw || typeof raw !== 'object') {
        return { ...DEFAULT_V1_CAPABILITIES };
    }
    const candidate = raw as Record<string, unknown>;
    const abiVersion =
        typeof candidate.abiVersion === 'number' &&
        Number.isInteger(candidate.abiVersion) &&
        candidate.abiVersion >= 1
            ? candidate.abiVersion
            : 1;

    if (abiVersion < 2) {
        return {
            ...DEFAULT_V1_CAPABILITIES,
            resolverAbi: typeof candidate.resolverAbi === 'string' ? candidate.resolverAbi : '',
        };
    }

    return {
        abiVersion,
        sourceRefresh: candidate.sourceRefresh === true,
        localMedia: candidate.localMedia === true,
        headlessResolver: candidate.headlessResolver === true,
        resolverAbi: typeof candidate.resolverAbi === 'string' ? candidate.resolverAbi : '',
        ...(typeof candidate.sandboxSupported === 'boolean'
            ? { sandboxSupported: candidate.sandboxSupported }
            : {}),
        ...(typeof candidate.saavnUnprimed === 'boolean'
            ? { saavnUnprimed: candidate.saavnUnprimed }
            : {}),
    };
}

export function getCachedNativeCapabilities(): NativeCapabilities | null {
    return cachedCapabilities;
}

export function resetNativeCapabilitiesCacheForTest(): void {
    cachedCapabilities = null;
    pendingCapabilities = null;
}

export async function getNativeCapabilities(): Promise<NativeCapabilities> {
    if (!isNative() || !isAndroid() || !Capacitor.isPluginAvailable('NativePlayback')) {
        return { ...DEFAULT_V1_CAPABILITIES };
    }

    if (cachedCapabilities) {
        return cachedCapabilities;
    }

    if (pendingCapabilities) {
        return pendingCapabilities;
    }

    pendingCapabilities = (async () => {
        try {
            if (typeof NativePlayback?.getCapabilities !== 'function') {
                cachedCapabilities = { ...DEFAULT_V1_CAPABILITIES };
                return cachedCapabilities;
            }
            const raw = await NativePlayback.getCapabilities();
            cachedCapabilities = normalizeCapabilities(raw);
            return cachedCapabilities;
        } catch {
            cachedCapabilities = { ...DEFAULT_V1_CAPABILITIES };
            return cachedCapabilities;
        } finally {
            pendingCapabilities = null;
        }
    })();

    return pendingCapabilities;
}
