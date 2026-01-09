import { isNoteCut, Pattern } from "../models/pattern";
import { ArrangementThumbnailSize } from "../models/song";
import { Tic80Caps } from "../models/tic80Capabilities";
import { clamp } from "../utils/utils";

// const BASE_MAX_THUMB_SIZE = 32;
// const BASE_CHANNEL_WIDTH = 6; // pixels per channel
// const BASE_CHANNEL_GAP = 1; // pixels between channels
// const BASE_ROWS_PER_PIXEL = 2;
// Keeps the overall thumbnail height the same; only changes visual banding.
//const THUMBNAIL_ROW_QUANT_PX = 1;

//export type ThumbnailSize = "off" | "small" | "normal" | "large";

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

// export type ThumbnailPrefs = {
//     size: ArrangementThumbnailSize;
//     mode: ThumbnailMode;
// };

export const renderThumbnail = (
    pattern: Pattern | undefined,
    rowsPerPattern: number,
    size: ArrangementThumbnailSize,
    currentInstrument: number,
): React.ReactNode => {
    if (size === "off" || !pattern) return null;
    //if (prefs.size === "off" || !pattern) return null;

    // Size presets: scale the base geometry to keep rendering crisp.
    //const sizeScale = prefs.size === "small" ? 0.75 : prefs.size === "large" ? 1.25 : 1;
    //const CHANNEL_WIDTH = Math.max(1, Math.round(BASE_CHANNEL_WIDTH * sizeScale));
    //const CHANNEL_GAP = Math.max(0, Math.round(BASE_CHANNEL_GAP * sizeScale));
    //const MAX_THUMB_SIZE = Math.max(1, Math.round(BASE_MAX_THUMB_SIZE * sizeScale));
    //const ROWS_PER_PIXEL = Math.max(1, Math.round(BASE_ROWS_PER_PIXEL / sizeScale));

    const sizeSpec = SIZE_SPECS[size];
    const CHANNEL_WIDTH = sizeSpec.channelWidth;
    const CHANNEL_GAP = 1;
    const ROWS_PER_PIXEL = sizeSpec.rowsPerPixel;
    //const MAX_THUMB_SIZE = 32; // no max; use natural size always.
    const heightPx = Math.ceil(rowsPerPattern / ROWS_PER_PIXEL);
    const quantPx = sizeSpec.rowQuantPx;
    const blocks = Math.ceil(heightPx / quantPx);
    const totalWidth = CHANNEL_WIDTH * Tic80Caps.song.audioChannels + (Tic80Caps.song.audioChannels - 1) * CHANNEL_GAP;

    // const totalWidth = CHANNEL_WIDTH * Tic80Caps.song.audioChannels + (Tic80Caps.song.audioChannels - 1) * CHANNEL_GAP;
    // const heightPx = clamp(Math.ceil(rowsPerPattern / ROWS_PER_PIXEL), 1, MAX_THUMB_SIZE);
    // const quantPx = clamp(THUMBNAIL_ROW_QUANT_PX, 1, heightPx);
    // const blocks = Math.ceil(heightPx / quantPx);

    const rects: React.ReactNode[] = [];

    for (let ch = 0; ch < 4; ch += 1) {
        for (let block = 0; block < blocks; block += 1) {
            const rowStart = block * quantPx * ROWS_PER_PIXEL;
            const rowEnd = Math.min(rowsPerPattern, rowStart + (quantPx * ROWS_PER_PIXEL));
            let hasNote = false;
            let isHighlighted = false;

            for (let row = rowStart; row < rowEnd; row += 1) {
                const cell = pattern.channels[ch]?.rows[row] ?? {};
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
