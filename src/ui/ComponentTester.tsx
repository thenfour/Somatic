import React from "react";
import { Knob } from "./basic/Knob2";
import { RadioButton } from "./Buttons/RadioButton";
import { ButtonGroup } from "./Buttons/ButtonGroup";
import { ButtonBase } from "./Buttons/ButtonBase";
import { useToasts } from "./toast_provider";
import { Divider } from "./basic/Divider";
import { IconButton } from "./Buttons/IconButton";
import { mdiClipboard, mdiNetwork, mdiSettingsHelper, mdiTree } from "@mdi/js";
import { CheckboxButton } from "./Buttons/CheckboxButton";
import { MemoryMapVis } from "./MemoryMapVis";
import { MemoryRegion } from "../utils/bitpack/MemoryRegion";
import { DurationKnob } from "./basic/oldknob";

export const ComponentTester: React.FC = () => {
    const [knobValue, setKnobValue] = React.useState(0.5);
    const [radio1Selected, setRadio1Selected] = React.useState(true);
    const [radio2Selected, setRadio2Selected] = React.useState(true);
    const [radio3Selected, setRadio3Selected] = React.useState(true);

    const [secondsValue, setSecondsValue] = React.useState(1.0);
    const [intKnobValue, setIntKnobValue] = React.useState(10);
    const [boolKnobValue, setBoolKnobValue] = React.useState(true);

    const toasts = useToasts();

    return (
        <div style={{ padding: 10 }}>
            <h3>Component Tester</h3>
            <div style={{ marginBottom: 20 }}>
                <ButtonGroup>
                    <Knob
                        value={knobValue}
                        label="Knob test"
                        onChange={(v) => {
                            setKnobValue(v);
                        }}
                    />
                    <DurationKnob
                        value={secondsValue}
                        label="Duration(weird)"
                        onChange={(v) => {
                            setSecondsValue(v);
                        }}
                        max={10}
                        min={5}
                        centerValue={8}
                        defaultValue={6}
                    />
                    <DurationKnob
                        value={secondsValue}
                        label="Duration(common)"
                        onChange={(v) => {
                            setSecondsValue(v);
                        }}
                        max={10}
                        min={0}
                        centerValue={5}
                        defaultValue={5}
                    />
                </ButtonGroup>
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
                <div style={{ marginBottom: 8 }}>
                    <div style={{ marginBottom: 4 }}>Horizontal (default)</div>
                    <ButtonGroup>
                        <ButtonBase onClick={() => toasts.pushToast("Group Button 1 clicked")}>Group Button 1</ButtonBase>
                        <ButtonBase onClick={() => toasts.pushToast("Group Button 2 clicked")} disabled>Disabled</ButtonBase>
                        <ButtonBase onClick={() => toasts.pushToast("Group Button 3 clicked")}>Group Button 3</ButtonBase>
                    </ButtonGroup>
                </div>

                <div>
                    <div style={{ marginBottom: 4 }}>Vertical</div>
                    <ButtonGroup orientation="vertical">
                        <ButtonBase onClick={() => toasts.pushToast("V Group Button 1 clicked")}>Group Button 1</ButtonBase>
                        <ButtonBase onClick={() => toasts.pushToast("V Group Button 2 clicked")} disabled>Disabled</ButtonBase>
                        <ButtonBase onClick={() => toasts.pushToast("V Group Button 3 clicked")}>Group Button 3</ButtonBase>
                    </ButtonGroup>
                </div>

                <div style={{ marginTop: 12 }}>
                    <div style={{ marginBottom: 4 }}>Border priority (enabled should win)</div>
                    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                        <div>
                            <div style={{ marginBottom: 4 }}>Horizontal</div>
                            <ButtonGroup>
                                <ButtonBase>Enabled</ButtonBase>
                                <ButtonBase disabled>Disabled</ButtonBase>
                                <ButtonBase>Enabled</ButtonBase>
                                <ButtonBase disabled>Disabled</ButtonBase>
                                <ButtonBase disabled>Disabled</ButtonBase>
                            </ButtonGroup>
                        </div>

                        <div>
                            <div style={{ marginBottom: 4 }}>Vertical</div>
                            <ButtonGroup orientation="vertical">
                                <ButtonBase>Enabled</ButtonBase>
                                <ButtonBase disabled>Disabled</ButtonBase>
                                <ButtonBase>Enabled</ButtonBase>
                                <ButtonBase disabled>Disabled</ButtonBase>
                                <ButtonBase disabled>Disabled</ButtonBase>
                            </ButtonGroup>
                        </div>
                    </div>
                </div>
            </div>
            {/* button groups with dividers */}
            <div>
                <h4>Button Groups with Dividers</h4>
                <div style={{ marginBottom: 8 }}>
                    <div style={{ marginBottom: 4 }}>Horizontal (default)</div>
                    <ButtonGroup>
                        <ButtonBase onClick={() => toasts.pushToast("Group Button A clicked")}>Group Button A</ButtonBase>
                        <ButtonBase onClick={() => toasts.pushToast("Group Button B clicked")} disabled>Disabled</ButtonBase>
                        <ButtonBase onClick={() => toasts.pushToast("Group Button A clicked")}>A</ButtonBase>
                        <Divider />
                        <ButtonBase onClick={() => toasts.pushToast("Group Button B clicked")} disabled>Disb after divid</ButtonBase>
                        <ButtonBase onClick={() => toasts.pushToast("Group Button C clicked")}>C</ButtonBase>
                        <ButtonBase onClick={() => toasts.pushToast("Group Button B clicked")} disabled>Disb befor divid</ButtonBase>
                        <Divider />
                        <ButtonBase onClick={() => toasts.pushToast("Group Button A clicked")}>Button A</ButtonBase>
                        <ButtonBase onClick={() => toasts.pushToast("Group Button A clicked")}>Button A</ButtonBase>
                        <Divider />
                        <ButtonBase onClick={() => toasts.pushToast("Group Button A clicked")}>A</ButtonBase>
                        <ButtonBase onClick={() => toasts.pushToast("Group Button A clicked")}>Button A</ButtonBase>
                    </ButtonGroup>
                </div>

                <div>
                    <div style={{ marginBottom: 4 }}>Vertical</div>
                    <ButtonGroup orientation="vertical">
                        <ButtonBase onClick={() => toasts.pushToast("V Group Button A clicked")}>Group Button A</ButtonBase>
                        <ButtonBase onClick={() => toasts.pushToast("V Group Button B clicked")} disabled>Disabled</ButtonBase>
                        <ButtonBase onClick={() => toasts.pushToast("V Group Button A clicked")}>A</ButtonBase>
                        <Divider />
                        <ButtonBase onClick={() => toasts.pushToast("V Group Button B clicked")} disabled>Disabled</ButtonBase>
                        <ButtonBase onClick={() => toasts.pushToast("V Group Button C clicked")}>Button C</ButtonBase>
                        <ButtonBase onClick={() => toasts.pushToast("V Group Button B clicked")} disabled>Disabled</ButtonBase>
                        <Divider />
                        <ButtonBase onClick={() => toasts.pushToast("V Group Button A clicked")}>A</ButtonBase>
                        <ButtonBase onClick={() => toasts.pushToast("V Group Button A clicked")}>A</ButtonBase>
                        <Divider />
                        <ButtonBase onClick={() => toasts.pushToast("V Group Button A clicked")}>A</ButtonBase>
                        <ButtonBase onClick={() => toasts.pushToast("V Group Button A clicked")}>A</ButtonBase>
                    </ButtonGroup>
                </div>
            </div>
            {/* icon buttons */}
            <div>
                <h4>Icon Buttons</h4>
                <ButtonGroup>
                    <IconButton
                        highlighted={radio1Selected}
                        tabIndex={0}
                        data-focus-bookmark="true"
                        onClick={() => setRadio1Selected(x => !x)} iconPath={mdiNetwork}>
                    </IconButton>
                    <IconButton
                        highlighted={radio2Selected}
                        tabIndex={0}
                        data-focus-bookmark="true"
                        onClick={() => setRadio2Selected(x => !x)} iconPath={mdiClipboard}>
                    </IconButton>
                    <IconButton
                        highlighted={radio3Selected}
                        tabIndex={0}
                        data-focus-bookmark="true"
                        onClick={() => setRadio3Selected(x => !x)} iconPath={mdiTree}>
                        with label
                    </IconButton>
                </ButtonGroup>
            </div>
            {/* checkbox drop-in replacement */}
            <div>
                <h4>Checkbox Button</h4>
                <ButtonGroup>
                    <CheckboxButton checked={radio1Selected} onChange={() => setRadio1Selected(x => !x)}>Checkbox 1</CheckboxButton>
                    <CheckboxButton checked={radio2Selected} onChange={() => setRadio2Selected(x => !x)}>
                        Checkbox 2
                    </CheckboxButton>
                    <CheckboxButton checked={radio3Selected} onChange={() => setRadio3Selected(x => !x)}>
                        Checkbox 3
                    </CheckboxButton>
                </ButtonGroup>
            </div>
            {/* todo: dropdowns, integer updown, desktop menu */}
            <div>
                <h4>Memory map & color bars</h4>
                <MemoryMapVis
                    root={new MemoryRegion({
                        address: 100,
                        size: 500,
                        name: "Example memory region",
                        hashKey: "root",
                    })}
                    regions={[
                        new MemoryRegion({
                            address: 100,
                            size: 79,
                            name: "Region 1",
                            hashKey: "region1",
                        }),
                        new MemoryRegion({
                            address: 200,
                            size: 150,
                            name: "Region 2",
                            hashKey: "region2",
                        }),
                        new MemoryRegion({
                            address: 350,
                            size: 150,
                            name: "Region 3",
                            hashKey: "region3",
                        }),
                    ]}
                />
            </div>
        </div>
    );
}