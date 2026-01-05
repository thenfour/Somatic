import React, { useMemo } from 'react';

import { assignEvenHues } from '../utils/utils';
import './MemoryMapVis.css';
import { Tooltip } from './basic/tooltip';
import { MemoryRegion } from '../utils/bitpack/MemoryRegion';
import { KeyValueTable } from './basic/KeyValueTable';
import { SizeValue } from './basic/BarValue';

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

    const overlapsByIndex = useMemo(() => {
        type Overlap = { other: MemoryRegion; start: number; endExclusive: number; size: number };
        const overlaps: Overlap[][] = Array.from({ length: sortedRegions.length }, () => []);

        for (let i = 0; i < sortedRegions.length; i++) {
            const a = sortedRegions[i];
            const a0 = a.address;
            const a1 = a.endAddress();
            for (let j = i + 1; j < sortedRegions.length; j++) {
                const b = sortedRegions[j];
                const b0 = b.address;
                const b1 = b.endAddress();

                const start = Math.max(a0, b0);
                const endExclusive = Math.min(a1, b1);
                const size = endExclusive - start;
                if (size > 0) {
                    overlaps[i].push({ other: b, start, endExclusive, size });
                    overlaps[j].push({ other: a, start, endExclusive, size });
                }
            }
        }

        for (const list of overlaps) {
            list.sort((x, y) => x.other.address - y.other.address);
        }

        return overlaps;
    }, [sortedRegions]);

    const summary = useMemo(() => {
        const hex = (n: number) => `0x${n.toString(16)}`;
        const lastByte = (r: MemoryRegion) => r.address + r.size - 1;
        const range = (r: MemoryRegion) => `${hex(r.address)}-${hex(lastByte(r))}`;
        const pct = (n: number, d: number) => d > 0 ? `${((n / d) * 100).toFixed(2)}%` : "0%";

        const regionData = sortedRegions.map((r, i) => ({
            name: r.name,
            range: range(r),
            sizeBytes: <SizeValue value={r.size} />,
            //sizeHex: hex(r.size),
            pctOfTotal: pct(r.size, props.root.size),
            outOfBounds: !props.root.containsRegion(r),
            overlaps: overlapsByIndex[i].map((o) => ({
                with: o.other.name,
                range: `${hex(o.start)}-${hex(o.endExclusive - 1)}`,
                sizeBytes: o.size,
            })),
        }));
        // convert that to a Record<string, any>
        const regions = Object.fromEntries(
            regionData.map((data, index) => {
                const { name, ...withoutName } = data;
                return [data.name ?? `Region ${index}`, withoutName];
            })
        );

        const rootLast = lastByte(props.root);
        return {
            name: props.root.name ?? "Memory Map Summary",
            range: `${hex(props.root.address)}-${hex(rootLast)}`,
            sizeBytes: <SizeValue value={props.root.size} />,
            //sizeHex: hex(props.root.size),
            //regionCount: sortedRegions.length,
            regions,
        };
    }, [props.root, sortedRegions, overlapsByIndex]);

    return <div className="memory-map-vis__text-summary">
        <KeyValueTable value={summary} maxDepth={4} maxArrayItems={200} />
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