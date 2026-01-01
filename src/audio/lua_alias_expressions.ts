import * as luaparse from "luaparse";
import {AliasTracker, AliasInfo, buildScopeHierarchy, findCommonAncestor, insertDeclarationsIntoScopes} from "./lua_alias_shared";

// ============================================================================
// Expression Aliasing - Create local aliases for repeated expressions
// ============================================================================

// Configuration
const ALIAS_THRESHOLD = 3;     // Minimum occurrences before creating an alias
const EXPR_ALIAS_PREFIX = "_"; // Prefix for generated alias names

type StringLiteralNode = luaparse.StringLiteral&{value?: string | null};

// Serialize an expression to a string key for comparison
function serializeExpression(node: luaparse.Expression|null|undefined): string|null {
   if (!node)
      return null;

   switch (node.type) {
      case "Identifier":
         return `id:${node.name}`;

      case "MemberExpression": {
         const base = serializeExpression(node.base);
         const identifier = node.identifier?.name || serializeExpression(node.identifier);
         if (!base || !identifier)
            return null;
         return `member:${base}.${identifier}`;
      }

      case "IndexExpression": {
         const base = serializeExpression(node.base);
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
      case "MemberExpression":
         // Alias things like math.cos, string.sub, etc.
         return true;

      case "IndexExpression":
         // Could alias table[key] accesses
         return true;

      // Don't alias simple identifiers or literals
      case "Identifier":
      case "StringLiteral":
      case "NumericLiteral":
      case "BooleanLiteral":
      case "NilLiteral":
         return false;

      default:
         return false;
   }
}

// Recursively replace expressions with aliases
function replaceExpression(node: luaparse.Expression, tracker: AliasTracker): luaparse.Expression {
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
   const tracker = new AliasTracker(EXPR_ALIAS_PREFIX);

   type ScopeNode = luaparse.Chunk|luaparse.Statement;

   // Count expressions
   function countExpressions(node: luaparse.Expression, currentScope: ScopeNode): void {
      if (!node)
         return;

      if (isAliasableExpression(node)) {
         const key = serializeExpression(node);
         if (key) {
            tracker.record(key, node, currentScope);
         }
      }

      // Recursively count in child expressions
      switch (node.type) {
         case "BinaryExpression":
         case "LogicalExpression":
            countExpressions(node.left, currentScope);
            countExpressions(node.right, currentScope);
            break;

         case "UnaryExpression":
            countExpressions(node.argument, currentScope);
            break;

         case "CallExpression":
            countExpressions(node.base, currentScope);
            if (node.arguments) {
               node.arguments.forEach(arg => countExpressions(arg, currentScope));
            }
            break;

         case "TableCallExpression":
            countExpressions(node.base, currentScope);
            countExpressions(node.arguments, currentScope);
            break;

         case "StringCallExpression":
            countExpressions(node.base, currentScope);
            break;

         case "MemberExpression":
            countExpressions(node.base, currentScope);
            break;

         case "IndexExpression":
            countExpressions(node.base, currentScope);
            countExpressions(node.index, currentScope);
            break;

         case "TableConstructorExpression":
            if (node.fields) {
               node.fields.forEach((field: luaparse.TableKey|luaparse.TableKeyString|luaparse.TableValue) => {
                  if (field.type === "TableKey" || field.type === "TableKeyString") {
                     if (field.key)
                        countExpressions(field.key, currentScope);
                  }
                  if (field.value)
                     countExpressions(field.value, currentScope);
               });
            }
            break;
      }
   }

   // Process scope and statements
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
               stmt.init.forEach(expr => countExpressions(expr, currentScope));
            }
            break;

         case "AssignmentStatement":
            stmt.variables.forEach(v => countExpressions(v, currentScope));
            stmt.init.forEach(expr => countExpressions(expr, currentScope));
            break;

         case "CallStatement":
            countExpressions(stmt.expression, currentScope);
            break;

         case "ReturnStatement":
            stmt.arguments.forEach(arg => countExpressions(arg, currentScope));
            break;

         case "IfStatement":
            stmt.clauses.forEach(clause => {
               if (clause.type !== "ElseClause" && clause.condition) {
                  countExpressions(clause.condition, currentScope);
               }
               processScope(clause.body, stmt, currentScope, scopeParents);
            });
            break;

         case "WhileStatement":
            countExpressions(stmt.condition, currentScope);
            processScope(stmt.body, stmt, currentScope, scopeParents);
            break;

         case "RepeatStatement":
            processScope(stmt.body, stmt, currentScope, scopeParents);
            countExpressions(stmt.condition, currentScope);
            break;

         case "ForNumericStatement":
            countExpressions(stmt.start, currentScope);
            countExpressions(stmt.end, currentScope);
            if (stmt.step)
               countExpressions(stmt.step, currentScope);
            processScope(stmt.body, stmt, currentScope, scopeParents);
            break;

         case "ForGenericStatement":
            stmt.iterators.forEach(it => countExpressions(it, currentScope));
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

   // Get expressions that meet the threshold
   const aliasableExpressions = tracker.getAliasableItems(info => info.count >= ALIAS_THRESHOLD);

   if (aliasableExpressions.length === 0) {
      return ast;
   }

   // Determine target scope for each expression
   aliasableExpressions.forEach(info => {
      info.targetScope = findCommonAncestor(info.scopes, scopeParents, ast);
   });

   // Group by target scope
   const declarationsByScope = new Map<ScopeNode, AliasInfo[]>();
   aliasableExpressions.forEach(info => {
      const scope = info.targetScope!;
      if (!declarationsByScope.has(scope)) {
         declarationsByScope.set(scope, []);
      }
      declarationsByScope.get(scope)!.push(info);
   });

   // Replace expressions with aliases
   function replaceInStatement(stmt: luaparse.Statement): void {
      if (!stmt)
         return;

      switch (stmt.type) {
         case "LocalStatement":
            if (stmt.init) {
               stmt.init = stmt.init.map(expr => replaceExpression(expr, tracker));
            }
            break;

         case "AssignmentStatement":
            stmt.variables = stmt.variables.map(
               v => replaceExpression(v, tracker) as luaparse.Identifier | luaparse.MemberExpression |
                  luaparse.IndexExpression);
            stmt.init = stmt.init.map(expr => replaceExpression(expr, tracker));
            break;

         case "CallStatement":
            stmt.expression = replaceExpression(stmt.expression, tracker) as luaparse.CallExpression |
               luaparse.TableCallExpression | luaparse.StringCallExpression;
            break;

         case "ReturnStatement":
            stmt.arguments = stmt.arguments.map(arg => replaceExpression(arg, tracker));
            break;

         case "IfStatement":
            stmt.clauses.forEach(clause => {
               if (clause.type !== "ElseClause" && clause.condition)
                  clause.condition = replaceExpression(clause.condition, tracker);
               clause.body.forEach(s => replaceInStatement(s));
            });
            break;

         case "WhileStatement":
            stmt.condition = replaceExpression(stmt.condition, tracker);
            stmt.body.forEach(s => replaceInStatement(s));
            break;

         case "RepeatStatement":
            stmt.body.forEach(s => replaceInStatement(s));
            stmt.condition = replaceExpression(stmt.condition, tracker);
            break;

         case "ForNumericStatement":
            stmt.start = replaceExpression(stmt.start, tracker);
            stmt.end = replaceExpression(stmt.end, tracker);
            if (stmt.step)
               stmt.step = replaceExpression(stmt.step, tracker);
            stmt.body.forEach(s => replaceInStatement(s));
            break;

         case "ForGenericStatement":
            stmt.iterators = stmt.iterators.map(it => replaceExpression(it, tracker));
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

   // Insert declarations
   insertDeclarationsIntoScopes(ast, declarationsByScope);

   return ast;
}
