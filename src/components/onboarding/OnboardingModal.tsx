import { motion, AnimatePresence } from 'framer-motion';
import { Music2, ChevronRight } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';

export function OnboardingModal() {
    const setOnboardingDone = useUIStore(s => s.setOnboardingDone);


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
                    className="mx-4 max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl md:p-8"
                >
                    {/* Logo & welcome */}
                    <div className="flex flex-col items-center text-center mb-6">
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary mb-4">
                            <Music2 className="h-9 w-9 text-primary-foreground" />
                        </div>
                        <h1 className="text-2xl font-bold font-heading text-foreground">Welcome to M14U</h1>
                        <p className="text-sm text-muted-foreground mt-4 max-w-sm">
                            The web demo uses Invidious and is meant for trying out M14U. For regular listening and the full feature set, use the Android app.
                        </p>
                        <a
                            href="https://github.com/devsanthoshmk/m14u-workers-v4"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 text-primary hover:underline font-medium text-sm"
                        >
                            View M14U on GitHub
                        </a>
                    </div>

                    {/* Actions */}
                    <div className="space-y-2">
                        <button
                            onClick={setOnboardingDone}
                            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 active:scale-[0.98] transition-all"
                        >
                            Continue to M14U
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
