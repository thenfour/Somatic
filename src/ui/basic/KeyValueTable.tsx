import React from "react";
import { typedKeys } from "../../utils/utils";

type Primitive = string | number | boolean | null | undefined | bigint | symbol;

export type KeyValueRow = {
    path: string;           // e.g. "user.name" or "items[0].id"
    key: string;            // leaf key, e.g. "name" or "[0]"
    depth: number;          // 0 = root-level entry
    value: unknown;         // original value (not stringified)
    preview: string;        // human-friendly preview for UI
    isLeaf: boolean;        // true if we stopped (primitive or depth/cycle)
};

export type KeyValueTableProps = {
    value: unknown;                 // object (or anything) to render
    maxDepth?: number;              // how many levels deep to traverse
    includeRootRow?: boolean;       // show a single "(root)" row if value isn't an object
    sortKeys?: boolean;             // sort object keys (default true)
    maxArrayItems?: number;         // limit rows for big arrays
    maxStringLength?: number;       // truncate long strings in preview 
    className?: string;
    tableClassName?: string;        // optional extra hook
    rowClassName?: (row: KeyValueRow) => string | undefined;
    renderKey?: (row: KeyValueRow) => React.ReactNode;
    renderValue?: (row: KeyValueRow) => React.ReactNode;
};

function isPrimitive(v: unknown): v is Primitive {
    const t = typeof v;
    return (
        v === null ||
        v === undefined ||
        t === "string" ||
        t === "number" ||
        t === "boolean" ||
        t === "bigint" ||
        t === "symbol"
    );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, Math.max(0, max - 1)) + "...";
}

function previewValue(v: unknown, maxStringLength: number): string {
    if (React.isValidElement(v)) return '[ReactNode]';
    if (isPrimitive(v)) {
        if (typeof v === "string") return `"${truncate(v, maxStringLength)}"`;
        if (typeof v === "symbol") return v.toString();
        return String(v);
    }
    if (v instanceof Date) return `Date(${isNaN(v.getTime()) ? "Invalid" : v.toISOString()})`;
    if (v instanceof RegExp) return v.toString();
    if (v instanceof Map) return `Map(${v.size})`;
    if (v instanceof Set) return `Set(${v.size})`;
    if (Array.isArray(v)) return `Array(${v.length})`;
    if (typeof v === "function") return `function ${v.name || "(anonymous)"}`;
    if (typeof v === "object") return `Object`;
    return String(v);
}

function joinPath(parent: string, key: string): string {
    if (!parent) return key;
    // bracket if it looks like an array index or contains dots/spaces
    const needsBracket = key.startsWith("[") || /[.\s]/.test(key);
    if (key.startsWith("[")) return `${parent}${key}`;
    return needsBracket ? `${parent}[${JSON.stringify(key)}]` : `${parent}.${key}`;
}

export function flattenToKeyValueRows(
    value: unknown,
    opts?: {
        maxDepth?: number;
        includeRootRow?: boolean;
        sortKeys?: boolean;
        maxArrayItems?: number;
        maxStringLength?: number;
    }
): KeyValueRow[] {
    const {
        maxDepth = 2,
        includeRootRow = true,
        sortKeys = true,
        maxArrayItems = 50,
        maxStringLength = 200,
    } = opts ?? {};

    const rows: KeyValueRow[] = [];
    const seen = new WeakSet<object>();

    const pushRow = (path: string, key: string, depth: number, v: unknown, isLeaf: boolean) => {
        rows.push({
            path,
            key,
            depth,
            value: v,
            preview: previewValue(v, maxStringLength),
            isLeaf,
        });
    };

    const walk = (v: unknown, path: string, key: string, depth: number) => {
        // leaf conditions
        if (React.isValidElement(v) || isPrimitive(v) || v instanceof Date || v instanceof RegExp || typeof v === "function") {
            pushRow(path, key, depth, v, true);
            return;
        }

        if (typeof v === "object" && v !== null) {
            if (seen.has(v)) {
                pushRow(path, key, depth, v, true);
                // mark cycle more explicitly in preview
                rows[rows.length - 1]!.preview = "[Circular]";
                return;
            }
            seen.add(v);
        }

        const atLimit = depth >= maxDepth;
        if (atLimit) {
            pushRow(path, key, depth, v, true);
            return;
        }

        // expand
        if (Array.isArray(v)) {
            pushRow(path, key, depth, v, false);

            const count = Math.min(v.length, maxArrayItems);
            for (let i = 0; i < count; i++) {
                const childKey = `[${i}]`;
                const childPath = joinPath(path, childKey);
                walk(v[i], childPath, childKey, depth + 1);
            }
            if (v.length > count) {
                const childKey = `[... +${v.length - count}]`;
                const childPath = joinPath(path, childKey);
                pushRow(childPath, childKey, depth + 1, undefined, true);
                rows[rows.length - 1]!.preview = "(truncated)";
            }
            return;
        }

        if (isPlainObject(v)) {
            pushRow(path, key, depth, v, false);

            const keys = typedKeys(v);
            if (sortKeys) keys.sort((a, b) => a.localeCompare(b));
            for (const k of keys) {
                const childPath = joinPath(path, k);
                walk(v[k], childPath, k, depth + 1);
            }
            return;
        }

        // Map / Set / class instances: show as a leaf by default for simplicity
        pushRow(path, key, depth, v, true);
    };

    // Root handling
    if (!isPlainObject(value) && !Array.isArray(value)) {
        if (includeRootRow) {
            pushRow("(root)", "(root)", 0, value, true);
        }
        return rows;
    }

    // Root object/array: expand its direct children as top-level rows
    const root = value;
    if (Array.isArray(root)) {
        // show root summary row
        pushRow("(root)", "(root)", 0, root, false);
        const count = Math.min(root.length, maxArrayItems);
        for (let i = 0; i < count; i++) {
            const k = `[${i}]`;
            walk(root[i], k, k, 1);
        }
        return rows;
    }

    // object root
    const rootObj = root as Record<string, unknown>;
    const keys = typedKeys(rootObj);
    if (sortKeys) keys.sort((a, b) => a.localeCompare(b));
    for (const k of keys) {
        walk(rootObj[k], k, k, 0);
    }
    return rows;
}

export const KeyValueTable: React.FC<KeyValueTableProps> = ({
    value,
    maxDepth = 2,
    includeRootRow = true,
    sortKeys = true,
    maxArrayItems = 50,
    maxStringLength = 200,
    className,
    tableClassName,
    rowClassName,
    renderKey,
    renderValue,
}) => {
    const rows = React.useMemo(
        () =>
            flattenToKeyValueRows(value, {
                maxDepth,
                includeRootRow,
                sortKeys,
                maxArrayItems,
                maxStringLength,
            }),
        [value, maxDepth, includeRootRow, sortKeys, maxArrayItems, maxStringLength]
    );

    return (
        <div className={className}>
            <table className={tableClassName}>
                <thead>
                    <tr>
                        <th>Key</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.path} className={rowClassName?.(r)}>
                            <td>
                                {renderKey ? (
                                    renderKey(r)
                                ) : (
                                    <span
                                        data-depth={r.depth}
                                        data-leaf={r.isLeaf ? "1" : "0"}
                                        title={r.path}
                                        style={{ paddingLeft: r.depth * 12 }}
                                    >
                                        {r.key}
                                    </span>
                                )}
                            </td>
                            <td>
                                {renderValue ? (
                                    renderValue(r)
                                ) : React.isValidElement(r.value) ? (
                                    r.value
                                ) : (
                                    <span data-type={typeof r.value}>{r.preview}</span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};
