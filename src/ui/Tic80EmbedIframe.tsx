// Tic80Iframe.tsx
"use client";

import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
} from "react";

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
                const win = iframe.contentWindow;
                if (!win) return;
                win.focus();
            };

            iframe.addEventListener("load", onLoad);
            // Trigger load path even if already complete
            if (iframe.contentDocument?.readyState === "complete") onLoad();

            return () => iframe.removeEventListener("load", onLoad);
        }, []);

        return (
            <div style={{ position: "relative", width: "100%", height: "100%" }}>
                <iframe
                    ref={iframeRef}
                    src="./tic80-iframe-shell.html"
                    style={{ width: "100%", height: "100%", border: 0, display: "block" }}
                    sandbox="allow-scripts allow-same-origin"
                    // more attempt to hint to the browser that this needs high-performance mode #56
                    allow="autoplay; fullscreen; gamepad"
                />
            </div>
        );
    }
);
