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

    const handleNewTextInput = (newText: string) => {
        setInputValue(newText);
        const parsed = parseInt(newText, 10);
        if (!isNaN(parsed) && parsed >= props.min && parsed <= props.max) {
            props.onChange(parsed);
        }
    };

    const classes = ['integer-up-down'];
    if (isNaN(parseInt(inputValue, 10)) || parseInt(inputValue, 10) < props.min || parseInt(inputValue, 10) > props.max) {
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