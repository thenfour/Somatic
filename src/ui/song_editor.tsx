import React, { useEffect } from 'react';
import { AudioController } from '../audio/controller';
//import { INSTRUMENT_COUNT, OCTAVE_COUNT, PATTERN_COUNT } from '../defs';
import { EditorState } from '../models/editor_state';
import { Song } from '../models/song';
//import { PositionList } from './position_list';
import { Tooltip } from './tooltip';
import { Tic80Caps } from '../models/tic80Capabilities';
import { TryParseInt } from '../utils/utils';
import { encodePattern, fromBase64, RLEDecode, RLEDecodeTriplets, RLEncode, RLEncodeTriplets, toBase64 } from '../audio/tic80_cart_serializer';

type SongEditorProps = {
    song: Song;
    editorState: EditorState;
    onSongChange: (mutator: (song: Song) => void) => void;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    audio: AudioController;
};

export const SongEditor: React.FC<SongEditorProps> = ({ song, editorState, onSongChange, onEditorStateChange, audio }) => {
    const effectiveBpm = Math.round(((song.tempo * 6) / song.speed) * 10) / 10; // TIC BPM approximation
    const patternId = song.songOrder[editorState.selectedPosition]!;
    const pattern = song.patterns[patternId]!;

    const [serilaizedPattern, setSerializedPattern] = React.useState<Uint8Array>(new Uint8Array());
    const [compressedPattern, setCompressedPattern] = React.useState<Uint8Array>(new Uint8Array());
    const [roundTripStatus, setRoundTripStatus] = React.useState<string>("");
    const [compressedPattern3, setCompressedPattern3] = React.useState<Uint8Array>(new Uint8Array());
    const [roundTripStatus3, setRoundTripStatus3] = React.useState<string>("");
    const [b64Status, setB64Status] = React.useState<string>("");
    const [distinctTriplets, setDistinctTriplets] = React.useState<number>(0);

    useEffect(() => {
        const serializedD = encodePattern(pattern);
        // lump together
        const serialized = new Uint8Array(serializedD[0].length + serializedD[1].length + serializedD[2].length + serializedD[3].length);
        serialized.set(serializedD[0], 0);
        serialized.set(serializedD[1], serializedD[0].length);
        serialized.set(serializedD[2], serializedD[0].length + serializedD[1].length);
        serialized.set(serializedD[3], serializedD[0].length + serializedD[1].length + serializedD[2].length);
        setSerializedPattern(serialized);

        // RLE
        {
            const compressed = RLEncode(serialized);
            setCompressedPattern(compressed);
            const roundTrip = RLEDecode(compressed);

            setRoundTripStatus("OK");

            if (roundTrip.length !== serialized.length) {
                setRoundTripStatus(`Length mismatch: expected ${serialized.length}, got ${roundTrip.length}`);
            } else {
                for (let i = 0; i < roundTrip.length; i++) {
                    if (roundTrip[i] !== serialized[i]) {
                        setRoundTripStatus(`Data mismatch at byte ${i}: expected ${serialized[i]}, got ${roundTrip[i]}`);
                        break;
                    }
                }
            }
        }

        // RLE Triplets
        {
            const compressed3 = RLEncodeTriplets(serialized);
            setCompressedPattern3(compressed3);
            const roundTrip3 = RLEDecodeTriplets(compressed3, serialized.length);
            setRoundTripStatus3("OK");

            if (roundTrip3.length !== serialized.length) {
                setRoundTripStatus3(`Length mismatch: expected ${serialized.length}, got ${roundTrip3.length}`);
            } else {
                for (let i = 0; i < roundTrip3.length; i++) {
                    if (roundTrip3[i] !== serialized[i]) {
                        setRoundTripStatus3(`Data mismatch at byte ${i}: expected ${serialized[i]}, got ${roundTrip3[i]}`);
                        break;
                    }
                }

            }

            // now base64 encode it. this is the size of the LUA code.
            const b64 = toBase64(compressed3);
            const roundTripB64 = fromBase64(b64);
            let b64Status = `b64 size: ${b64.length}`;
            if (roundTripB64.length !== compressed3.length) {
                b64Status += `; Length mismatch: expected ${compressed3.length}, got ${roundTripB64.length}`;
            } else {
                for (let i = 0; i < roundTripB64.length; i++) {
                    if (roundTripB64[i] !== compressed3[i]) {
                        b64Status += `; Data mismatch at byte ${i}: expected ${compressed3[i]}, got ${roundTripB64[i]}`;
                        break;
                    }
                }
            }
            setB64Status(b64Status);
        }

        // calculate the number of discrete 24-bit byte triples in the serialized payload.
        {
            const tripletSet = new Set<number>();
            for (let i = 0; i < serialized.length; i += 3) {
                const byte1 = serialized[i];
                const byte2 = (i + 1 < serialized.length) ? serialized[i + 1] : 0;
                const byte3 = (i + 2 < serialized.length) ? serialized[i + 2] : 0;
                const triplet = (byte1 << 16) | (byte2 << 8) | byte3;
                tripletSet.add(triplet);
            }
            setDistinctTriplets(tripletSet.size);
        }

    }, [pattern]);

    const onSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = TryParseInt(e.target.value);
        if (val === null) return;
        onSongChange((s) => s.setSpeed(val));
    };

    const onTempoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = TryParseInt(e.target.value);
        if (val === null) return;
        onSongChange((s) => s.setTempo(val));
    };

    const onRowsPerPatternChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = TryParseInt(e.target.value);
        if (val === null) return;
        onSongChange((s) => s.setRowsPerPattern(val));
    };

    const onOctaveChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = TryParseInt(e.target.value);
        if (val === null) return;
        onEditorStateChange((state) => state.setOctave(val));
    };

    // const onCurrentInstrumentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    //     const val = TryParseInt(e.target.value);
    //     if (val === null) return;
    //     onEditorStateChange((state) => state.setCurrentInstrument(val));
    // };

    const onHighlightRowCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = TryParseInt(e.target.value);
        if (val === null) return;
        onSongChange((s) => s.setHighlightRowCount(val));
    };

    return (
        <div className="section">
            {/* <PositionList
                song={song}
                editorState={editorState}
                onSongChange={onSongChange}
                onEditorStateChange={onEditorStateChange}
                audio={audio}
            /> */}
            <div className="field-row">
                <label htmlFor="song-tempo">Tempo</label>
                <Tooltip
                    content={(
                        <>
                            Effective BPM ≈ tempo*6/speed. Higher tempo = faster; higher speed = slower rows.<br />
                            Current ≈ {effectiveBpm} BPM.
                        </>
                    )}
                >
                    <span aria-hidden="true">?</span>
                </Tooltip>
                <input id="song-tempo" type="number" min={1} max={255} value={song.tempo} onChange={onTempoChange} />
            </div>
            <div className="field-row">
                <label htmlFor="song-speed">Speed</label>
                <Tooltip
                    label="Speed help"
                    content={(
                        <>
                            TIC tick divisor; rows advance slower as speed increases. Effective BPM ≈ tempo*6/speed.<br />
                            Current ≈ {effectiveBpm} BPM.
                        </>
                    )}
                >
                    <span aria-hidden="true">?</span>
                </Tooltip>
                <input id="song-speed" type="number" min={1} max={31} value={song.speed} onChange={onSpeedChange} />
            </div>
            <div className="field-row">
                <label htmlFor="song-rows-per-pattern">Pattern Len</label>
                <Tooltip
                    content={(
                        <>
                            Rows per pattern. Affects all patterns in the song.
                        </>
                    )}
                >
                    <span aria-hidden="true">?</span>
                </Tooltip>
                <input id="song-rows-per-pattern" type="number" min={1} max={Tic80Caps.pattern.maxRows} value={song.rowsPerPattern} onChange={onRowsPerPatternChange} />
            </div>
            <label>
                Highlight rows
                <input
                    type="number"
                    min={1}
                    max={64}
                    value={song.highlightRowCount}
                    onChange={onHighlightRowCountChange}
                />
            </label>
            <label>
                Octave
                <input type="number" min={1} max={Tic80Caps.pattern.octaveCount/* -1 + 1 for 1-baseddisplay */} value={editorState.octave} onChange={onOctaveChange} />
            </label>
            <label>
                Instrument
                <select
                    value={editorState.currentInstrument}
                    onChange={(e) => onEditorStateChange((state) => state.setCurrentInstrument(parseInt(e.target.value, 10)))}
                >
                    {Array.from({ length: Tic80Caps.sfx.count }, (_, i) => (
                        <option key={i} value={i}>
                            {song.instruments[i].name}
                        </option>
                    ))}
                </select>
                {/* <input
                    type="number"
                    min={1}
                    max={Tic80Caps.sfx.count}
                    value={editorState.currentInstrument}
                    onChange={onCurrentInstrumentChange}
                /> */}
            </label>
            <div>{patternId}: {pattern.name}; {serilaizedPattern.length} ({distinctTriplets} triples) ‣ [RLE:{compressedPattern.length} ({roundTripStatus})] [RLE3:{compressedPattern3.length} ({roundTripStatus3})] [{b64Status}]</div>
        </div>
    );
};
