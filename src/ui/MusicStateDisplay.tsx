import React, { useCallback, useState } from "react";
import { MusicState } from "../audio/backend";
import { Tooltip } from "./tooltip";
import { AudioController } from "../audio/controller";

const FPS_UPDATE_INTERVAL_MS = 500;
const FPS_WARNING_THRESHOLD = 45; // below this and we show a warning

// why accept musicState as a prop? to let the parent fetch it only when needed
// and why not put fps in music state? because we expect it's updating constantly and don't want infinite re-renders
export const MusicStateDisplay: React.FC<{ bridgeReady: boolean; audio: AudioController, musicState: MusicState }> = ({ bridgeReady, audio, musicState }) => {
    if (!bridgeReady) {
        return <Tooltip title="TIC-80 bridge is initializing... should take a few seconds">
            <div className='musicState-panel musicState-panel--booting'>
                <div className='loading-spinner'></div>
            </div>
        </Tooltip>;
    }

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

    return <Tooltip title={<div>
        <div>TIC-80 playback status</div>
        <table>
            <tbody>                <tr>
                <td>FPS</td><td>{fps}</td>
            </tr>
                <tr>
                    <td>Playing</td><td>{musicState.isPlaying ? 'Yes' : 'No'}</td>
                </tr>
                <tr>
                    <td>Order</td><td>{musicState.somaticSongPosition}</td>
                </tr>
                <tr>
                    <td>Row</td><td>{musicState.tic80RowIndex}</td>
                </tr>
                <tr>
                    <td>Looping?</td><td>{musicState.isLooping ? 'Yes' : 'No'}</td>
                </tr>
            </tbody>
        </table>
    </div>}>
        <div className='musicState-panel'>
            <div className='flags'>
                <div className={`fps ${fps < FPS_WARNING_THRESHOLD ? 'warning' : ''}`}>
                    <div className={`key`}>FPS:</div>
                    <div className='value'>{fps}{fps < FPS_WARNING_THRESHOLD ? ' ⚠️' : ''}</div>
                </div>
                {audio.getMusicState().isPlaying ? <>
                    <div className='key'>Order:</div><div className='value'>{musicState.somaticSongPosition}</div>
                    <div className='key'>Row:</div><div className='value'>{musicState.tic80RowIndex}</div>
                </> : <>Ready</>}
            </div>
        </div>
    </Tooltip>;
};