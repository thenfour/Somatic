import React from "react";
import { Knob } from "./basic/Knob2";
import { RadioButton } from "./Buttons/RadioButton";
import { ButtonGroup } from "./Buttons/ButtonGroup";
import { ButtonBase } from "./Buttons/ButtonBase";
import { useToasts } from "./toast_provider";
import { Divider } from "./basic/Divider";
import { IconButton } from "./Buttons/IconButton";
import { mdiClipboard, mdiNetwork, mdiSettingsHelper, mdiTree } from "@mdi/js";

export const ComponentTester: React.FC = () => {
    const [knobValue, setKnobValue] = React.useState(0.5);
    const [radio1Selected, setRadio1Selected] = React.useState(true);
    const [radio2Selected, setRadio2Selected] = React.useState(true);
    const [radio3Selected, setRadio3Selected] = React.useState(true);
    const toasts = useToasts();

    return (
        <div style={{ padding: 10 }}>
            <h3>Component Tester</h3>
            <div style={{ marginBottom: 20 }}>
                <Knob
                    value={knobValue}
                    label="Knob test"
                    onChange={(v) => {
                        setKnobValue(v);
                    }}
                />
            </div>
            <div>
                <label>RadioButton Test:</label>
                <ButtonGroup>
                    <RadioButton
                        selected={radio1Selected}
                        onClick={() => setRadio1Selected(x => !x)}
                    >
                        Option 1
                    </RadioButton>
                    <RadioButton
                        selected={radio2Selected}
                        onClick={() => setRadio2Selected(x => !x)}
                    >
                        Option 2
                    </RadioButton>
                    <RadioButton
                        selected={radio3Selected}
                        onClick={() => setRadio3Selected(x => !x)}
                    >
                        Option 3
                    </RadioButton>
                    <RadioButton
                        selected={radio3Selected}
                        disabled
                        onClick={() => setRadio3Selected(x => !x)}
                    >
                        Option 4 (disabled)
                    </RadioButton>
                </ButtonGroup>
            </div>
            {/* freestanding buttons */}
            <div>
                <h4>Freestanding Buttons vertical</h4>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <ButtonBase onClick={() => toasts.pushToast("Button 1 clicked")}>Button 1</ButtonBase>
                    <ButtonBase onClick={() => toasts.pushToast("Button 2 clicked")}>Button 2</ButtonBase>
                    <ButtonBase onClick={() => toasts.pushToast("Button 3 clicked")}>Button 3</ButtonBase>
                </div>
                <h4>Freestanding Buttons horizontal</h4>
                <div style={{ display: 'flex', flexDirection: 'row' }}>
                    <ButtonBase onClick={() => toasts.pushToast("Button A clicked")}>Button A</ButtonBase>
                    <ButtonBase onClick={() => toasts.pushToast("Button B clicked")} disabled>Disabled</ButtonBase>
                    <ButtonBase onClick={() => toasts.pushToast("Button C clicked")}>Button C</ButtonBase>
                </div>
            </div>
            <div>
                <h4>Button Groups</h4>
                <ButtonGroup>
                    <ButtonBase onClick={() => toasts.pushToast("Group Button 1 clicked")}>Group Button 1</ButtonBase>
                    <ButtonBase onClick={() => toasts.pushToast("Group Button 2 clicked")} disabled>Disabled</ButtonBase>
                    <ButtonBase onClick={() => toasts.pushToast("Group Button 3 clicked")}>Group Button 3</ButtonBase>
                </ButtonGroup>
            </div>
            {/* button groups with dividers */}
            <div>
                <h4>Button Groups with Dividers</h4>
                <ButtonGroup>
                    <ButtonBase onClick={() => toasts.pushToast("Group Button A clicked")}>Group Button A</ButtonBase>
                    <ButtonBase onClick={() => toasts.pushToast("Group Button B clicked")} disabled>Disabled</ButtonBase>
                    <Divider />
                    <ButtonBase onClick={() => toasts.pushToast("Group Button C clicked")}>Group Button C</ButtonBase>
                </ButtonGroup>
            </div>
            {/* icon buttons */}
            <div>
                <h4>Icon Buttons</h4>
                <ButtonGroup>
                    <IconButton highlighted={radio1Selected} tabIndex={0} onClick={() => setRadio1Selected(x => !x)} iconPath={mdiNetwork}>
                    </IconButton>
                    <IconButton highlighted={radio2Selected} tabIndex={0} onClick={() => setRadio2Selected(x => !x)} iconPath={mdiClipboard}>
                    </IconButton>
                    <IconButton highlighted={radio3Selected} tabIndex={0} onClick={() => setRadio3Selected(x => !x)} iconPath={mdiTree}>
                        with label
                    </IconButton>
                </ButtonGroup>
            </div>
        </div>
    );
}