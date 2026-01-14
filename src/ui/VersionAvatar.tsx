import React, { useEffect, useMemo, useRef } from 'react';
import { buildInfo } from '../buildInfo';
import { generateIdenticonDrawList } from '../utils/identicon';
import { getSomaticVersionString } from '../utils/versionString';
import { Tooltip } from './basic/tooltip';

export type VersionAvatarProps = {
    onClick: () => void;
    resolution: { w: number; h: number };
    scale: number;
};

export const VersionAvatar: React.FC<VersionAvatarProps> = ({ onClick, resolution, scale }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    //const [n, setN] = React.useState(0);

    const versionString = useMemo(() => getSomaticVersionString(buildInfo), []);
    //console.log('Version string:', versionString);

    const draw = useMemo(() => {
        return generateIdenticonDrawList(versionString, resolution.w, resolution.h);
    }, [versionString, resolution.w, resolution.h]);

    //console.log(draw)

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const w = draw.width * scale;
        const h = draw.height * scale;
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, w, h);

        for (const r of draw.rects) {
            // Read actual colors from CSS vars so it matches the current theme.
            ctx.fillStyle = `var(--tic-${r.color})`;
            // Canvas doesn't understand CSS vars directly; resolve via computed style.
            // We'll do a minimal lookup per rect using getComputedStyle.
        }

        const style = getComputedStyle(document.documentElement);
        for (const r of draw.rects) {
            const cssColor = style.getPropertyValue(`--tic-${r.color}`);
            ctx.fillStyle = cssColor;
            ctx.fillRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
        }
    }, [draw, scale]);

    const tooltip = `${versionString}${buildInfo.commitHash ? `\n${buildInfo.commitHash}` : ''}`;

    return (
        <Tooltip title={tooltip}>
            <button
                type="button"
                className="version-avatar"
                onClick={() => {
                    //setN(n + 1);
                    onClick();
                }}
                aria-label={versionString}
            >
                <canvas
                    ref={canvasRef}
                    className="version-avatar__canvas"
                    width={draw.width * scale}
                    height={draw.height * scale}
                />
            </button>
        </Tooltip>
    );
};
