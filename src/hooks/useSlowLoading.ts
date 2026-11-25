import { useEffect, useState } from 'react';

const SLOW_LOADING_MS = 4000;

export function useSlowLoading(active: boolean, key: string) {
    const [load, setLoad] = useState({ active, key, slow: false });

    if (load.active !== active || load.key !== key) {
        setLoad({ active, key, slow: false });
    }

    useEffect(() => {
        if (!active) return;
        const timer = window.setTimeout(() => setLoad({ active, key, slow: true }), SLOW_LOADING_MS);
        return () => window.clearTimeout(timer);
    }, [active, key]);

    return active && load.key === key && load.slow;
}
