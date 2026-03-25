/**
 * ListenAlongModal — Coming Soon placeholder.
 * 
 * This feature will be re-enabled with a new architecture in the future.
 */

import * as Dialog from '@radix-ui/react-dialog';
import { X, Radio } from 'lucide-react';
import { motion } from 'framer-motion';

interface ListenAlongModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function ListenAlongModal({ open, onOpenChange }: ListenAlongModalProps) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay asChild>
                    <motion.div
                        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    />
                </Dialog.Overlay>
                <Dialog.Content asChild>
                    <motion.div
                        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-card p-6 shadow-2xl"
                        initial={{ opacity: 0, scale: 0.95, y: '-48%', x: '-50%' }}
                        animate={{ opacity: 1, scale: 1, y: '-50%', x: '-50%' }}
                        exit={{ opacity: 0, scale: 0.95 }}
                    >
                        <div className="flex flex-col items-center gap-4 text-center">
                            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
                                <Radio className="h-8 w-8 text-amber-500" />
                            </div>
                            
                            <div>
                                <Dialog.Title className="text-xl font-bold text-foreground">
                                    Listen Along
                                </Dialog.Title>
                                <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                                    Listen to music together with friends in real-time.
                                </Dialog.Description>
                            </div>

                            <div className="mt-2 rounded-xl bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-500">
                                Coming Soon
                            </div>

                            <p className="text-xs text-muted-foreground/60">
                                We're working on a new architecture to bring you
                                the best collaborative listening experience.
                            </p>
                        </div>

                        <Dialog.Close asChild>
                            <button
                                className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground hover:bg-white/5 hover:text-foreground"
                                aria-label="Close"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </Dialog.Close>
                    </motion.div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
