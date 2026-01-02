import * as luaparse from "luaparse";
import {LUA_RESERVED_WORDS} from "./lua_ast";

// ============================================================================
// Shared aliasing utilities
// ============================================================================

// Generate a unique alias name
export function generateAliasName(index: number, prefix: string = "_"): string {
   const alphabet = "abcdefghijklmnopqrstuvwxyz";
   let name = prefix;
   let n = index;
   do {
      name += alphabet[n % 26];
      n = Math.floor(n / 26) - 1;
   } while (n >= 0);
   return name;
}

// Clone an expression node (shallow clone of structure)
// CLANG FORMAT PLEASE
type ExpressionCloneable =|luaparse
                             .Identifier //
                          |luaparse
                             .MemberExpression| //
                          luaparse
                             .IndexExpression| //
                          luaparse
                             .StringLiteral| //
                          luaparse
                             .NumericLiteral| //
                          luaparse
                             .BooleanLiteral| //
                          luaparse.NilLiteral;

export function cloneExpression<T extends luaparse.Expression>(node: T): T {
   if (!node)
      throw new Error("cloneExpression called with nullish node");

   const baseClone: Partial<ExpressionCloneable> = {type: node.type} as Partial<ExpressionCloneable>;

   switch (node.type) {
      case "Identifier": {
         const id = baseClone as luaparse.Identifier;
         id.name = node.name;
         break;
      }

      case "MemberExpression": {
         const m = baseClone as luaparse.MemberExpression;
         m.base = cloneExpression(node.base);
         m.identifier = cloneExpression(node.identifier);
         m.indexer = node.indexer;
         break;
      }

      case "IndexExpression": {
         const idx = baseClone as luaparse.IndexExpression;
         idx.base = cloneExpression(node.base);
         idx.index = cloneExpression(node.index);
         break;
      }

      case "StringLiteral": {
         const lit = baseClone as luaparse.StringLiteral;
         lit.value = node.value;
         lit.raw = node.raw;
         break;
      }

      case "NumericLiteral": {
         const lit = baseClone as luaparse.NumericLiteral;
         lit.value = node.value;
         lit.raw = node.raw;
         break;
      }

      case "BooleanLiteral": {
         const lit = baseClone as luaparse.BooleanLiteral;
         lit.value = node.value;
         lit.raw = node.raw;
         break;
      }

      case "NilLiteral":
         // nothing extra to copy
         break;

      default:
         // Non-cloneable expression types are unexpected here
         throw new Error(`cloneExpression received unsupported node type: ${node.type}`);
   }

   return baseClone as T;
}

// Shared info about an aliasable item (expression or literal)
export interface AliasInfo {
   serialized: string;
   node: luaparse.Expression;
   count: number;
   scopes: Array<luaparse.Chunk|luaparse.Statement>;
   aliasName?: string;
   targetScope?: luaparse.Chunk|luaparse.Statement;
}

// Tracker for aliasable items
export class AliasTracker {
   private items = new Map<string, AliasInfo>();
   private aliasCounter = 0;
   private prefix: string;

   constructor(prefix: string = "_") {
      this.prefix = prefix;
   }

   // Record an occurrence of an item in a given scope
   record(key: string, node: luaparse.Expression, scope: luaparse.Chunk|luaparse.Statement): void {
      const existing = this.items.get(key);
      if (existing) {
         existing.count++;
         if (!existing.scopes.includes(scope)) {
            existing.scopes.push(scope);
         }
      } else {
         this.items.set(key, {
            serialized: key,
            node: cloneExpression(node),
            count: 1,
            scopes: [scope],
         });
      }
   }

   // Get items that should be aliased based on a predicate
   getAliasableItems(predicate: (info: AliasInfo) => boolean): AliasInfo[] {
      const result: AliasInfo[] = [];

      for (const info of this.items.values()) {
         if (predicate(info)) {
            let aliasName: string;
            do {
               aliasName = generateAliasName(this.aliasCounter++, this.prefix);
            } while (LUA_RESERVED_WORDS.has(aliasName));

            info.aliasName = aliasName;
            result.push(info);
         }
      }

      return result;
   }

   // Look up an alias for an item by key
   getAlias(key: string): string|null {
      const info = this.items.get(key);
      return info?.aliasName || null;
   }
}

// Build scope hierarchy map
export function buildScopeHierarchy(
   ast: luaparse.Chunk,
   processStatements:
      (stmts: luaparse.Statement[],
       scope: luaparse.Chunk|luaparse.Statement,
       parent: luaparse.Chunk|luaparse.Statement|null,
       scopeParents: WeakMap<luaparse.Chunk|luaparse.Statement, luaparse.Chunk|luaparse.Statement>) =>
         void): WeakMap<luaparse.Chunk|luaparse.Statement, luaparse.Chunk|luaparse.Statement> {
   const scopeParents = new WeakMap<luaparse.Chunk|luaparse.Statement, luaparse.Chunk|luaparse.Statement>();
   processStatements(ast.body, ast, null, scopeParents);
   return scopeParents;
}

