/**
 * Type-safe LocalStorage helpers.
 * Designed to be easily swappable for a DB layer later.
 */

/**
 * Reads a value from LocalStorage, parsing it as JSON.
 * Returns the fallback value if the key doesn't exist or parsing fails.
 */
export function getStorageItem<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

/**
 * Writes a value to LocalStorage as JSON.
 * Silently fails on quota errors.
 */
export function setStorageItem<T>(key: string, value: T): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn(`[M14U] Failed to write to LocalStorage key "${key}":`, error);
    }
}

/**
 * Removes a key from LocalStorage.
 */
export function removeStorageItem(key: string): void {
    try {
        localStorage.removeItem(key);
    } catch {
        // Silently ignore
    }
}

/**
 * Appends an item to a stored array, enforcing a max length (FIFO eviction).
 * Returns the updated array.
 */
export function appendToStorageArray<T>(key: string, item: T, maxLength: number): T[] {
    const existing = getStorageItem<T[]>(key, []);
    const updated = [item, ...existing].slice(0, maxLength);
    setStorageItem(key, updated);
    return updated;
}
