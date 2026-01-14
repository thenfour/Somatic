// only renders children when in debug mode
import React from 'react';

import { useDebugMode } from '../../hooks/useDebugMode';

export const DebugContainer: React.FC<{ children: React.ReactNode; fallback?: React.ReactNode }> = ({ children, fallback = null }) => {
    const { debugMode } = useDebugMode();
    if (!debugMode) return <>{fallback}</>;
    return <>{children}</>;
};
