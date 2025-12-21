export type BuildInfo = {
   gitTag: string|null; //
   commitsSinceTag: number | null;
   dirty: boolean | null;
   buildDate: string;
   lastCommitDate: string | null;
   commitHash: string | null;
};

// BUILD_INFO is injected at bundle time via webpack.DefinePlugin.
// Declare it for TypeScript so we can use it safely in code.
declare const BUILD_INFO: BuildInfo|undefined;

const fallback: BuildInfo = {
   gitTag: "v0",
   commitsSinceTag: 0,
   dirty: true,
   buildDate: "2025-12-21T00:00:00Z",
   lastCommitDate: "2025-12-21T00:00:00Z",
   commitHash: "abcdef",
};

export const buildInfo: BuildInfo = (typeof BUILD_INFO === "undefined" ? fallback : BUILD_INFO);
