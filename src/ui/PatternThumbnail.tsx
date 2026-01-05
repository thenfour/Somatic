import { isNoteCut, Pattern } from "../models/pattern";
import { Tic80Caps } from "../models/tic80Capabilities";
import { clamp } from "../utils/utils";

const MAX_THUMB_SIZE = 32;
const CHANNEL_WIDTH = 6; // pixels per channel
const ROWS_PER_PIXEL = 2;
// Keeps the overall thumbnail height the same; only changes visual banding.
const THUMBNAIL_ROW_QUANT_PX = 1;

export type ThumbnailSize = "off" | "full";
export type ThumbnailMode = "notes" | "currentInstrument";

export type ThumbnailPrefs = {
    size: ThumbnailSize;
    mode: ThumbnailMode;
};

export const renderThumbnail = (
    pattern: Pattern | undefined,
    rowsPerPattern: number,
    prefs: ThumbnailPrefs,
    currentInstrument: number,
): React.ReactNode => {
    if (prefs.size === "off" || !pattern) return null;

    const width = CHANNEL_WIDTH * Tic80Caps.song.audioChannels;
    const heightPx = clamp(Math.ceil(rowsPerPattern / ROWS_PER_PIXEL), 1, MAX_THUMB_SIZE);
    const quantPx = clamp(THUMBNAIL_ROW_QUANT_PX, 1, heightPx);
    const blocks = Math.ceil(heightPx / quantPx);

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
                if (prefs.mode === "currentInstrument" && cell.instrumentIndex === currentInstrument) {
                    isHighlighted = true;
                    break;
                }
            }

            if (hasNote) {
                rects.push(
                    <rect
                        key={`${ch}-${block}-${isHighlighted ? "h" : "f"}`}
                        x={ch * CHANNEL_WIDTH}
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
            width={width}
            height={heightPx}
            viewBox={`0 0 ${width} ${heightPx}`}
            aria-label="Pattern thumbnail"
            role="img"
        >
            {rects}
        </svg>
    );
};
