// Tic80Iframe.tsx
"use client";

import React, {
    forwardRef,
    useEffect,
    useMemo,
    useImperativeHandle,
    useRef,
    useState,
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
    className?: string;
    style?: React.CSSProperties;
};

export const Tic80Iframe = forwardRef<Tic80IframeHandle, Tic80IframeProps>(
    function Tic80Iframe({ args = [], className, style }, ref) {
        const iframeRef = useRef<HTMLIFrameElement | null>(null);
        const canvasRef = useRef<HTMLCanvasElement | null>(null);
        const injectedRef = useRef(false);

        const [frameDoc, setFrameDoc] = useState<Document | null>(null);
        const [frameWin, setFrameWin] = useState<Window | null>(null);

        const mountId = useMemo(() => "tic80-iframe-root", []);

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

                setFrameDoc(doc);
                setFrameWin(win);
            };

            iframe.addEventListener("load", onLoad);
            // Trigger load path even if already complete
            if (iframe.contentDocument?.readyState === "complete") onLoad();

            return () => iframe.removeEventListener("load", onLoad);
        }, [mountId]);

        useEffect(() => {
            if (!frameDoc || !frameWin) return;
            if (!canvasRef.current) return;
            if (injectedRef.current) return;

            (frameWin as any).Module = {
                canvas: canvasRef.current,
                arguments: args,
            };

            const script = frameDoc.createElement("script");
            script.type = "text/javascript";
            script.src = "/tic80.js";
            frameDoc.head.appendChild(script);

            injectedRef.current = true;
        }, [frameDoc, frameWin]);

        const portalTarget = frameDoc?.getElementById(mountId) ?? null;

        return (
            <>
                <iframe
                    ref={iframeRef}
                    className={className}
                    style={{ width: "100%", height: "100%", border: 0, display: "block", ...style }}
                    sandbox="allow-scripts allow-same-origin"
                />
                {portalTarget &&
                    createPortal(
                        <canvas
                            ref={canvasRef}
                            style={{ width: "100%", height: "100%", display: "block", imageRendering: "pixelated" }}
                            onContextMenu={(e) => e.preventDefault()}
                            onMouseDown={() => frameWin?.focus()}
                        />,
                        portalTarget
                    )}
            </>
        );
    }
);