// Find common ancestor scope for multiple scopes
export function findCommonAncestor(
   scopes: Array<luaparse.Chunk|luaparse.Statement>,
   scopeParents: WeakMap<luaparse.Chunk|luaparse.Statement, luaparse.Chunk|luaparse.Statement>,
   rootScope: luaparse.Chunk|luaparse.Statement): luaparse.Chunk|luaparse.Statement {
   if (scopes.length === 0)
      return rootScope;
   if (scopes.length === 1)
      return scopes[0];

   // Get all ancestors for the first scope
   const ancestors = new Set<any>();
   let current: any = scopes[0];
   while (current) {
      ancestors.add(current);
      const parent = scopeParents.get(current);
      if (!parent)
         break;
      current = parent;
   }

   // Find the first common ancestor for all other scopes
   for (let i = 1; i < scopes.length; i++) {
      let scope = scopes[i];
      while (scope && !ancestors.has(scope)) {
         const parent = scopeParents.get(scope);
         if (!parent)
            break;
         scope = parent;
      }
      if (scope) {
         const newAncestors = new Set<any>();
         let current = scope;
         while (current) {
            if (ancestors.has(current)) {
               newAncestors.add(current);
            }
            const parent = scopeParents.get(current);
            if (!parent)
               break;
            current = parent;
         }
         ancestors.clear();
         newAncestors.forEach(a => ancestors.add(a));
      }
   }

   // Return the deepest common ancestor
   for (const scope of scopes) {
      let current = scope;
      while (current) {
         if (ancestors.has(current)) {
            return current;
         }
         const parent = scopeParents.get(current);
         if (!parent)
            break;
         current = parent;
      }
   }

   return rootScope;
}

// Insert declarations into scopes
export function insertDeclarationsIntoScopes(
   ast: luaparse.Chunk, declarationsByScope: Map<luaparse.Chunk|luaparse.Statement, AliasInfo[]>): void {
   // Helper to insert declarations at the beginning of a scope
   function insertDeclarations(scope: any): void {
      const declarations = declarationsByScope.get(scope);
      if (!declarations || declarations.length === 0)
         return;

      const aliasDeclarations: luaparse.LocalStatement[] = declarations.map(info => ({
                                                                               type: "LocalStatement",
                                                                               variables: [{
                                                                                  type: "Identifier",
                                                                                  name: info.aliasName!,
                                                                               }],
                                                                               init: [info.node],
                                                                            }));

      let body: any[];
      if (scope === ast) {
         body = ast.body;
      } else if (scope.body) {
         body = scope.body;
      } else {
         return;
      }

      body.unshift(...aliasDeclarations);
   }

   // Process statements recursively to insert into nested scopes
   function processStatementsForInsertion(stmts: any[]): void {
      stmts.forEach(stmt => {
         switch (stmt.type) {
            case "IfStatement":
               stmt.clauses.forEach((clause: any) => {
                  insertDeclarations(clause);
                  processStatementsForInsertion(clause.body);
               });
               break;

            case "WhileStatement":
            case "RepeatStatement":
            case "ForNumericStatement":
            case "ForGenericStatement":
            case "FunctionDeclaration":
            case "DoStatement":
               insertDeclarations(stmt);
               processStatementsForInsertion(stmt.body);
               break;
         }
      });
   }

   insertDeclarations(ast);
   processStatementsForInsertion(ast.body);
}

// ---------------------------------------------------------------------------
// Generic alias pass runner
// ---------------------------------------------------------------------------

export type AliasStrategy = {
   prefix: string; serialize(node: luaparse.Expression|null|undefined): string | null;
   shouldAlias(info: AliasInfo): boolean;
   replaceExpression(node: luaparse.Expression, tracker: AliasTracker): luaparse.Expression;
};

