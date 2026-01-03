import * as luaparse from "luaparse";
import {AliasInfo, runAliasPass} from "./lua_alias_shared";
import {StringLiteralNode} from "./lua_utils";

// ============================================================================
// Expression Aliasing - Create local aliases for repeated expressions
// ============================================================================

// Configuration
const EXPR_ALIAS_PREFIX = "_"; // Prefix for generated alias names
const SAFE_GLOBAL_BASES = new Set(["math", "string", "table", "utf8", "bit", "bit32", "coroutine"]);
const SAFE_GLOBAL_FUNCS = new Set([
   // TIC-80 API (pure or stable references)
   "peek", "poke", "peek4", "poke4", "memcpy", "memset", "pmem", "mget",  "mset", "sfx",  "music",
   "map",  "spr",  "circ",  "circb", "rect",   "rectb",  "tri",  "line",  "pix",  "clip", "btn",
   "btnp", "key",  "keyp",  "mouse", "time",   "tstamp", "sync", "trace", "exit",
]);

//type StringLiteralNode = luaparse.StringLiteral&{value?: string | null};

function baseIsSafeGlobal(expr: luaparse.Expression): boolean {
   return expr.type === "Identifier" && SAFE_GLOBAL_BASES.has(expr.name);
}

// Serialize an expression to a string key for comparison
function serializeExpression(node: luaparse.Expression|null|undefined): string|null {
   if (!node)
      return null;

   switch (node.type) {
      case "Identifier":
         if (!SAFE_GLOBAL_FUNCS.has(node.name))
            return null;
         return `id:${node.name}`;

      case "MemberExpression": {
         if (!baseIsSafeGlobal(node.base))
            return null;
         const baseName = (node.base as luaparse.Identifier).name;
         const id = node.identifier;
         let identifier: string|null = null;

         if (id) {
            if (id.type === "Identifier")
               identifier = id.name;
            else
               identifier = serializeExpression(id);
         }

         if (!identifier)
            return null;

         return `member:${baseName}.${identifier}`;
      }

      case "IndexExpression": {
         if (!baseIsSafeGlobal(node.base))
            return null;
         const base = (node.base as luaparse.Identifier).name;
         const index = serializeExpression(node.index);
         if (!base || !index)
            return null;
         return `index:${base}[${index}]`;
      }

      case "StringLiteral": {
         const strNode = node as StringLiteralNode;
         const raw = strNode.raw ?? (strNode.value != null ? JSON.stringify(strNode.value) : "\"\"");
         return `str:${raw}`;
      }

      case "NumericLiteral":
         return `num:${node.value}`;

      case "BooleanLiteral":
         return `bool:${node.value}`;

      case "NilLiteral":
         return "nil";

      default:
         return null;
   }
}

// Check if an expression is worth aliasing
function isAliasableExpression(node: luaparse.Expression|null|undefined): boolean {
   if (!node)
      return false;

   switch (node.type) {
      case "Identifier":
         return SAFE_GLOBAL_FUNCS.has(node.name);

      case "MemberExpression":
         // Only alias safe global library member access (e.g., math.cos)
         return baseIsSafeGlobal(node.base);

      case "IndexExpression":
         // Only alias safe global library index access (e.g., math["cos"])
         return baseIsSafeGlobal(node.base);

      // Don't alias literals
      case "StringLiteral":
      case "NumericLiteral":
      case "BooleanLiteral":
      case "NilLiteral":
         return false;

      default:
         return false;
   }
}

function expressionTextLength(node: luaparse.Expression|null|undefined): number {
   if (!node)
      return Number.POSITIVE_INFINITY;

   switch (node.type) {
      case "Identifier":
         return node.name.length;

      case "MemberExpression": {
         const id = node.identifier;
         const idLen = id?.type === "Identifier" ? id.name.length : expressionTextLength(id as any);
         return expressionTextLength(node.base) + 1 + idLen; // base . id
      }

      case "IndexExpression": {
         return expressionTextLength(node.base) + 2 + expressionTextLength(node.index); // base[index]
      }

      case "StringLiteral": {
         const strNode = node as StringLiteralNode;
         if (strNode.raw)
            return strNode.raw.length;
         if (typeof strNode.value === "string")
            return strNode.value.length + 2; // quotes
         return 2;
      }

      case "NumericLiteral":
         return node.raw?.length || String(node.value).length;

      case "BooleanLiteral":
         return node.value ? 4 : 5;

      case "NilLiteral":
         return 3;

      default:
         return Number.POSITIVE_INFINITY;
   }
}

