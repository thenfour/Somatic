import React from "react";


export const TransportTime: React.FC<{ positionSeconds: number, className?: string }> = ({ positionSeconds, className }) => {
    const minutes = Math.floor(positionSeconds / 60);
    const seconds = Math.floor(positionSeconds % 60);
    //const centiseconds = Math.floor((positionSeconds * 100) % 100);
    return <span className={`transportTime ${className ?? ''}`}>
        {minutes}:{seconds.toString().padStart(2, '0')}
    </span>;
}