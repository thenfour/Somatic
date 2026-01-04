import React, { useMemo } from 'react';

import { assignEvenHues } from '../utils/utils';
import './MemoryMapVis.css';
import { Tooltip } from './basic/tooltip';

interface MemoryMapVisRegion {
    startAddress: number;
    length: number;
    label?: string;
    hashKey?: string;
    type?: "used" | "free";
}

interface MemoryMapVisProps {
    root: MemoryMapVisRegion; // represents the full memory range
    regions: MemoryMapVisRegion[]; // regions to display within the root; assumed to be non-overlapping and within root
};

const UNUSED_KEY = "4d4f4731-8890-463d-895e-4aa2bbb2764b"; // uuid

const getHashKeySafe = (region: MemoryMapVisRegion, index: number): string => {
    return region.hashKey ?? `region-${index}`;
};

export const MemoryMapVis: React.FC<MemoryMapVisProps> = (props) => {

    const hues = useMemo(() => {
        return assignEvenHues(props.regions.map((r, i) => getHashKeySafe(r, i)));
    }, [props.regions]);

    const rootStats = useMemo(() => {
        let usedBytes = 0;
        for (const region of props.regions) {
            usedBytes += region.length;
        }
        return { usedBytes, freeBytes: props.root.length - usedBytes };
    }, [props.root, props.regions]);

    const gapRegions = useMemo(() => {
        const gaps: MemoryMapVisRegion[] = [];
        const sortedRegions = props.regions.slice().sort((a, b) => a.startAddress - b.startAddress);
        let currentAddress = props.root.startAddress;
        for (const region of sortedRegions) {
            if (region.startAddress > currentAddress) {
                gaps.push({
                    startAddress: currentAddress,
                    length: region.startAddress - currentAddress,
                    label: 'Unused',
                    hashKey: UNUSED_KEY,
                    type: "free",
                });
            }
            currentAddress = region.startAddress + region.length;
        }
        // final gap to end of root
        if (currentAddress < props.root.startAddress + props.root.length) {
            gaps.push({
                startAddress: currentAddress,
                length: (props.root.startAddress + props.root.length) - currentAddress,
                label: 'Unused',
                hashKey: UNUSED_KEY,
                type: "free",
            });
        }
        return gaps;
    }, [props.root, props.regions]);

    const globalSummaryTooltip = <div style={{ marginTop: '8px', borderTop: '1px solid var(--border-strong)', paddingTop: '4px' }}>
        <div><strong>{props.root.label ?? "Memory Map Summary"}</strong></div>
        <div>Total Size: {props.root.length} bytes</div>
        <div>Used regions: {props.regions.length} ({rootStats.usedBytes} bytes)</div>
        <div>Free regions: {gapRegions.length} ({rootStats.freeBytes} bytes)</div>
    </div>;

    return (
        <div className="memory-map-vis">
            {[...props.regions, ...gapRegions].map((region, index) => {
                // calc position & width in percent of parent.
                // they will land in CSS vars.
                const percentageStart = ((region.startAddress - props.root.startAddress) / props.root.length) * 100;
                const percentageWidth = (region.length / props.root.length) * 100;
                // calculated a hsl color based on hashKey.
                const colorHue = hues[getHashKeySafe(region, index)];

                const tooltip = <div>
                    <div><strong>{region.label}</strong></div>
                    <div>Start: {region.startAddress}</div>
                    <div>Length: {region.length} bytes</div>
                    <div>% of total: {((region.length / props.root.length) * 100).toFixed(2)}%</div>
                    {/* <div>Type: {region.type === "free" ? "Free/Unused" : "Used"}</div> */}
                    {globalSummaryTooltip}
                </div>;

                return <Tooltip title={tooltip} key={index}>
                    <div
                        key={index}
                        className={`memory-map-vis__region memory-map-vis__region--${region.type}`}
                        style={{
                            '--memmap-region-start': `${percentageStart}%`,
                            '--memmap-region-width': `${percentageWidth}%`,
                            '--memmap-region-hue': colorHue,
                        } as React.CSSProperties}
                    >
                    </div>
                </Tooltip>;
            })}
        </div>
    );
};