import React from "react";


export const TransportTime: React.FC<{ positionSeconds: number, className?: string }> = ({ positionSeconds, className }) => {
    const minutes = Math.floor(positionSeconds / 60);
    const seconds = Math.floor(positionSeconds % 60);
    const milliseconds = Math.floor((positionSeconds * 1000) % 1000);
    return <span className={`transportTime ${className ?? ''}`}>
        {minutes}:{seconds.toString().padStart(2, '0')}<span className="transportTime__ms">.{milliseconds.toString().padStart(3, '0')}</span>
    </span>;
}