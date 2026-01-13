import { Song } from "../../models/song";
import { kSubsystem, SubsystemTypeKey } from "../base/SubsystemBackendBase";
import { SomaticSubsystemFrontend } from "../base/SubsystemFrontendBase";


export class AmigaModSubsystemFrontend implements SomaticSubsystemFrontend<Song> {
    subsystemType: SubsystemTypeKey = kSubsystem.key.AMIGAMOD;

    renderSubsystemIcon() {
        return <div style={{ width: 16, height: 16, backgroundColor: "#ff6666", borderRadius: 2, display: "inline-block" }}>
            MOD
        </div>;
    }
}
