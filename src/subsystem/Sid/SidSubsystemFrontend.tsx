import { Song } from "../../models/song";
import { kSubsystem, SubsystemTypeKey } from "../base/SubsystemBackendBase";
import { SomaticSubsystemFrontend } from "../base/SubsystemFrontendBase";


export class SidSubsystemFrontend implements SomaticSubsystemFrontend<Song> {
    subsystemType: SubsystemTypeKey = kSubsystem.key.SID;

    renderSubsystemIcon() {
        return <div style={{ width: 16, height: 16, backgroundColor: "#ff6666", borderRadius: 2, display: "inline-block" }}>
            SID
        </div>;
    }
}
