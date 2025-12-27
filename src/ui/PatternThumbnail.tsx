import { isNoteCut, Pattern } from "../models/pattern";
import { Tic80Caps } from "../models/tic80Capabilities";
import { clamp } from "../utils/utils";

const MAX_THUMB_SIZE = 32;
const CHANNEL_WIDTH = 8; // pixels per channel
const ROWS_PER_PIXEL = 2;

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
    const height = clamp(Math.ceil(rowsPerPattern / ROWS_PER_PIXEL), 1, MAX_THUMB_SIZE);

    const rects: React.ReactNode[] = [];

    for (let ch = 0; ch < 4; ch += 1) {
        for (let block = 0; block < height; block += 1) {
            const rowStart = block * ROWS_PER_PIXEL;
            const rowEnd = Math.min(rowsPerPattern, rowStart + ROWS_PER_PIXEL);
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
                        y={block}
                        width={CHANNEL_WIDTH}
                        height={1}
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
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-label="Pattern thumbnail"
            role="img"
        >
            {rects}
        </svg>
    );
};
