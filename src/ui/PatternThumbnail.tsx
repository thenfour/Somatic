import { isNoteCut, Pattern } from "../models/pattern";
import { ArrangementThumbnailSize } from "../models/song";

type ThumbnailSizeSpec = {
    enabled: boolean;
    channelWidth: number;
    rowsPerPixel: number;
    rowQuantPx: number;
};

const SIZE_SPECS: Record<ArrangementThumbnailSize, ThumbnailSizeSpec> = {
    "off": {
        enabled: false,
        channelWidth: 0,
        rowsPerPixel: 0,
        rowQuantPx: 0,
    },
    "small": {
        enabled: true,
        channelWidth: 4,
        rowsPerPixel: 3,
        rowQuantPx: 1,
    },
    "normal": {
        enabled: true,
        channelWidth: 6,
        rowsPerPixel: 2,
        rowQuantPx: 1,
    },
    "large": {
        enabled: true,
        channelWidth: 8,
        rowsPerPixel: 1,
        rowQuantPx: 2,
    },
};

export type ThumbnailMode = "notes" | "currentInstrument";

export const renderThumbnail = (
    channelCount: number,
    pattern: Pattern | undefined,
    rowsPerPattern: number,
    size: ArrangementThumbnailSize,
    currentInstrument: number,
): React.ReactNode => {
    if (size === "off" || !pattern) return null;

    const sizeSpec = SIZE_SPECS[size];
    const CHANNEL_WIDTH = sizeSpec.channelWidth;
    const CHANNEL_GAP = 1;
    const ROWS_PER_PIXEL = sizeSpec.rowsPerPixel;

    const heightPx = Math.ceil(rowsPerPattern / ROWS_PER_PIXEL);
    const quantPx = sizeSpec.rowQuantPx;
    const blocks = Math.ceil(heightPx / quantPx);
    const totalWidth = CHANNEL_WIDTH * channelCount + (channelCount - 1) * CHANNEL_GAP;

    const rects: React.ReactNode[] = [];

    for (let ch = 0; ch < channelCount; ch += 1) {
        for (let block = 0; block < blocks; block += 1) {
            const rowStart = block * quantPx * ROWS_PER_PIXEL;
            const rowEnd = Math.min(rowsPerPattern, rowStart + (quantPx * ROWS_PER_PIXEL));
            let hasNote = false;
            let isHighlighted = false;

            for (let row = rowStart; row < rowEnd; row += 1) {
                const cell = pattern.getCell(ch, row);
                const notePresent = !!cell.midiNote && !isNoteCut(cell);
                if (!notePresent) continue;
                hasNote = true;
                if (cell.instrumentIndex === currentInstrument) {
                    isHighlighted = true;
                    break;
                }
            }

            if (hasNote) {
                rects.push(
                    <rect
                        key={`${ch}-${block}-${isHighlighted ? "h" : "f"}`}
                        x={ch * CHANNEL_WIDTH + ch * CHANNEL_GAP}
                        y={block * quantPx}
                        width={CHANNEL_WIDTH}
                        height={quantPx}
                        data-role={isHighlighted ? "highlight" : "fill"}
                    />
                );
            }
        }
    }

    return (
        <svg
            className="arrangement-editor__thumbnail"
            width={totalWidth}
            height={heightPx}
            viewBox={`0 0 ${totalWidth} ${heightPx}`}
            aria-label="Pattern thumbnail"
            role="img"
        >
            {rects}
        </svg>
    );
};
