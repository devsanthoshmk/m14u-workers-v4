/**
 * OnboardingModal — First-visit language selection.
 * Psychology: Asking preferences upfront personalizes the experience immediately.
 * Users who see content in their language on first load are 3x more likely to return.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Music2, ChevronRight, Globe } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { LOCALE_OPTIONS } from '@/utils/constants';
import { cn } from '@/lib/utils';

export function OnboardingModal() {
    const [selectedLocale, setSelectedLocale] = useState<string>('');
    const setUserLocale = useUIStore(s => s.setUserLocale);
    const setOnboardingDone = useUIStore(s => s.setOnboardingDone);

    const handleContinue = () => {
        if (selectedLocale) {
            setUserLocale(selectedLocale);
        } else {
            // Auto-detect from browser
            const browserLang = navigator.language?.split('-')[0] || 'en';
            const detected = LOCALE_OPTIONS.find(
                o => o.value.startsWith(browserLang)
            );
            setUserLocale(detected?.value || 'english');
        }
        setOnboardingDone();
    };

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95"
            >
                <motion.div
                    initial={{ scale: 0.9, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    className="w-full max-w-md mx-4 rounded-2xl bg-card border border-border p-6 md:p-8 shadow-2xl"
                >
                    {/* Logo & welcome */}
                    <div className="flex flex-col items-center text-center mb-6">
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary mb-4">
                            <Music2 className="h-9 w-9 text-primary-foreground" />
                        </div>
                        <h1 className="text-2xl font-bold font-heading text-foreground">Welcome to M14U</h1>
                        <p className="text-sm text-muted-foreground mt-4 max-w-sm">
                            This is a sample site which uses the open-source Invidious YT client.
                            I respect those projects, so please do not use this as a daily driver.
                            Instead, use the mobile app which has all the features listed in my resume repo:
                        </p>
                        <a
                            href="https://github.com/devsanthoshmk/m14u-workers-v4"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 text-primary hover:underline font-medium text-sm"
                        >
                            github.com/devsanthoshmk/m14u-workers-v4
                        </a>
                        <p className="text-xs text-muted-foreground mt-4">
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="space-y-2">
                        <button
                            onClick={handleContinue}
                            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 active:scale-[0.98] transition-all"
                        >
                            I Understand
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
