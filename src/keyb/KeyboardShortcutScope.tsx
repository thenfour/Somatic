import React from "react";

// let components declare their active shortcut scopes
// <ShortcutScopeProvider scope="editor">
//   <Editor />
// </ShortcutScopeProvider>

const ScopesContext = React.createContext<string[]>(["global"]);

export function useActiveScopes(): string[] {
    return React.useContext(ScopesContext);
}

export function ShortcutScopeProvider(props: { scope: string; children: React.ReactNode }) {
    const parent = React.useContext(ScopesContext);
    const value = React.useMemo(() => [props.scope, ...parent], [props.scope, parent]);
    return <ScopesContext.Provider value={value}>{props.children}</ScopesContext.Provider>;
}