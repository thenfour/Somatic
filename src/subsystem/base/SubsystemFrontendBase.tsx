import { SubsystemTypeKey } from "./SubsystemBackendBase";

export interface SomaticSubsystemFrontend<TSong> {
    subsystemType: SubsystemTypeKey;

    renderSubsystemIcon(): React.ReactNode;
}
