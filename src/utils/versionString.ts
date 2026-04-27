import {buildInfo} from "../buildInfo";

export type BuildInfoLike = {
   appVersion: string;
   dirty: boolean | null;
   commitHash?: string | null;
   buildDate?: string;
   lastCommitDate?: string | null;
};

export function getSomaticVersionTag(info: BuildInfoLike): string {
   return `v${info.appVersion}`;
}

// Hash input / display string.
// Example: "Somatic v1.0.10"
export function getSomaticVersionString(info: BuildInfoLike): string {
   return `Somatic ${getSomaticVersionTag(info)}`;
}

// Example: "Somatic v1.0.10 (abcdef1234)"
export function getSomaticVersionAndCommitString(): string {
   return `Somatic ${getSomaticVersionTag(buildInfo)} (${buildInfo.commitHash ?? "unknown"})`;
}
