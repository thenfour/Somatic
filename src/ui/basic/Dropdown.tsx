import React from 'react';
import { DesktopMenu } from '../DesktopMenu/DesktopMenu';
import './Dropdown.css';

export type DropdownOption<TValue> = {
    value: TValue;
    compareKey?: string | number; // for objects, use this key to compare equality
    label: React.ReactNode;
    disabled?: boolean;
    shortcut?: string;
};

export type DropdownProps<TValue> = {
    value: TValue | null;
    onChange: (value: TValue) => void;
    options: DropdownOption<TValue>[];
    placeholder?: React.ReactNode;
    renderTriggerLabel?: (option: DropdownOption<TValue> | null, defaultRenderer: () => React.ReactNode) => React.ReactNode;
    triggerClassName?: string;
    contentClassName?: string;
    disabled?: boolean;
    showCheckmark?: boolean;
    showCaret?: boolean;
};

export function Dropdown<TValue>(props: DropdownProps<TValue>): JSX.Element {
    const {
        value,
        onChange,
        options,
        placeholder,
        renderTriggerLabel,
        triggerClassName,
        contentClassName,
        disabled,
        showCheckmark = true,
        showCaret = true,
    } = props;

    // compare options, using compareKey if available
    const areEqual = (a: DropdownOption<TValue> | null, b: DropdownOption<TValue> | null) => {
        if (a === null || b === null) {
            return a === b;
        }
        if (a.compareKey !== undefined && b.compareKey !== undefined) {
            return a.compareKey === b.compareKey;
        }
        return Object.is(a.value, b.value);
    };

    const selectedOption = React.useMemo(() => {
        if (value === null) return null;
        return options.find((opt) => areEqual(opt, { value } as DropdownOption<TValue>)) ?? null;
        //return options.find((opt) => Object.is(opt.value, value)) ?? null;
    }, [options, value]);

    const triggerLabel = React.useMemo(() => {
        const defaultRenderer = () => {
            if (selectedOption) return selectedOption.label;
            if (placeholder !== undefined) return placeholder;
            return 'Select';
        }
        if (renderTriggerLabel) {
            return renderTriggerLabel(selectedOption, defaultRenderer);
        }
        return defaultRenderer();
    }, [placeholder, renderTriggerLabel, selectedOption]);

    return (
        <DesktopMenu.Root>
            <DesktopMenu.Trigger
                className={triggerClassName}
                disabled={disabled}
                caret={showCaret}
            >
                {triggerLabel}
            </DesktopMenu.Trigger>
            <DesktopMenu.Content
                className={['dropdown-menu', contentClassName].filter(Boolean).join(' ')}
            >
                {options.map((option, idx) => {
                    const isSelected = areEqual(selectedOption, option); //selectedOption === option;
                    return (
                        <DesktopMenu.Item
                            key={idx}
                            checked={showCheckmark && isSelected}
                            disabled={disabled || option.disabled}
                            shortcut={option.shortcut}
                            onSelect={() => {
                                if (option.disabled || disabled) return;
                                onChange(option.value);
                            }}
                        >
                            {option.label}
                        </DesktopMenu.Item>
                    );
                })}
            </DesktopMenu.Content>
        </DesktopMenu.Root>
    );
}
