import React from 'react';
import { DesktopMenu } from '../DesktopMenu/DesktopMenu';
import './Dropdown.css';

export type DropdownOption<TValue> = {
    value: TValue;
    label: React.ReactNode;
    disabled?: boolean;
    shortcut?: string;
};

export type DropdownProps<TValue> = {
    value: TValue | null;
    onChange: (value: TValue) => void;
    options: DropdownOption<TValue>[];
    placeholder?: React.ReactNode;
    renderTriggerLabel?: (option: DropdownOption<TValue> | null) => React.ReactNode;
    triggerClassName?: string;
    contentClassName?: string;
    disabled?: boolean;
    showCheckmark?: boolean;
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
    } = props;

    const selectedOption = React.useMemo(() => {
        if (value === null) return null;
        return options.find((opt) => Object.is(opt.value, value)) ?? null;
    }, [options, value]);

    const triggerLabel = React.useMemo(() => {
        if (renderTriggerLabel) {
            return renderTriggerLabel(selectedOption);
        }
        if (selectedOption) return selectedOption.label;
        if (placeholder !== undefined) return placeholder;
        return 'Select';
    }, [placeholder, renderTriggerLabel, selectedOption]);

    return (
        <DesktopMenu.Root>
            <DesktopMenu.Trigger
                className={triggerClassName}
                disabled={disabled}
            >
                {triggerLabel}
            </DesktopMenu.Trigger>
            <DesktopMenu.Content
                className={['dropdown-menu', contentClassName].filter(Boolean).join(' ')}
            >
                {options.map((option, idx) => {
                    const isSelected = selectedOption === option;
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
