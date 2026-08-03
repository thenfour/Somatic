import React from "react";

type BravuraMarkerGlyph = "p" | "mp" | "mf" | "f" | "fermata";

interface BravuraGlyphData {
    path: string;
    viewBox: string;
}

// These five outlines are derived from the matching SMuFL glyphs in Bravura.svg:
// dynamicPiano (U+E520), dynamicMP (U+E52C), dynamicMF (U+E52D),
// dynamicForte (U+E522), and fermataAbove (U+E4C0). Bravura is distributed
// under the SIL Open Font License; see /licenses/Bravura-OFL.txt.
const BRAVURA_GLYPHS: Record<BravuraMarkerGlyph, BravuraGlyphData> = {
    p: {
        // Match the font-unit scale used by the wider dynamicMP glyph.
        viewBox: "-308 -298 893 464",
        path: "M274 274c56 0 92 -31 92 -89c0 -95 -78 -195 -174 -195c-17 0 -30 2 -44 9c-16 8 -19 18 -24 18s-7 -7 -9 -12l-45 -112c-1 -3 -2 -6 -2 -7c0 -3 3 -3 9 -3h40c8 0 12 -4 12 -12c0 -9 -4 -13 -13 -13h-193c-8 0 -12 4 -12 12c0 9 4 13 13 13h31c10 0 12 2 15 10l123 305 c3 7 6 17 6 25c0 7 -3 12 -11 12c-18 0 -38 -26 -67 -76c-5 -9 -9 -15 -16 -15c-6 0 -11 4 -11 11c0 5 2 10 7 19c31 57 63 99 122 99c26 0 41 -9 48 -21c9 -17 6 -24 11 -24c4 0 7 8 21 20c18 16 40 26 71 26zM247 237c-24 0 -50 -29 -64 -63l-20 -49 c-11 -28 -19 -48 -19 -69s8 -32 25 -32c48 0 101 127 101 176c0 22 -6 37 -23 37z",
    },
    mp: {
        viewBox: "-44 -298 893 464",
        path: "M444 132l7 16c24 54 56 125 131 125c26 0 41 -9 48 -21c9 -17 6 -24 11 -24c4 0 7 8 21 20c18 16 40 26 71 26c56 0 92 -31 92 -89c0 -95 -78 -195 -174 -195c-17 0 -30 2 -44 9c-16 8 -19 18 -24 18s-7 -7 -9 -12l-45 -112c-1 -3 -2 -6 -2 -7c0 -3 3 -3 9 -3h40 c8 0 12 -4 12 -12c0 -9 -4 -13 -13 -13h-193c-8 0 -12 4 -12 12c0 9 4 13 13 13h31c10 0 12 2 15 10l123 305c3 7 6 17 6 25c0 7 -2 12 -10 12c-26 0 -52 -51 -82 -119c-31 -71 -71 -126 -134 -126c-29 0 -45 14 -45 40c0 42 62 145 62 180c0 8 -3 14 -15 14 c-22 0 -43 -21 -55 -50l-65 -162c-4 -10 -7 -12 -16 -12h-49c-8 0 -11 2 -11 6c0 3 1 6 3 11c62 155 63 155 63 156c6 14 10 25 10 37c0 8 -3 14 -15 14c-22 0 -43 -21 -55 -50l-65 -162c-4 -10 -7 -12 -16 -12h-49c-8 0 -11 2 -11 6c0 3 1 6 3 11l73 181c3 7 6 17 6 25 c0 7 -3 12 -11 12c-18 0 -38 -27 -68 -78c-5 -8 -8 -13 -15 -13c-6 0 -11 4 -11 11c0 5 2 10 7 19c31 56 62 99 115 99c19 0 33 -10 39 -23c6 -14 3 -21 8 -21c4 0 5 4 15 14c16 17 39 31 68 31c25 0 38 -11 44 -24s3 -21 8 -21c4 0 5 4 15 14c16 17 39 31 68 31 c41 0 54 -29 54 -54c0 -55 -58 -142 -58 -177c0 -6 2 -9 8 -9c20 0 45 37 73 98zM628 24c48 0 101 127 101 176c0 22 -6 37 -23 37c-24 0 -50 -29 -64 -63l-20 -49c-11 -28 -19 -48 -19 -69s8 -32 25 -32z",
    },
    mf: {
        viewBox: "-44 -455 886 644",
        path: "M470 251h58c14 0 15 0 20 15c33 96 87 165 184 165c63 0 86 -30 86 -67s-23 -54 -49 -54c-25 0 -45 14 -45 42c0 18 8 32 21 38c11 5 16 4 16 10s-8 8 -16 8c-50 0 -72 -53 -92 -140c-1 -6 -2 -9 -2 -12c0 -5 3 -5 10 -5h60c10 0 15 -5 15 -15c0 -11 -5 -16 -16 -16h-65 c-5 0 -13 -9 -13 -12l-1 -1c-24 -85 -46 -147 -75 -208c-55 -113 -102 -164 -178 -164c-42 0 -75 23 -75 67c0 31 22 55 52 55c27 0 45 -15 45 -41c0 -16 -8 -29 -20 -37c-15 -10 -24 -5 -24 -13c0 -5 5 -9 18 -9c40 0 58 32 86 130l63 219c1 5 2 8 2 10c0 4 -2 4 -8 4h-58 c-10 0 -15 5 -15 15c0 11 5 16 16 16zM367 274c41 0 54 -29 54 -54c0 -55 -58 -142 -58 -177c0 -6 2 -9 8 -9c13 0 32 24 51 54c5 8 8 13 15 13c5 0 9 -3 9 -9c0 -5 -3 -11 -9 -21c-32 -53 -67 -81 -105 -81c-29 0 -45 14 -45 40c0 42 62 145 62 180c0 8 -3 14 -15 14 c-22 0 -43 -21 -55 -50l-65 -162c-4 -10 -7 -12 -16 -12h-49c-8 0 -11 2 -11 6c0 3 1 6 3 11c62 155 63 155 63 156c6 14 10 25 10 37c0 8 -3 14 -15 14c-22 0 -43 -21 -55 -50l-65 -162c-4 -10 -7 -12 -16 -12h-49c-8 0 -11 2 -11 6c0 3 1 6 3 11l73 181c3 7 6 17 6 25 c0 7 -3 12 -11 12c-18 0 -38 -27 -68 -78c-5 -8 -8 -13 -15 -13c-6 0 -11 4 -11 11c0 5 2 10 7 19c31 56 62 99 115 99c19 0 33 -10 39 -23c6 -14 3 -21 8 -21c4 0 5 4 15 14c16 17 39 31 68 31c25 0 38 -11 44 -24s3 -21 8 -21c4 0 5 4 15 14c16 17 39 31 68 31z",
    },
    f: {
        // Match the font-unit scale used by the wider dynamicMF glyph.
        viewBox: "-332 -468 886 644",
        path: "M16 264h58c14 0 15 0 20 15c33 96 87 165 184 165c63 0 86 -30 86 -67s-23 -54 -49 -54c-25 0 -45 14 -45 42c0 18 8 32 21 38c11 5 16 4 16 10s-8 8 -16 8c-50 0 -72 -53 -92 -140c-1 -6 -2 -9 -2 -12c0 -5 3 -5 10 -5h60c10 0 15 -5 15 -15c0 -11 -5 -16 -16 -16h-65 c-5 0 -13 -9 -13 -12l-1 -1c-24 -85 -46 -147 -75 -208c-55 -113 -102 -164 -178 -164c-42 0 -75 23 -75 67c0 31 22 55 52 55c27 0 45 -15 45 -41c0 -16 -8 -29 -20 -37c-15 -10 -24 -5 -24 -13c0 -5 5 -9 18 -9c40 0 58 32 86 130l63 219c1 5 2 8 2 10c0 4 -2 4 -8 4h-58 c-10 0 -15 5 -15 15c0 11 5 16 16 16z",
    },
    fermata: {
        viewBox: "-21 -353 650 380",
        path: "M302 221c-206 0 -251 -153 -263 -194c-1 -4 -2 -8 -3 -9c-6 -14 -11 -21 -20 -21c-8 0 -13 3 -13 13c0 3 0 7 1 11c61 306 268 308 300 308c29 0 238 -2 300 -308c1 -4 1 -7 1 -10c0 -10 -5 -14 -14 -14c-10 0 -14 7 -21 21c-1 1 -1 4 -2 7c-10 38 -53 196 -266 196z M358 52c0 -30 -25 -55 -55 -55c-29 0 -54 25 -54 55c0 29 25 54 54 54c30 0 55 -25 55 -54z",
    },
};

interface BravuraMarkerIconProps {
    glyph: BravuraMarkerGlyph;
}

export const BravuraMarkerIcon: React.FC<BravuraMarkerIconProps> = ({ glyph }) => {
    const data = BRAVURA_GLYPHS[glyph];

    return (
        <svg
            className="song-order-marker__music-icon"
            viewBox={data.viewBox}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
            focusable="false"
        >
            <path d={data.path} transform="scale(1 -1)" fill="currentColor" />
        </svg>
    );
};

interface HairpinMarkerIconProps {
    direction: "cresc" | "decresc";
}

export const HairpinMarkerIcon: React.FC<HairpinMarkerIconProps> = ({ direction }) => {
    const path = direction === "cresc"
        ? "M4 12L20 5M4 12L20 19"
        : "M20 12L4 5M20 12L4 19";

    return (
        <svg
            className="song-order-marker__music-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
        >
            <path
                d={path}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
};
