import React, { useEffect, useRef } from 'react';
import { AudioController } from '../audio/controller';
import { FrameData, Wave } from '../models/instruments';

const WIDTH = 256;
const HEIGHT = 128;

type ScopeProps = {
    instrument: Wave;
    scrub: number;
    audio: AudioController;
};

export const Scope: React.FC<ScopeProps> = ({ instrument, scrub, audio }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

    const clear = () => {
        const ctx = ctxRef.current;
        if (!ctx) return;
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
    };

    const drawFrame = (frameData: FrameData | null | undefined) => {
        const ctx = ctxRef.current;
        if (!ctx || !frameData) return;
        clear();
        ctx.fillStyle = '#0ff';

        let waveformIsNoise = true;
        for (let i = 0; i < 32; i++) {
            if (frameData.waveform[i] !== 0) {
                waveformIsNoise = false;
                break;
            }
        }

        for (let i = 0; i < 32; i++) {
            let waveLevel: number;
            if (waveformIsNoise) {
                waveLevel = Math.random() >= 0.5 ? 15 : 0;
            } else {
                waveLevel = frameData.waveform[i];
            }
            const level = ((waveLevel - 7.5) / 7.5) * (frameData.volume / 15);
            ctx.fillRect((i * WIDTH) / 32, ((-level + 1) / 2) * (HEIGHT - 4), WIDTH / 32, 4);
        }
    };

    useEffect(() => {
        if (!canvasRef.current) return;
        ctxRef.current = canvasRef.current.getContext('2d');
        clear();
    }, []);

    useEffect(() => {
        if (!instrument) return;
        const generator = instrument.getFrameCallback(440);
        const frameData = generator(scrub);
        drawFrame(frameData);
    }, [instrument, scrub]);

    useEffect(() => {
        const onFrame = (frameData: Array<FrameData | null>) => {
            if (frameData[0]) drawFrame(frameData[0]);
        };
        audio.on('frame', onFrame);
        return () => {
            audio.removeListener('frame', onFrame);
        };
    }, [audio]);

    return <canvas className="scope" width={WIDTH} height={HEIGHT} ref={canvasRef}></canvas>;
};
