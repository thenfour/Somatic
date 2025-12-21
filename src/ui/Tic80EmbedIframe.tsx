// Tic80Iframe.tsx
"use client";

import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState
} from "react";
import { createPortal } from "react-dom";

declare global {
    interface Window {
        Module?: any;
    }
}

export type Tic80IframeHandle = {
    getWindow: () => Window | null;
    getDocument: () => Document | null;
};

export type Tic80IframeProps = {
    args?: string[];    // e.g. ["/bridge.tic"]
};

export const Tic80Iframe = forwardRef<Tic80IframeHandle, Tic80IframeProps>(
    function Tic80Iframe({ args = [] }, ref) {
        const iframeRef = useRef<HTMLIFrameElement | null>(null);
        const canvasRef = useRef<HTMLCanvasElement | null>(null);
        const injectedRef = useRef(false);

        const [frameDoc, setFrameDoc] = useState<Document | null>(null);
        const [frameWin, setFrameWin] = useState<Window | null>(null);
        const [hasStarted, setHasStarted] = useState(false);

        const mountId = "tic80-iframe-root" as const;

        useImperativeHandle(
            ref,
            () => ({
                getWindow: () => iframeRef.current?.contentWindow ?? null,
                getDocument: () => iframeRef.current?.contentDocument ?? null,
            }),
            []
        );

        useEffect(() => {
            const iframe = iframeRef.current;
            if (!iframe) return;

            const onLoad = () => {
                const doc = iframe.contentDocument;
                const win = iframe.contentWindow;
                if (!doc || !win) return;

                console.log("[tic80 iframe] loaded iframe", doc, win);

                doc.open();
                doc.write("<!doctype html><html><head></head><body></body></html>");
                doc.close();

                doc.documentElement.style.width = "100%";
                doc.documentElement.style.height = "100%";
                doc.body.style.margin = "0";
                doc.body.style.width = "100%";
                doc.body.style.height = "100%";
                doc.body.style.background = "#1a1c2c";
                doc.body.style.overflow = "hidden";

                const mount = doc.createElement("div");
                mount.id = mountId;
                mount.style.width = "100%";
                mount.style.height = "100%";
                mount.style.position = "relative";
                doc.body.appendChild(mount);

                // on boot, set keyboard focus to the iframe window
                // so the browser knows we want high-performance mode.
                // see #56
                win.focus();

                setFrameDoc(doc);
                setFrameWin(win);
            };

            iframe.addEventListener("load", onLoad);
            // Trigger load path even if already complete
            if (iframe.contentDocument?.readyState === "complete") onLoad();

            return () => iframe.removeEventListener("load", onLoad);
        }, [mountId]);

        useEffect(() => {
            if (!hasStarted) return;
            if (!frameDoc || !frameWin) return;
            if (!canvasRef.current) return;
            if (injectedRef.current) return;

            console.log("[tic80 iframe] injecting Module", (frameWin as any).Module, canvasRef.current, args);
            (frameWin as any).Module = {
                canvas: canvasRef.current,
                arguments: args,
            };
            const script = frameDoc.createElement("script");
            script.type = "text/javascript";
            script.src = "./tic80.js";
            frameDoc.head.appendChild(script);

            injectedRef.current = true;
        }, [frameDoc, frameWin, hasStarted, args]);

        const portalTarget = frameDoc?.getElementById(mountId) ?? null;

        const handleStartClick = () => {
            setHasStarted(true);
            if (frameWin) {
                frameWin.focus();
            }
        };

        return (
            <div style={{ position: "relative", width: "100%", height: "100%" }}>
                <iframe
                    ref={iframeRef}
                    style={{ width: "100%", height: "100%", border: 0, display: "block" }}
                    sandbox="allow-scripts allow-same-origin"
                    // more attempt to hint to the browser that this needs high-performance mode #56
                    allow="autoplay; fullscreen; gamepad"
                />
                {portalTarget &&
                    createPortal(
                        <canvas
                            ref={canvasRef}
                            id="canvas"
                            style={{ width: "100%", height: "100%", display: "block", imageRendering: "pixelated" }}
                            onContextMenu={(e) => e.preventDefault()}
                            onMouseDown={() => frameWin?.focus()}
                        />,
                        portalTarget
                    )}
                {!hasStarted && (
                    <button
                        type="button"
                        onClick={handleStartClick}
                        style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "rgba(0, 0, 0, 0.6)",
                            color: "white",
                            border: "none",
                            cursor: "pointer",
                            fontSize: "16px",
                        }}
                    >
                        Click to start the audio engine
                    </button>
                )}
            </div>
        );
    }
);
