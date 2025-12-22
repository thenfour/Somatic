import React, { useCallback, useState } from "react";
import { SomaticTransportState, Tic80TransportState } from "../audio/backend";
import { Tooltip } from "./tooltip";
import { AudioController } from "../audio/controller";
import { Song } from "../models/song";
import { calculateSongPositionInSeconds } from "../models/tic80Capabilities";
import { TransportTime } from "./transportTime";

const FPS_UPDATE_INTERVAL_MS = 500;
const FPS_WARNING_THRESHOLD = 45; // below this and we show a warning

// why accept musicState as a prop? to let the parent fetch it only when needed
// and why not put fps in music state? because we expect it's updating constantly and don't want infinite re-renders
export const MusicStateDisplay: React.FC<{ song: Song, bridgeReady: boolean; audio: AudioController, musicState: SomaticTransportState }> = ({ song, bridgeReady, audio, musicState }) => {

    const [fps, setFps] = useState(0);

    // read FPS from the audio backend every FPS_UPDATE_INTERVAL_MS
    React.useEffect(() => {
        const updateFPS = () => {
            const currentFps = audio.getFPS();
            setFps(currentFps);
        };

        updateFPS();
        const interval = setInterval(() => {
            updateFPS();
        }, FPS_UPDATE_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [audio]);

    if (!bridgeReady) {
        return <Tooltip title="TIC-80 bridge is initializing... should take a few seconds">
            <div className='musicState-panel musicState-panel--booting'>
                <div className='loading-spinner'></div>
            </div>
        </Tooltip>;
    }

    const fpsWarning = fps < FPS_WARNING_THRESHOLD;

    const currentSomaticSongPositionIfPlaying = musicState.currentSomaticSongPosition || 0;
    const currentSomaticRowIndexIfPlaying = musicState.currentSomaticRowIndex || 0;
    const currentRowInSong = song.rowsPerPattern * currentSomaticSongPositionIfPlaying + currentSomaticRowIndexIfPlaying;
    const positionSeconds = calculateSongPositionInSeconds({
        songTempo: song.tempo,
        songSpeed: song.speed,
        rowIndex: currentRowInSong,
    });

    return <Tooltip title={<div>
        <div>TIC-80 playback status</div>
        {fpsWarning && <div style={{ color: 'orange' }}>
            <div>⚠️ Low FPS detected ({fps} FPS)</div>
            <div>It means the tic80 won't keep up well and the audio will be glitchy / unstable.</div>
            <div>See: <a href="https://github.com/thenfour/Somatic/issues/56" target="_blank" rel="noopener noreferrer">github issue #56</a> for details about this issue.</div>
            <div>As a workaround, interact with the tic80 window at startup so the browser knows it's active</div>
        </div>}
        <table>
            <tbody>
                <tr>
                    <td>FPS</td><td>{fps}</td>
                </tr>
                <tr>
                    <td>Playing</td><td>{musicState.isPlaying ? 'Yes' : 'No'}</td>
                </tr>
                <tr>
                    <td>Order</td><td>{currentSomaticSongPositionIfPlaying}</td>
                </tr>
                <tr>
                    <td>Row</td><td>{musicState.backendState.tic80RowIndex}</td>
                </tr>
                {/* <tr>
                    <td>Looping?</td><td>{musicState.isLooping ? 'Yes' : 'No'}</td>
                </tr> */}
            </tbody>
        </table>
    </div>}>
        <div className='musicState-panel'>
            <div className='flags'>
                <div className={`fps ${fpsWarning ? 'warning' : ''}`}>
                    <div className={`key`}>FPS:</div>
                    <div className='value'>{fps}{fpsWarning ? ' ⚠️' : ''}</div>
                </div>
                {musicState.isPlaying ? <>
                    <div className='key order'>t80:</div><div className='value'>{musicState.backendState.reportedSongPosition}:{musicState.backendState.tic80RowIndex}</div>
                    <div className='key order'>som:</div><div className='value'>{currentSomaticSongPositionIfPlaying}:{currentSomaticRowIndexIfPlaying}</div>
                    <div className="key time">Time:</div><div className='value'>
                        <TransportTime positionSeconds={positionSeconds} />
                    </div>
                </> : <>Ready</>}
            </div>
        </div>
    </Tooltip>;
};