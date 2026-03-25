/**
 * NotFoundPage — Friendly 404.
 */

import { useNavigate } from 'react-router-dom';
import { Home, Music2 } from 'lucide-react';
import { motion } from 'framer-motion';

export function NotFoundPage() {
    const navigate = useNavigate();

    return (
        <div className="flex items-center justify-center h-full px-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center space-y-4"
            >
                <div className="flex justify-center">
                    <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-surface">
                        <Music2 className="h-10 w-10 text-muted-foreground" />
                    </div>
                </div>
                <h1 className="text-4xl font-bold font-heading">404</h1>
                <p className="text-muted-foreground">This page doesn't exist</p>
                <button
                    onClick={() => navigate('/')}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-all"
                >
                    <Home className="h-4 w-4" />
                    Go Home
                </button>
            </motion.div>
        </div>
    );
}
