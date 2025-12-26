import React from 'react';
import { formatRelativeToNow } from '../../utils/utils';

// displays a date value in a human-readable format, together with relative to now
export const DateValue: React.FC<{ value: Date }> = ({ value }) => {
    const absolute = value.toLocaleString();
    const relative = formatRelativeToNow(value);

    return (
        <div className="date-value">
            <span className="date-value__absolute">{absolute}</span>
            {relative && (
                <span className="date-value__relative"> ({relative})</span>
            )}
        </div>
    );
};

