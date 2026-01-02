import React, { useMemo, useState } from 'react';
import { Tic80Caps } from '../models/tic80Capabilities';
import { WaveformMorphGradientNode } from '../models/instruments';
import { Tic80Waveform } from '../models/waveform';
import { clamp, clamp01, curveT } from '../utils/utils';
import { WaveformSwatch } from './waveformSwatch';

export const MorphGradientPreview: React.FC<{
    nodes: WaveformMorphGradientNode[];
}> = ({ nodes }) => {
    const [previewTimeSeconds, setPreviewTimeSeconds] = useState(0);
    const [previewPos01Fallback, setPreviewPos01Fallback] = useState(0);

    const totalDurationSeconds = useMemo(() => {
        if (nodes.length <= 1) return 0;
        return nodes.slice(0, -1).reduce((acc, n) => acc + Math.max(0, n.durationSeconds), 0);
    }, [nodes]);

    const previewWaveform = useMemo(() => {
        if (nodes.length === 0) return null;
        if (nodes.length === 1) {
            return new Tic80Waveform({ name: '', amplitudes: [...nodes[0]!.amplitudes] });
        }

        let seg = nodes.length - 2;
        let localT = 1;

        if (totalDurationSeconds > 0) {
            let time = clamp(previewTimeSeconds, 0, totalDurationSeconds);
            for (let i = 0; i < nodes.length - 1; i++) {
                const dur = Math.max(0, nodes[i]!.durationSeconds);
                if (dur > 0) {
                    if (time < dur) {
                        seg = i;
                        localT = time / dur;
                        break;
                    }
                    time -= dur;
                }
            }
        } else {
            const x = clamp01(previewPos01Fallback) * (nodes.length - 1);
            seg = Math.min(nodes.length - 2, Math.floor(x));
            localT = x - seg;
        }

        const shapedT = curveT(localT, nodes[seg]!.curveN11);
        const a = nodes[seg]!.amplitudes;
        const b = nodes[seg + 1]!.amplitudes;
        const maxAmp = Tic80Caps.waveform.amplitudeRange - 1;

        const amps = Array.from({ length: Tic80Caps.waveform.pointCount }, (_, i) => {
            const va = a[i] ?? 0;
            const vb = b[i] ?? 0;
            const v = va + (vb - va) * shapedT;
            return clamp(Math.round(v), 0, maxAmp);
        });

        return new Tic80Waveform({ name: '', amplitudes: amps });
    }, [nodes, previewPos01Fallback, previewTimeSeconds, totalDurationSeconds]);

    if (!previewWaveform) return null;

    const pos01 = totalDurationSeconds > 0 ? clamp(previewTimeSeconds / totalDurationSeconds, 0, 1) : clamp(previewPos01Fallback, 0, 1);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
                <WaveformSwatch value={previewWaveform} scale={8} displayStyle="normal" overlayText={`${Math.round(pos01 * 100)}%`} />
            </div>

            {totalDurationSeconds > 0 ? (
                <input
                    type="range"
                    min={0}
                    max={totalDurationSeconds}
                    step={0.001}
                    value={clamp(previewTimeSeconds, 0, totalDurationSeconds)}
                    onChange={(e) => setPreviewTimeSeconds(Number(e.target.value))}
                    style={{ width: '100%' }}
                />
            ) : (
                <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.001}
                    value={previewPos01Fallback}
                    onChange={(e) => setPreviewPos01Fallback(Number(e.target.value))}
                    style={{ width: '100%' }}
                />
            )}
        </div>
    );
};
