import * as luaparse from "luaparse";
import {AliasInfo, runAliasPass} from "./lua_alias_shared";
import {LiteralNode, StringLiteralNode} from "./lua_utils";

// ============================================================================
// Literal Aliasing - Create local aliases for repeated literal values
// ============================================================================

// Configuration
const LITERAL_ALIAS_PREFIX = "L";

//type StringLiteralNode = luaparse.StringLiteral&{value?: string | null};
//type LiteralNode = StringLiteralNode|luaparse.NumericLiteral|luaparse.BooleanLiteral|luaparse.NilLiteral;

// Serialize a literal to a string key for comparison
function serializeLiteral(node: luaparse.Expression): string|null {
   if (!node)
      return null;

   switch (node.type) {
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

// Check if a literal is worth aliasing based on space savings
function shouldAliasLiteral(info: AliasInfo): boolean {
   const node = info.node;

   // Calculate the cost of the literal per use
   let literalCost = 0;
   switch (node.type) {
      case "StringLiteral": {
         const strNode = node as StringLiteralNode;
         // String literals: quotes + escaped content; value may be undefined
         const valueLength = strNode.value ? strNode.value.length + 2 : 0;
         literalCost = strNode.raw?.length || valueLength;
         break;
      }

      case "NumericLiteral":
         // Numeric literals: digit count
         literalCost = node.raw?.length || String(node.value).length;
         break;

      case "BooleanLiteral":
         // true = 4 chars, false = 5 chars
         literalCost = node.value ? 4 : 5;
         break;

      case "NilLiteral":
         // nil = 3 chars
         literalCost = 3;
         break;

      default:
         return false;
   }

   // Calculate the cost of creating an alias
   // Format: "local La=<literal>" (minimum)
   const aliasNameLength = info.aliasName?.length ?? 2;       // minimum expected alias length
   const declarationCost = 6 + aliasNameLength + literalCost; // "local " + name + "=" + literal

   // Calculate the cost of using the alias (just the identifier length)
   const useCost = aliasNameLength;

   // Total cost with alias: declaration + (useCost * count)
   const aliasTotalCost = declarationCost + (useCost * info.count);

   // Total cost without alias: literalCost * count
   const noAliasTotalCost = literalCost * info.count;

   // Only alias if it saves space
   return aliasTotalCost < noAliasTotalCost;
}

// Recursively replace literals with aliases
function replaceLiteral(node: luaparse.Expression, tracker: any): luaparse.Expression {
   if (!node)
      return node;

   // Check if this literal itself should be replaced
   const key = serializeLiteral(node);
   if (key) {
      const alias = tracker.getAlias(key);
      //const literalNode = node as LiteralNode;
      // const displayValue =
      //    literalNode.type === "StringLiteral" ? (literalNode.raw ?? "<missing raw>") : literalNode.value;
      if (alias) {
         // This literal should be replaced with an alias
         return {
            type: "Identifier",
            name: alias,
         } as luaparse.Identifier;
      }
      // This is a literal but shouldn't be aliased, return as-is
      return node;
   }

   // Not a literal, recursively replace in child expressions
   switch (node.type) {
      case "BinaryExpression":
      case "LogicalExpression":
         node.left = replaceLiteral(node.left, tracker);
         node.right = replaceLiteral(node.right, tracker);
         break;

      case "UnaryExpression":
         node.argument = replaceLiteral(node.argument, tracker);
         break;

      case "CallExpression":
         node.base = replaceLiteral(node.base, tracker);
         if (node.arguments) {
            node.arguments = node.arguments.map(arg => replaceLiteral(arg, tracker));
         }
         break;

      case "TableCallExpression":
         node.base = replaceLiteral(node.base, tracker);
         node.arguments = replaceLiteral(node.arguments, tracker) as luaparse.TableConstructorExpression;
         break;

      case "StringCallExpression":
         node.base = replaceLiteral(node.base, tracker);
         break;

      case "MemberExpression":
         node.base = replaceLiteral(node.base, tracker);
         break;

      case "IndexExpression":
         node.base = replaceLiteral(node.base, tracker);
         node.index = replaceLiteral(node.index, tracker);
         break;

      case "TableConstructorExpression":
         if (node.fields) {
            node.fields.forEach((field: luaparse.TableKey|luaparse.TableKeyString|luaparse.TableValue) => {
               if (field.type === "TableKey" || field.type === "TableKeyString") {
                  if (field.key)
                     field.key = replaceLiteral(field.key, tracker);
               }
               if (field.value)
                  field.value = replaceLiteral(field.value, tracker);
            });
         }
         break;
   }

   return node;
}

/**
 * Alias repeated literal values in the AST
 * 
 * This optimization finds literal values (strings, numbers) that are used multiple times
 * and creates local aliases for them to reduce code size.
 * 
 * Example:
 *   local x = "hello" .. "world"
 *   local y = "hello" .. "test"
 *   local z = "hello" .. "demo"
 * 
 * Becomes:
 *   local La = "hello"
 *   local x = La .. "world"
 *   local y = La .. "test"
 *   local z = La .. "demo"
 */
export function aliasLiteralsInAST(ast: luaparse.Chunk): luaparse.Chunk {
   const strategy = {
      prefix: LITERAL_ALIAS_PREFIX,
      serialize: serializeLiteral,
      shouldAlias: shouldAliasLiteral,
      replaceExpression: replaceLiteral,
   } as const;

   return runAliasPass(ast, strategy);
}
