import * as luaparse from "luaparse";
import {isIdentifier, LUA_RESERVED_WORDS} from "./lua_ast";

// ============================================================================
// Expression Aliasing - Create local aliases for repeated expressions
// ============================================================================

// Configuration
const ALIAS_THRESHOLD = 3; // Minimum occurrences before creating an alias
const ALIAS_PREFIX = "_";  // Prefix for generated alias names

// Generate a unique alias name
function generateAliasName(index: number, prefix: string = ALIAS_PREFIX): string {
   const alphabet = "abcdefghijklmnopqrstuvwxyz";
   let name = prefix;
   let n = index;
   do {
      name += alphabet[n % 26];
      n = Math.floor(n / 26) - 1;
   } while (n >= 0);
   return name;
}

// Serialize an expression to a string key for comparison
function serializeExpression(node: any): string|null {
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

      case "StringLiteral":
         return `str:"${node.value}"`;

      case "NumericLiteral":
         return `num:${node.value}`;

      case "BooleanLiteral":
         return `bool:${node.value}`;

      case "NilLiteral":
         return "nil";

      // Don't alias complex expressions for now
      default:
         return null;
   }
}

// Check if an expression is worth aliasing
function isAliasableExpression(node: any): boolean {
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

// Clone an expression node (shallow clone of structure)
function cloneExpression(node: any): any {
   if (!node)
      return null;

   const clone: any = {type: node.type};

   switch (node.type) {
      case "Identifier":
         clone.name = node.name;
         break;

      case "MemberExpression":
         clone.base = cloneExpression(node.base);
         clone.identifier = cloneExpression(node.identifier);
         clone.indexer = node.indexer;
         break;

      case "IndexExpression":
         clone.base = cloneExpression(node.base);
         clone.index = cloneExpression(node.index);
         break;

      case "StringLiteral":
         clone.value = node.value;
         clone.raw = node.raw;
         break;

      case "NumericLiteral":
         clone.value = node.value;
         clone.raw = node.raw;
         break;

      case "BooleanLiteral":
         clone.value = node.value;
         clone.raw = node.raw;
         break;

      case "NilLiteral":
         // No additional properties
         break;
   }

   return clone;
}

// Track expression occurrences in a scope
interface ExpressionInfo {
   serialized: string;
   expression: any;
   count: number;
   aliasName?: string;
}

class ExpressionTracker {
   private expressions = new Map<string, ExpressionInfo>();
   private aliasCounter = 0;

   // Record an occurrence of an expression
   record(node: any): void {
      if (!isAliasableExpression(node))
         return;

      const key = serializeExpression(node);
      if (!key)
         return;

      const existing = this.expressions.get(key);
      if (existing) {
         existing.count++;
      } else {
         this.expressions.set(key, {
            serialized: key,
            expression: cloneExpression(node),
            count: 1,
         });
      }
   }

   // Get expressions that should be aliased
   getAliasableExpressions(): ExpressionInfo[] {
      const result: ExpressionInfo[] = [];

      for (const info of this.expressions.values()) {
         if (info.count >= ALIAS_THRESHOLD) {
            // Generate an alias name
            let aliasName: string;
            do {
               aliasName = generateAliasName(this.aliasCounter++);
            } while (LUA_RESERVED_WORDS.has(aliasName));

            info.aliasName = aliasName;
            result.push(info);
         }
      }

      return result;
   }

   // Look up an alias for an expression
   getAlias(node: any): string|null {
      if (!isAliasableExpression(node))
         return null;

      const key = serializeExpression(node);
      if (!key)
         return null;

      const info = this.expressions.get(key);
      return info?.aliasName || null;
   }
}

/**
 * Alias repeated expressions in the AST
 * 
 * This optimization finds expressions that are used multiple times (like math.cos, string.sub)
 * and creates local aliases for them to reduce code size.
 * 
 * Example:
 *   local x = math.cos(1) + math.cos(2)
 *   local y = math.sin(3) + math.sin(4)
 * 
 * Becomes:
 *   local _a = math.cos
 *   local _b = math.sin
 *   local x = _a(1) + _a(2)
 *   local y = _b(3) + _b(4)
 */
export function aliasRepeatedExpressionsInAST(ast: luaparse.Chunk): luaparse.Chunk {
   // First pass: count expression occurrences
   const tracker = new ExpressionTracker();

   function countExpressions(node: any): void {
      if (!node)
         return;

      // Record this expression
      tracker.record(node);

      // Recursively count in child expressions
      switch (node.type) {
         case "BinaryExpression":
         case "LogicalExpression":
            countExpressions(node.left);
            countExpressions(node.right);
            break;

         case "UnaryExpression":
            countExpressions(node.argument);
            break;

         case "CallExpression":
            countExpressions(node.base);
            if (node.arguments) {
               node.arguments.forEach((arg: any) => countExpressions(arg));
            }
            break;

         case "TableCallExpression":
            countExpressions(node.base);
            countExpressions(node.arguments);
            break;

         case "StringCallExpression":
            countExpressions(node.base);
            break;

         case "MemberExpression":
            countExpressions(node.base);
            break;

         case "IndexExpression":
            countExpressions(node.base);
            countExpressions(node.index);
            break;

         case "TableConstructorExpression":
            if (node.fields) {
               node.fields.forEach((field: any) => {
                  if (field.key)
                     countExpressions(field.key);
                  if (field.value)
                     countExpressions(field.value);
               });
            }
            break;
      }
   }

   function countInStatement(stmt: any): void {
      if (!stmt)
         return;

      switch (stmt.type) {
         case "LocalStatement":
            if (stmt.init) {
               stmt.init.forEach((expr: any) => countExpressions(expr));
            }
            break;

         case "AssignmentStatement":
            stmt.variables.forEach((v: any) => countExpressions(v));
            stmt.init.forEach((expr: any) => countExpressions(expr));
            break;

         case "CallStatement":
            countExpressions(stmt.expression);
            break;

         case "ReturnStatement":
            stmt.arguments.forEach((arg: any) => countExpressions(arg));
            break;

         case "IfStatement":
            stmt.clauses.forEach((clause: any) => {
               if (clause.condition)
                  countExpressions(clause.condition);
               clause.body.forEach((s: any) => countInStatement(s));
            });
            break;

         case "WhileStatement":
            countExpressions(stmt.condition);
            stmt.body.forEach((s: any) => countInStatement(s));
            break;

         case "RepeatStatement":
            stmt.body.forEach((s: any) => countInStatement(s));
            countExpressions(stmt.condition);
            break;

         case "ForNumericStatement":
            countExpressions(stmt.start);
            countExpressions(stmt.end);
            if (stmt.step)
               countExpressions(stmt.step);
            stmt.body.forEach((s: any) => countInStatement(s));
            break;

         case "ForGenericStatement":
            stmt.iterators.forEach((it: any) => countExpressions(it));
            stmt.body.forEach((s: any) => countInStatement(s));
            break;

         case "FunctionDeclaration":
            stmt.body.forEach((s: any) => countInStatement(s));
            break;

         case "DoStatement":
            stmt.body.forEach((s: any) => countInStatement(s));
            break;
      }
   }

   // Count all expressions in the chunk
   ast.body.forEach(stmt => countInStatement(stmt));

   const aliasableExpressions = tracker.getAliasableExpressions();

   // If no expressions to alias, return unchanged
   if (aliasableExpressions.length === 0) {
      return ast;
   }

   // Second pass: replace expressions with aliases
   function replaceExpression(node: any): any {
      if (!node)
         return node;

      const alias = tracker.getAlias(node);
      if (alias) {
         // Replace with an identifier reference
         return {
            type: "Identifier",
            name: alias,
         };
      }

      // Recursively replace in child expressions
      switch (node.type) {
         case "BinaryExpression":
         case "LogicalExpression":
            node.left = replaceExpression(node.left);
            node.right = replaceExpression(node.right);
            break;

         case "UnaryExpression":
            node.argument = replaceExpression(node.argument);
            break;

         case "CallExpression":
            node.base = replaceExpression(node.base);
            if (node.arguments) {
               node.arguments = node.arguments.map((arg: any) => replaceExpression(arg));
            }
            break;

         case "TableCallExpression":
            node.base = replaceExpression(node.base);
            node.arguments = replaceExpression(node.arguments);
            break;

         case "StringCallExpression":
            node.base = replaceExpression(node.base);
            break;

         case "MemberExpression":
            // Don't replace the base if this whole expression is being aliased
            if (!tracker.getAlias(node)) {
               node.base = replaceExpression(node.base);
            }
            break;

         case "IndexExpression":
            // Don't replace base/index if this whole expression is being aliased
            if (!tracker.getAlias(node)) {
               node.base = replaceExpression(node.base);
               node.index = replaceExpression(node.index);
            }
            break;

         case "TableConstructorExpression":
            if (node.fields) {
               node.fields.forEach((field: any) => {
                  if (field.key)
                     field.key = replaceExpression(field.key);
                  if (field.value)
                     field.value = replaceExpression(field.value);
               });
            }
            break;
      }

      return node;
   }

   function replaceInStatement(stmt: any): void {
      if (!stmt)
         return;

      switch (stmt.type) {
         case "LocalStatement":
            if (stmt.init) {
               stmt.init = stmt.init.map((expr: any) => replaceExpression(expr));
            }
            break;

         case "AssignmentStatement":
            stmt.variables = stmt.variables.map((v: any) => replaceExpression(v));
            stmt.init = stmt.init.map((expr: any) => replaceExpression(expr));
            break;

         case "CallStatement":
            stmt.expression = replaceExpression(stmt.expression);
            break;

         case "ReturnStatement":
            stmt.arguments = stmt.arguments.map((arg: any) => replaceExpression(arg));
            break;

         case "IfStatement":
            stmt.clauses.forEach((clause: any) => {
               if (clause.condition)
                  clause.condition = replaceExpression(clause.condition);
               clause.body.forEach((s: any) => replaceInStatement(s));
            });
            break;

         case "WhileStatement":
            stmt.condition = replaceExpression(stmt.condition);
            stmt.body.forEach((s: any) => replaceInStatement(s));
            break;

         case "RepeatStatement":
            stmt.body.forEach((s: any) => replaceInStatement(s));
            stmt.condition = replaceExpression(stmt.condition);
            break;

         case "ForNumericStatement":
            stmt.start = replaceExpression(stmt.start);
            stmt.end = replaceExpression(stmt.end);
            if (stmt.step)
               stmt.step = replaceExpression(stmt.step);
            stmt.body.forEach((s: any) => replaceInStatement(s));
            break;

         case "ForGenericStatement":
            stmt.iterators = stmt.iterators.map((it: any) => replaceExpression(it));
            stmt.body.forEach((s: any) => replaceInStatement(s));
            break;

         case "FunctionDeclaration":
            stmt.body.forEach((s: any) => replaceInStatement(s));
            break;

         case "DoStatement":
            stmt.body.forEach((s: any) => replaceInStatement(s));
            break;
      }
   }

   // Replace expressions in all statements
   ast.body.forEach(stmt => replaceInStatement(stmt));

   // Third pass: insert alias declarations at the beginning
   const aliasDeclarations: luaparse.LocalStatement[] = aliasableExpressions.map(info => ({
                                                                                    type: "LocalStatement",
                                                                                    variables: [{
                                                                                       type: "Identifier",
                                                                                       name: info.aliasName!,
                                                                                    }],
                                                                                    init: [info.expression],
                                                                                 }));

   // Prepend alias declarations to the chunk
   ast.body = [...aliasDeclarations, ...ast.body];

   return ast;
}
