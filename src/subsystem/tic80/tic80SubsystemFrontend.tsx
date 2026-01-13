import { Song } from "../../models/song";
import { kSubsystem, SubsystemTypeKey } from "../base/SubsystemBackendBase";
import { SomaticSubsystemFrontend } from "../base/SubsystemFrontendBase";


export class Tic80SubsystemFrontend implements SomaticSubsystemFrontend<Song> {
    subsystemType: SubsystemTypeKey = kSubsystem.key.TIC80;

    renderSubsystemIcon() {
        return <div style={{ width: 16, height: 16, backgroundColor: "#ff6666", borderRadius: 2, display: "inline-block" }}>
            TIC-80
        </div>;
    }
}
