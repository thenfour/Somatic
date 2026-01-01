import * as luaparse from "luaparse";
import {AliasTracker, AliasInfo, buildScopeHierarchy, findCommonAncestor, insertDeclarationsIntoScopes} from "./lua_alias_shared";

// ============================================================================
// Literal Aliasing - Create local aliases for repeated literal values
// ============================================================================

// Configuration
const LITERAL_ALIAS_PREFIX = "L";

type StringLiteralNode = luaparse.StringLiteral&{value?: string | null};
type LiteralNode = StringLiteralNode|luaparse.NumericLiteral|luaparse.BooleanLiteral|luaparse.NilLiteral;

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
function replaceLiteral(node: luaparse.Expression, tracker: AliasTracker): luaparse.Expression {
   if (!node)
      return node;

   // Check if this literal itself should be replaced
   const key = serializeLiteral(node);
   if (key) {
      const alias = tracker.getAlias(key);
      const literalNode = node as LiteralNode;
      const displayValue =
         literalNode.type === "StringLiteral" ? (literalNode.raw ?? "<missing raw>") : literalNode.value;
      console.log(`[REPLACE] Literal ${key} (value: ${displayValue}) -> alias: ${alias || "none"}`);
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
   const tracker = new AliasTracker(LITERAL_ALIAS_PREFIX);

   type ScopeNode = luaparse.Chunk|luaparse.Statement;

   // Count literals in expressions
   function countLiterals(node: luaparse.Expression, currentScope: ScopeNode): void {
      if (!node)
         return;

      const key = serializeLiteral(node);
      if (key) {
         //const literalNode = node as LiteralNode;
         //const displayValue = literalNode.type === "StringLiteral" ? literalNode.raw : literalNode.value;
         //console.log(`[COUNT] Found literal: ${key}, value: ${displayValue}`);
         tracker.record(key, node, currentScope);
         // Don't recurse into literal nodes - they have no children
         return;
      }

      // Recursively count in child expressions
      switch (node.type) {
         case "BinaryExpression":
         case "LogicalExpression":
            countLiterals(node.left, currentScope);
            countLiterals(node.right, currentScope);
            break;

         case "UnaryExpression":
            countLiterals(node.argument, currentScope);
            break;

         case "CallExpression":
            countLiterals(node.base, currentScope);
            if (node.arguments) {
               node.arguments.forEach(arg => countLiterals(arg, currentScope));
            }
            break;

         case "TableCallExpression":
            countLiterals(node.base, currentScope);
            countLiterals(node.arguments, currentScope);
            break;

         case "StringCallExpression":
            countLiterals(node.base, currentScope);
            break;

         case "MemberExpression":
            countLiterals(node.base, currentScope);
            break;

         case "IndexExpression":
            countLiterals(node.base, currentScope);
            countLiterals(node.index, currentScope);
            break;

         case "TableConstructorExpression":
            if (node.fields) {
               node.fields.forEach((field: luaparse.TableKey|luaparse.TableKeyString|luaparse.TableValue) => {
                  if (field.type === "TableKey" || field.type === "TableKeyString") {
                     if (field.key)
                        countLiterals(field.key, currentScope);
                  }
                  if (field.value)
                     countLiterals(field.value, currentScope);
               });
            }
            break;
      }
   }

   // Process statements and build scope hierarchy
   function processScope(
      stmts: luaparse.Statement[],
      currentScope: ScopeNode,
      parentScope: ScopeNode|null,
      scopeParents: WeakMap<ScopeNode, ScopeNode>): void {
      if (parentScope) {
         scopeParents.set(currentScope, parentScope);
      }

      stmts.forEach(stmt => countInStatement(stmt, currentScope, scopeParents));
   }

   function countInStatement(
      stmt: luaparse.Statement, currentScope: ScopeNode, scopeParents: WeakMap<ScopeNode, ScopeNode>): void {
      if (!stmt)
         return;

      switch (stmt.type) {
         case "LocalStatement":
            if (stmt.init) {
               stmt.init.forEach(expr => countLiterals(expr, currentScope));
            }
            break;

         case "AssignmentStatement":
            // Count literals in both lvalues and rvalues
            stmt.variables.forEach(v => countLiterals(v, currentScope));
            stmt.init.forEach(expr => countLiterals(expr, currentScope));
            break;

         case "CallStatement":
            countLiterals(stmt.expression, currentScope);
            break;

         case "ReturnStatement":
            stmt.arguments.forEach(arg => countLiterals(arg, currentScope));
            break;

         case "IfStatement":
            stmt.clauses.forEach(clause => {
               if (clause.type !== "ElseClause" && clause.condition) {
                  countLiterals(clause.condition, currentScope);
               }
               processScope(clause.body, stmt, currentScope, scopeParents);
            });
            break;

         case "WhileStatement":
            countLiterals(stmt.condition, currentScope);
            processScope(stmt.body, stmt, currentScope, scopeParents);
            break;

         case "RepeatStatement":
            processScope(stmt.body, stmt, currentScope, scopeParents);
            countLiterals(stmt.condition, currentScope);
            break;

         case "ForNumericStatement":
            countLiterals(stmt.start, currentScope);
            countLiterals(stmt.end, currentScope);
            if (stmt.step)
               countLiterals(stmt.step, currentScope);
            processScope(stmt.body, stmt, currentScope, scopeParents);
            break;

         case "ForGenericStatement":
            stmt.iterators.forEach(it => countLiterals(it, currentScope));
            processScope(stmt.body, stmt, currentScope, scopeParents);
            break;

         case "FunctionDeclaration":
            processScope(stmt.body, stmt, currentScope, scopeParents);
            break;

         case "DoStatement":
            processScope(stmt.body, stmt, currentScope, scopeParents);
            break;
      }
   }

   // Build scope hierarchy
   const scopeParents = buildScopeHierarchy(ast, processScope);

   console.log(
      "[TRACKER] All tracked literals:",
      Array.from((tracker as any).items.entries() as Iterable<[string, AliasInfo]>).map(([key, info]) => {
         const literalNode = info.node as LiteralNode;
         const displayValue = literalNode.type === "StringLiteral" ? literalNode.raw : literalNode.value;
         return {key, count: info.count, value: displayValue};
      }));

   // Get aliasable literals (only those that save space)
   const aliasableLiterals = tracker.getAliasableItems(shouldAliasLiteral);

   console.log("[ALIASABLE] Literals that will be aliased:", aliasableLiterals.map(info => {
      const literalNode = info.node as LiteralNode;
      const displayValue = literalNode.type === "StringLiteral" ? literalNode.raw : literalNode.value;
      return {key: info.serialized, count: info.count, aliasName: info.aliasName, value: displayValue};
   }));

   if (aliasableLiterals.length === 0) {
      return ast;
   }

   // Determine target scope for each literal
   aliasableLiterals.forEach(info => {
      info.targetScope = findCommonAncestor(info.scopes, scopeParents, ast);
   });

   // Group literals by target scope
   const declarationsByScope = new Map<ScopeNode, AliasInfo[]>();
   aliasableLiterals.forEach(info => {
      const scope = info.targetScope!;
      if (!declarationsByScope.has(scope)) {
         declarationsByScope.set(scope, []);
      }
      declarationsByScope.get(scope)!.push(info);
   });

   // Replace literals with aliases
   function replaceInStatement(stmt: luaparse.Statement): void {
      if (!stmt)
         return;

      switch (stmt.type) {
         case "LocalStatement":
            if (stmt.init) {
               stmt.init = stmt.init.map(expr => replaceLiteral(expr, tracker));
            }
            break;

         case "AssignmentStatement":
            // Replace literals in the right-hand side (init expressions)
            stmt.init = stmt.init.map(expr => replaceLiteral(expr, tracker));
            // Also traverse lvalues (they can contain IndexExpression with literal indices)
            stmt.variables.forEach(v => replaceLiteral(v, tracker));
            break;

         case "CallStatement":
            // Traverse the call expression to replace literals inside
            replaceLiteral(stmt.expression, tracker);
            break;

         case "ReturnStatement":
            stmt.arguments = stmt.arguments.map(arg => replaceLiteral(arg, tracker));
            break;

         case "IfStatement":
            stmt.clauses.forEach(clause => {
               if (clause.type !== "ElseClause" && clause.condition) {
                  clause.condition = replaceLiteral(clause.condition, tracker);
               }
               clause.body.forEach(s => replaceInStatement(s));
            });
            break;

         case "WhileStatement":
            stmt.condition = replaceLiteral(stmt.condition, tracker);
            stmt.body.forEach(s => replaceInStatement(s));
            break;

         case "RepeatStatement":
            stmt.body.forEach(s => replaceInStatement(s));
            stmt.condition = replaceLiteral(stmt.condition, tracker);
            break;

         case "ForNumericStatement":
            stmt.start = replaceLiteral(stmt.start, tracker);
            stmt.end = replaceLiteral(stmt.end, tracker);
            if (stmt.step)
               stmt.step = replaceLiteral(stmt.step, tracker);
            stmt.body.forEach(s => replaceInStatement(s));
            break;

         case "ForGenericStatement":
            stmt.iterators = stmt.iterators.map(it => replaceLiteral(it, tracker));
            stmt.body.forEach(s => replaceInStatement(s));
            break;

         case "FunctionDeclaration":
            stmt.body.forEach(s => replaceInStatement(s));
            break;

         case "DoStatement":
            stmt.body.forEach(s => replaceInStatement(s));
            break;
      }
   }

   ast.body.forEach(stmt => replaceInStatement(stmt));

   // Insert alias declarations
   insertDeclarationsIntoScopes(ast, declarationsByScope);

   return ast;
}
