import React from "react";


export const ButtonGroup: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => {
    return (
        <div className={`somatic-button-group ${className || ""}`}>
            {children}
        </div>
    );
};
