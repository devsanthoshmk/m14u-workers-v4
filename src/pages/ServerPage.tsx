import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCustomApiStore } from '@/stores/customApiStore';
import { Loader2, Radio } from 'lucide-react';

export function ServerPage() {
    const { code } = useParams<{ code: string }>();
    const { connectCode, status, error } = useCustomApiStore();
    const navigate = useNavigate();

    useEffect(() => {
        if (!code) {
           navigate('/');
           return;
        }
        if (status === 'idle' || status === 'error') {
            connectCode(code);
        } else if (status === 'connected') {
            // Once connected, navigate to home
            navigate('/');
        }
    }, [code, status, connectCode, navigate]);

    return (
        <div className="min-h-[100dvh] bg-background text-foreground flex flex-col items-center justify-center px-6">
            <div className="w-full max-w-sm flex flex-col items-center gap-6">
                <div className="flex items-center justify-center w-16 h-16 rounded-full bg-[#ff3b6b]/10">
                    {status === 'error' ? (
                        <Radio className="h-8 w-8 text-red-500" />
                    ) : (
                        <Radio className="h-8 w-8 text-[#ff3b6b]" />
                    )}
                </div>
                <div className="text-center">
                    <h1 className="text-2xl font-bold">Connecting Server</h1>
                    <p className="text-sm text-white/50 mt-1">Code: {code}</p>
                </div>

                {error && (
                    <div className="w-full rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400 text-center">
                        {error}
                        <div className="mt-4">
                            <button
                                onClick={() => navigate('/')}
                                className="w-full rounded-xl bg-white/[0.08] px-4 py-3 text-sm font-semibold text-white hover:bg-white/[0.12] transition-colors"
                            >
                                Go Back
                            </button>
                        </div>
                    </div>
                )}

                {status === 'connecting' && (
                    <div className="w-full flex justify-center py-4">
                        <Loader2 className="h-8 w-8 animate-spin text-[#ff3b6b]" />
                    </div>
                )}
            </div>
        </div>
    );
}
