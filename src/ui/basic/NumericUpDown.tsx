import React from "react";
import { ButtonGroup } from "../Buttons/ButtonGroup";
import { Button } from "../Buttons/PushButton";
import { CharMap } from "../../utils/utils";

import "./NumericUpDown.css";
import { IconButton } from "../Buttons/IconButton";
import { mdiMenuLeft, mdiMenuRight } from "@mdi/js";

interface IntegerUpDownProps {
    value: number;
    onChange: (newValue: number) => void;
    min: number;
    max: number;
    disabled?: boolean;
};

// allows typing intermediate invalid values (free text); highlights when invalid.
export const IntegerUpDown: React.FC<IntegerUpDownProps> = (props) => {
    const [inputValue, setInputValue] = React.useState<string>(props.value.toString());

    React.useEffect(() => {
        setInputValue(props.value.toString());
    }, [props.value]);

    const handleNewIntegerValue = (newValue: number) => {
        if (newValue < props.min || newValue > props.max) return;
        setInputValue(newValue.toString());
        props.onChange(newValue);
    };

    const isValidValue = (val: any): boolean => {
        // try parse it, if it's non-integral or out of range, return false
        const parsed = parseInt(val, 10);
        if (isNaN(parsed)) return false;
        return val >= props.min && val <= props.max;
    };

    const handleNewTextInput = (newText: string) => {
        setInputValue(newText);
        const parsed = parseInt(newText, 10);
        if (isValidValue(parsed)) {
            props.onChange(parsed);
        }
    };

    const applyStep = (delta: number) => {
        if (props.disabled) return;
        // apply step to current prop value (committed value), not input value
        handleNewIntegerValue(Math.min(props.max, Math.max(props.min, props.value + delta)));
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (props.disabled) return;

        if (e.ctrlKey || e.metaKey || e.altKey) {
            return;
        }

        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                applyStep(1);
                return;
            case 'ArrowDown':
                e.preventDefault();
                applyStep(-1);
                return;
            case 'PageUp':
                e.preventDefault();
                applyStep(10);
                return;
            case 'PageDown':
                e.preventDefault();
                applyStep(-10);
                return;
            case 'Home':
                e.preventDefault();
                handleNewIntegerValue(props.min);
                return;
            case 'End':
                e.preventDefault();
                handleNewIntegerValue(props.max);
                return;
            default:
                return;
        }
    };

    const classes = ['integer-up-down'];
    if (!isValidValue(inputValue)) {
        classes.push('integer-up-down--invalid');
    }
    if (props.disabled) {
        classes.push('integer-up-down--disabled');
    }

    return <div className={classes.join(' ')}>
        <ButtonGroup>
            <input
                type="text"
                className="integer-up-down__input"
                disabled={props.disabled}
                value={inputValue}
                onChange={(e) => handleNewTextInput(e.target.value)}
                onKeyDown={onKeyDown}
                inputMode="numeric"
            />
            <IconButton
                onClick={() => handleNewIntegerValue(props.value - 1)}
                disabled={(props.value <= props.min) || props.disabled}
            >{CharMap.LeftTriangle}</IconButton>
            <IconButton
                onClick={() => handleNewIntegerValue(props.value + 1)}
                disabled={(props.value >= props.max) || props.disabled}
            >{CharMap.RightTriangle}</IconButton>
        </ButtonGroup>
    </div>;
}