function shouldAliasExpression(info: AliasInfo): boolean {
   const exprCost = expressionTextLength(info.node);
   if (!Number.isFinite(exprCost))
      return false;

   const aliasNameLength = info.aliasName?.length ?? (EXPR_ALIAS_PREFIX.length + 1); // e.g., _a
   const declarationCost = 6 + aliasNameLength + exprCost;                           // "local " + name + "=" + expr
   const useCost = aliasNameLength;

   const aliasTotal = declarationCost + useCost * info.count;
   const noAliasTotal = exprCost * info.count;

   return aliasTotal < noAliasTotal;
}

// Recursively replace expressions with aliases
function replaceExpression(node: luaparse.Expression, tracker: any): luaparse.Expression {
   if (!node)
      return node;

   const key = serializeExpression(node);
   if (key) {
      const alias = tracker.getAlias(key);
      if (alias) {
         return {
            type: "Identifier",
            name: alias,
         } as luaparse.Identifier;
      }
   }

   // Recursively replace in child expressions
   switch (node.type) {
      case "BinaryExpression":
      case "LogicalExpression":
         node.left = replaceExpression(node.left, tracker);
         node.right = replaceExpression(node.right, tracker);
         break;

      case "UnaryExpression":
         node.argument = replaceExpression(node.argument, tracker);
         break;

      case "CallExpression":
         node.base = replaceExpression(node.base, tracker);
         if (node.arguments) {
            node.arguments = node.arguments.map(arg => replaceExpression(arg, tracker));
         }
         break;

      case "TableCallExpression":
         node.base = replaceExpression(node.base, tracker);
         node.arguments = replaceExpression(node.arguments, tracker) as luaparse.TableConstructorExpression;
         break;

      case "StringCallExpression":
         node.base = replaceExpression(node.base, tracker);
         break;

      case "MemberExpression":
         // Don't replace the base if this whole expression is being aliased
         if (!serializeExpression(node) || !tracker.getAlias(serializeExpression(node)!)) {
            node.base = replaceExpression(node.base, tracker);
         }
         break;

      case "IndexExpression":
         // Don't replace base/index if this whole expression is being aliased
         if (!serializeExpression(node) || !tracker.getAlias(serializeExpression(node)!)) {
            node.base = replaceExpression(node.base, tracker);
            node.index = replaceExpression(node.index, tracker);
         }
         break;

      case "TableConstructorExpression":
         if (node.fields) {
            node.fields.forEach((field: luaparse.TableKey|luaparse.TableKeyString|luaparse.TableValue) => {
               if (field.type === "TableKey" || field.type === "TableKeyString") {
                  if (field.key)
                     field.key = replaceExpression(field.key, tracker);
               }
               if (field.value)
                  field.value = replaceExpression(field.value, tracker);
            });
         }
         break;
   }

   return node;
}

/**
 * Alias repeated expressions in the AST
 * 
 * This optimization finds expressions that are used multiple times (like math.cos, string.sub)
 * and creates local aliases for them to reduce code size. Aliases are declared in the highest
 * scope where they are used.
 * 
 * Example:
 *   local x = math.cos(1) + math.cos(2) + math.cos(3)
 *   local y = math.sin(1) + math.sin(2) + math.sin(3)
 * 
 * Becomes:
 *   local _a = math.cos
 *   local _b = math.sin
 *   local x = _a(1) + _a(2) + _a(3)
 *   local y = _b(1) + _b(2) + _b(3)
 */
export function aliasRepeatedExpressionsInAST(ast: luaparse.Chunk): luaparse.Chunk {
   const strategy = {
      prefix: EXPR_ALIAS_PREFIX,
      serialize: (node: luaparse.Expression|null|undefined) => {
         if (!node)
            return null;
         if (!isAliasableExpression(node))
            return null;
         return serializeExpression(node);
      },
      shouldAlias: shouldAliasExpression,
      replaceExpression,
   } as const;

   return runAliasPass(ast, strategy);
}