export function runAliasPass(ast: luaparse.Chunk, strategy: AliasStrategy): luaparse.Chunk {
   const tracker = new AliasTracker(strategy.prefix);

   type ScopeNode = luaparse.Chunk|luaparse.Statement;

   function countExpr(node: luaparse.Expression, currentScope: ScopeNode): void {
      if (!node)
         return;

      const key = strategy.serialize(node);
      if (key)
         tracker.record(key, node, currentScope);

      switch (node.type) {
         case "BinaryExpression":
         case "LogicalExpression":
            countExpr(node.left, currentScope);
            countExpr(node.right, currentScope);
            break;

         case "UnaryExpression":
            countExpr(node.argument, currentScope);
            break;

         case "CallExpression":
            countExpr(node.base, currentScope);
            if (node.arguments)
               node.arguments.forEach(arg => countExpr(arg, currentScope));
            break;

         case "TableCallExpression":
            countExpr(node.base, currentScope);
            countExpr(node.arguments, currentScope);
            break;

         case "StringCallExpression":
            countExpr(node.base, currentScope);
            break;

         case "MemberExpression":
            countExpr(node.base, currentScope);
            break;

         case "IndexExpression":
            countExpr(node.base, currentScope);
            countExpr(node.index, currentScope);
            break;

         case "TableConstructorExpression":
            if (node.fields) {
               node.fields.forEach((field: luaparse.TableKey|luaparse.TableKeyString|luaparse.TableValue) => {
                  if (field.type === "TableKey" || field.type === "TableKeyString") {
                     if (field.key)
                        countExpr(field.key, currentScope);
                  }
                  if (field.value)
                     countExpr(field.value, currentScope);
               });
            }
            break;
      }
   }

   function processScope(
      stmts: luaparse.Statement[],
      currentScope: ScopeNode,
      parentScope: ScopeNode|null,
      scopeParents: WeakMap<ScopeNode, ScopeNode>): void {
      if (parentScope)
         scopeParents.set(currentScope, parentScope);

      stmts.forEach(stmt => countInStatement(stmt, currentScope, scopeParents));
   }

   function countInStatement(
      stmt: luaparse.Statement, currentScope: ScopeNode, scopeParents: WeakMap<ScopeNode, ScopeNode>): void {
      if (!stmt)
         return;

      switch (stmt.type) {
         case "LocalStatement":
            if (stmt.init)
               stmt.init.forEach(expr => countExpr(expr, currentScope));
            break;

         case "AssignmentStatement":
            stmt.variables.forEach(v => countExpr(v, currentScope));
            stmt.init.forEach(expr => countExpr(expr, currentScope));
            break;

         case "CallStatement":
            countExpr(stmt.expression, currentScope);
            break;

         case "ReturnStatement":
            stmt.arguments.forEach(arg => countExpr(arg, currentScope));
            break;

         case "IfStatement":
            stmt.clauses.forEach(clause => {
               if (clause.type !== "ElseClause" && clause.condition)
                  countExpr(clause.condition, currentScope);
               processScope(clause.body, stmt, currentScope, scopeParents);
            });
            break;

         case "WhileStatement":
            countExpr(stmt.condition, currentScope);
            processScope(stmt.body, stmt, currentScope, scopeParents);
            break;

         case "RepeatStatement":
            processScope(stmt.body, stmt, currentScope, scopeParents);
            countExpr(stmt.condition, currentScope);
            break;

         case "ForNumericStatement":
            countExpr(stmt.start, currentScope);
            countExpr(stmt.end, currentScope);
            if (stmt.step)
               countExpr(stmt.step, currentScope);
            processScope(stmt.body, stmt, currentScope, scopeParents);
            break;

         case "ForGenericStatement":
            stmt.iterators.forEach(it => countExpr(it, currentScope));
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

   const scopeParents = buildScopeHierarchy(ast, processScope);
   const aliasable = tracker.getAliasableItems(strategy.shouldAlias);
   if (aliasable.length === 0)
      return ast;

   aliasable.forEach(info => {
      info.targetScope = findCommonAncestor(info.scopes, scopeParents, ast);
   });

   const declarationsByScope = new Map<ScopeNode, AliasInfo[]>();
   aliasable.forEach(info => {
      const scope = info.targetScope!;
      if (!declarationsByScope.has(scope))
         declarationsByScope.set(scope, []);
      declarationsByScope.get(scope)!.push(info);
   });

   function replaceInStatement(stmt: luaparse.Statement): void {
      if (!stmt)
         return;

      switch (stmt.type) {
         case "LocalStatement":
            if (stmt.init)
               stmt.init = stmt.init.map(expr => strategy.replaceExpression(expr, tracker));
            break;

         case "AssignmentStatement":
            stmt.variables = stmt.variables.map(
               v => strategy.replaceExpression(v, tracker) as luaparse.Identifier | luaparse.MemberExpression |
                  luaparse.IndexExpression);
            stmt.init = stmt.init.map(expr => strategy.replaceExpression(expr, tracker));
            break;

         case "CallStatement":
            stmt.expression = strategy.replaceExpression(stmt.expression, tracker) as luaparse.CallExpression |
               luaparse.TableCallExpression | luaparse.StringCallExpression;
            break;

         case "ReturnStatement":
            stmt.arguments = stmt.arguments.map(arg => strategy.replaceExpression(arg, tracker));
            break;

         case "IfStatement":
            stmt.clauses.forEach(clause => {
               if (clause.type !== "ElseClause" && clause.condition)
                  clause.condition = strategy.replaceExpression(clause.condition, tracker);
               clause.body.forEach(s => replaceInStatement(s));
            });
            break;

         case "WhileStatement":
            stmt.condition = strategy.replaceExpression(stmt.condition, tracker);
            stmt.body.forEach(s => replaceInStatement(s));
            break;

         case "RepeatStatement":
            stmt.body.forEach(s => replaceInStatement(s));
            stmt.condition = strategy.replaceExpression(stmt.condition, tracker);
            break;

         case "ForNumericStatement":
            stmt.start = strategy.replaceExpression(stmt.start, tracker);
            stmt.end = strategy.replaceExpression(stmt.end, tracker);
            if (stmt.step)
               stmt.step = strategy.replaceExpression(stmt.step, tracker);
            stmt.body.forEach(s => replaceInStatement(s));
            break;

         case "ForGenericStatement":
            stmt.iterators = stmt.iterators.map(it => strategy.replaceExpression(it, tracker));
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
   insertDeclarationsIntoScopes(ast, declarationsByScope);
   return ast;
}
