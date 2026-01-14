import {buildInfo} from "../buildInfo";

export type BuildInfoLike = {
   gitTag: string|null; commitsSinceTag: number | null; dirty: boolean | null;
   commitHash?: string | null;
   buildDate?: string;
   lastCommitDate?: string | null;
};

// Version tag is like:
// - v1
// - v1+290
// - v1+290(!)
// - unknown
export function getBuildVersionTag(info: BuildInfoLike): string {
   if (!info.gitTag)
      return "unknown";

   let str = String(info.gitTag);
   if (info.commitsSinceTag && info.commitsSinceTag > 0) {
      str += `+${info.commitsSinceTag}`;
   }
   if (info.dirty) {
      str += "(!)";
   }
   return str;
}

// Hash input / display string.
// Example: "Somatic v1+290(!)"
export function getSomaticVersionString(info: BuildInfoLike): string {
   return `Somatic ${getBuildVersionTag(info)}`;
}

// Example: "Somatic v1+290(!) (abcdef1234)"
export function getSomaticVersionAndCommitString(): string {
   return `Somatic ${getBuildVersionTag(buildInfo)} (${buildInfo.commitHash ?? "unknown"})`;
}
