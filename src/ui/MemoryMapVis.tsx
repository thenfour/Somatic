import React, { useMemo } from 'react';

import { assignEvenHues } from '../utils/utils';
import './MemoryMapVis.css';
import { Tooltip } from './basic/tooltip';
import { MemoryRegion } from '../utils/bitpack/MemoryRegion';

export interface MemoryMapVisProps {
    root: MemoryRegion; // represents the full memory range
    regions: MemoryRegion[]; // regions to display within the root; assumed to be non-overlapping and within root
};

const getHashKeySafe = (region: MemoryRegion, index: number): string => {
    return region.hashKey ?? `region-${index}`;
};

export const MemoryMapTextSummary: React.FC<MemoryMapVisProps> = (props) => {
    // simple text summary of the memory map
    // for use in tooltips, etc.
    // lists each region (no gaps)
    const sortedRegions = useMemo(() => {
        return props.regions.slice().sort((a, b) => a.address - b.address);
    }, [props.regions]);

    return <div className="memory-map-vis__text-summary">
        <div><strong>{props.root.name ?? "Memory Map Summary"}</strong></div>
        <div>First byte @ {props.root.address} (0x{props.root.address.toString(16)})</div>
        <div>Last byte @ {props.root.address + props.root.size - 1} (0x{(props.root.address + props.root.size - 1).toString(16)})</div>
        <div>Total Size: {props.root.size} (0x{props.root.size.toString(16)}) bytes</div>
        <div>Regions:</div>
        <ul>
            {sortedRegions.map((region, index) => (
                <li key={index}>
                    <strong>{region.name}</strong>: Start: {region.address} (0x{region.address.toString(16)}), LastByte @ {region.address + region.size - 1} (0x{(region.address + region.size - 1).toString(16)}), Length: {region.size} ({region.size.toString(16)}) bytes, % of total: {((region.size / props.root.size) * 100).toFixed(2)}%
                    {/* warn if OOB of the root region */}
                    {(!props.root.containsRegion(region)) && <span style={{ color: 'var(--color-error)' }}> (OUT OF BOUNDS!)</span>}
                </li>
            ))}
        </ul>
    </div>;
};

export const MemoryMapVis: React.FC<MemoryMapVisProps> = (props) => {

    const hues = useMemo(() => {
        return assignEvenHues(props.regions.map((r, i) => getHashKeySafe(r, i)));
    }, [props.regions]);

    const rootStats = useMemo(() => {
        let usedBytes = 0;
        for (const region of props.regions) {
            usedBytes += region.size;
        }
        return { usedBytes, freeBytes: props.root.size - usedBytes };
    }, [props.root, props.regions]);

    const gapRegions = useMemo(() => {
        const gaps: MemoryRegion[] = [];
        const sortedRegions = props.regions.slice().sort((a, b) => a.address - b.address);
        let currentAddress = props.root.address;
        for (const region of sortedRegions) {
            if (region.address > currentAddress) {
                gaps.push(new MemoryRegion({
                    // address: currentAddress,
                    // size: region.address - currentAddress,
                    // name: 'Unused',
                    // hashKey: UNUSED_KEY,
                    // type: "free",
                    address: currentAddress,
                    size: region.address - currentAddress,
                    name: 'Unused',
                    hashKey: `unused_${currentAddress}`,
                    type: "free"
                }));
            }
            currentAddress = region.address + region.size;
        }
        // final gap to end of root
        if (currentAddress < props.root.address + props.root.size) {
            gaps.push(new MemoryRegion({
                address: currentAddress,
                size: (props.root.address + props.root.size) - currentAddress,
                name: 'Unused',
                hashKey: `unused_${currentAddress}`,
                type: "free",
            }));
        }
        return gaps;
    }, [props.root, props.regions]);

    const globalSummaryTooltip = <div style={{ marginTop: '8px', borderTop: '1px solid var(--border-strong)', paddingTop: '4px' }}>
        <div><strong>{props.root.name ?? "Memory Map Summary"}</strong></div>
        <div>First byte @ {props.root.address} (0x{props.root.address.toString(16)})</div>
        <div>Last byte @ {props.root.address + props.root.size - 1} (0x{(props.root.address + props.root.size - 1).toString(16)})</div>
        <div>Total Size: {props.root.size} (0x{props.root.size.toString(16)}) bytes</div>
        <div>Used regions: {props.regions.length} ({rootStats.usedBytes} (0x{rootStats.usedBytes.toString(16)}) bytes)</div>
        <div>Free regions: {gapRegions.length} ({rootStats.freeBytes} (0x{rootStats.freeBytes.toString(16)}) bytes)</div>
    </div>;

    return (
        <div className="memory-map-vis">
            {[...props.regions, ...gapRegions].map((region, index) => {
                // calc position & width in percent of parent.
                // they will land in CSS vars.
                const percentageStart = ((region.address - props.root.address) / props.root.size) * 100;
                const percentageWidth = (region.size / props.root.size) * 100;
                // calculated a hsl color based on hashKey.
                const colorHue = hues[getHashKeySafe(region, index)];

                const tooltip = <div style={{ minWidth: '200px' }}>
                    <div><strong>{region.name}</strong></div>
                    <div>Start: {region.address} (0x{region.address.toString(16)})</div>
                    <div>LastByte @ {region.address + region.size - 1} (0x{(region.address + region.size - 1).toString(16)})</div>
                    <div>Length: {region.size} ({region.size.toString(16)}) bytes</div>
                    <div>% of total: {((region.size / props.root.size) * 100).toFixed(2)}%</div>
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