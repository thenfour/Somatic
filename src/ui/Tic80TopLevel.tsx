// import {
//     forwardRef,
//     useEffect,
//     useImperativeHandle,
//     useRef,
//     useState,
// } from "react";

// declare global {
//     interface Window {
//         Module?: any;
//     }
// }

// export type Tic80TopLevelHandle = {
//     getWindow: () => Window | null;
//     getDocument: () => Document | null;
// };

// export type Tic80TopLevelProps = {
//     args?: string[];    // e.g. ["/bridge.tic"]
// };

// export const Tic80TopLevel = forwardRef<Tic80TopLevelHandle, Tic80TopLevelProps>(
//     function Tic80TopLevel({ args = [] }, ref) {
//         const canvasRef = useRef<HTMLCanvasElement | null>(null);
//         const [hasStarted, setHasStarted] = useState(false);

//         useImperativeHandle(
//             ref,
//             () => ({
//                 getWindow: () => (typeof window !== "undefined" ? window : null),
//                 getDocument: () => (typeof document !== "undefined" ? document : null),
//             }),
//             []
//         );

//         useEffect(() => {
//             if (typeof window !== "undefined") {
//                 window.focus();
//             }
//         }, []);

//         const handleStartClick = () => {
//             if (!canvasRef.current) {
//                 // canvas not mounted yet
//                 return;
//             }

//             if (hasStarted) {
//                 return;
//             }

//             setHasStarted(true);

//             if (typeof window !== "undefined") {
//                 window.focus();
//             }

//             const canvas = canvasRef.current;
//             (window as any).Module = {
//                 canvas,
//                 arguments: args,
//             };

//             const script = document.createElement("script");
//             script.type = "text/javascript";
//             script.src = "./tic80.js";

//             document.head.appendChild(script);
//         };

//         // auto-start
//         useEffect(() => {
//             handleStartClick();
//         }, []);

//         // Contain TIC-80's global keyboard handling (e.g. F6) so that
//         // it only reacts when the TIC canvas is focused.
//         useEffect(() => {
//             if (typeof document === "undefined") return;

//             const handler = (e: KeyboardEvent) => {
//                 const canvas = canvasRef.current;
//                 if (!canvas) return;

//                 // Tic80 latches on to the document's input handling and causes conflicts.
//                 // here we try to patch those behaviors one-by-one. not ideal; see #56

//                 let killWithFire = false;

//                 const isFunctionKey = (n: number) => {
//                     return e.key === `F${n}` || e.code === `F${n}` || (e as any).which === (111 + n);
//                 };

//                 if (isFunctionKey(1) || isFunctionKey(2) || isFunctionKey(3) || isFunctionKey(4)) {
//                     killWithFire = true;
//                 }

//                 if (isFunctionKey(5) || isFunctionKey(6) || isFunctionKey(7) || isFunctionKey(8)) {
//                     killWithFire = true;
//                 }

//                 if (isFunctionKey(9) || isFunctionKey(10) || isFunctionKey(11) || isFunctionKey(12)) {
//                     killWithFire = true;
//                 }

//                 if (!killWithFire) {
//                     return;
//                 }

//                 const active = document.activeElement as HTMLElement | null;
//                 const isCanvasActive = active === canvas || !!(active && canvas.contains(active));

//                 if (!isCanvasActive) {
//                     e.stopImmediatePropagation();
//                 }
//             };

//             document.addEventListener("keydown", handler, true);
//             return () => {
//                 document.removeEventListener("keydown", handler, true);
//             };
//         }, []);

//         return (
//             <div
//                 className="game"
//                 tabIndex={0}
//                 style={{
//                     position: "relative",
//                     width: "100%",
//                     height: "100%",
//                     margin: 0,
//                     background: "#1a1c2c",
//                 }}
//             >
//                 {!hasStarted && (
//                     <div
//                         id="game-frame"
//                         onClick={handleStartClick}
//                         style={{
//                             cursor: "pointer",
//                             position: "absolute",
//                             margin: "0 auto",
//                             opacity: 1,
//                             background: "#1a1c2c",
//                             width: "100%",
//                             height: "100%",
//                             display: "flex",
//                             justifyContent: "center",
//                             alignItems: "center",
//                             color: "white",
//                             fontFamily: "monospace",
//                             fontWeight: "bold",
//                             fontSize: 44,
//                         }}
//                     >
//                         <p style={{ margin: 0 }}>Click to boot</p>
//                     </div>
//                 )}

//                 <canvas
//                     ref={canvasRef}
//                     tabIndex={0}
//                     id="canvas"
//                     style={{
//                         width: "100%",
//                         height: "100%",
//                         margin: "0 auto",
//                         display: "block",
//                         imageRendering: "pixelated",
//                     }}
//                     onContextMenu={(e) => e.preventDefault()}
//                     onMouseDown={() => {
//                         if (typeof window !== "undefined") window.focus();
//                     }}
//                 />
//             </div>
//         );
//     }
// );
