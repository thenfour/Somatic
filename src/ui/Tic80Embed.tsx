"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

declare global {
    // Emscripten convention: a global "Module" object is read by the generated JS.
    // We keep it loosely typed because different TIC-80 builds may attach more fields.
    interface Window {
        Module?: any;
    }
}
declare global {
    interface Window { __tic80Injected?: boolean; }
}


function injectTic80ScriptOnce(src: string) {
    if (window.__tic80Injected) return;
    window.__tic80Injected = true;

    const s = document.createElement("script");
    s.src = src;
    s.type = "text/javascript";
    document.head.appendChild(s);
}

export type Tic80EmbedProps = {
    /* Arguments passed to TIC-80 (CLI-style). */
    args?: string[];
};

export function Tic80Embed({
    args = [],
}: Tic80EmbedProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const scriptInjectedRef = useRef(false);

    // Default overlay behavior mirrors the export:
    // - show overlay unless autoStart is enabled
    //const shouldShowOverlay = showOverlay ?? !autoStart;
    //const [overlayVisible, setOverlayVisible] = useState(shouldShowOverlay);

    // Keep overlay state in sync if props change
    // useEffect(() => {
    //     setOverlayVisible(shouldShowOverlay);
    // }, [shouldShowOverlay]);

    const containerStyle = useMemo<React.CSSProperties>(() => {
        return {
            margin: 0,
            position: "relative",
            background: "#1a1c2c",
            width: "100%",
            height: "100%",
        };
    }, []);

    const injectScript = useCallback(() => {
        if (scriptInjectedRef.current) return;
        if (!canvasRef.current) throw new Error("Tic80Embed: canvas not mounted yet");

        // This is the key line from your HTML: var Module = { canvas: ..., arguments: [] }
        // In module-scoped TS, we must attach it to window.
        window.Module = {
            canvas: canvasRef.current,
            arguments: args,
        };

        // Create and inject <script src="tic80.js">
        injectTic80ScriptOnce("/tic80.js");
        // const scriptTag = document.createElement("script");
        // scriptTag.type = "text/javascript";
        // scriptTag.src = "/tic80.js";

        // // Insert before the first script tag (matches your HTML), or append to head as fallback
        // const firstScriptTag = document.getElementsByTagName("script")[0];
        // if (firstScriptTag?.parentNode) firstScriptTag.parentNode.insertBefore(scriptTag, firstScriptTag);
        // else document.head.appendChild(scriptTag);

        scriptInjectedRef.current = true;
    }, []);

    const start = useCallback(() => {
        injectScript();
        //setOverlayVisible(false);
    }, [injectScript]);

    // Auto-start case: inject on mount (like the export when the frame is display:none)
    useEffect(() => {
        injectScript();
    }, []);

    return (
        <div style={containerStyle}>
            <canvas
                ref={canvasRef}
                id="canvas"
                style={{
                    width: "100%",
                    height: "100%",
                    margin: "0 auto",
                    display: "block",
                    imageRendering: "pixelated",
                }}
                onContextMenu={(e) => e.preventDefault()}
                onMouseDown={() => window.focus()}
            />
        </div>
    );
}
