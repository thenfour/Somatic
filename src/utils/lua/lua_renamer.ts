import * as luaparse from "luaparse";
import {isIdentifier, LUA_RESERVED_WORDS} from "./lua_ast";
import {generateShortName} from "./lua_utils";

// tracks scope hierarchy for variable rename scope
class RenameScope {
   private parent: RenameScope|null;
   private mappings = new Map<string, string>();

   constructor(parent: RenameScope|null = null) {
      this.parent = parent;
   }

   define(originalName: string, newName: string): void {
      this.mappings.set(originalName, newName);
   }

   lookup(name: string): string|undefined {
      const local = this.mappings.get(name);
      if (local !== undefined)
         return local;
      return this.parent?.lookup(name);
   }

   createChild(): RenameScope {
      return new RenameScope(this);
   }
}


export function renameLocalVariablesInAST(ast: luaparse.Chunk): luaparse.Chunk {
   let nameCounter = 0;
   //const usedNamesGlobal = new Set<string>();

   function generateUniqueName(): string {
      let name: string;
      do {
         name = generateShortName(nameCounter++);
      } while (LUA_RESERVED_WORDS.has(name));
      return name;
   }

   function processScope(body: luaparse.Statement[], scope: RenameScope): void {
      for (const stmt of body) {
         processStatement(stmt, scope);
      }
   }

   function processStatement(node: any, scope: RenameScope): void {
      if (!node)
         return;

      switch (node.type) {
         case "LocalStatement": {
            // Evaluate init expressions with current scope
            if (node.init) {
               node.init.forEach((expr: any) => processExpression(expr, scope));
            }
            // Then declare variables in current scope
            node.variables.forEach((v: any) => {
               if (isIdentifier(v)) {
                  const newName = generateUniqueName();
                  scope.define(v.name, newName);
                  v.name = newName; // Mutate the AST
               }
            });
            break;
         }

         case "FunctionDeclaration": {
            // Handle local function name
            if (node.isLocal && node.identifier && isIdentifier(node.identifier)) {
               const newName = generateUniqueName();
               scope.define(node.identifier.name, newName);
               node.identifier.name = newName;
            } else if (node.identifier) {
               // Non-local function, process identifier
               processExpression(node.identifier, scope);
            }

            // Create new scope for function body
            const funcScope = scope.createChild();

            // Rename parameters
            node.parameters.forEach((p: any) => {
               if (isIdentifier(p)) {
                  const newName = generateUniqueName();
                  funcScope.define(p.name, newName);
                  p.name = newName;
               }
            });

            // Process function body with new scope
            processScope(node.body, funcScope);
            break;
         }

         case "ForNumericStatement": {
            const forScope = scope.createChild();

            // Evaluate bounds with outer scope
            processExpression(node.start, scope);
            processExpression(node.end, scope);
            if (node.step)
               processExpression(node.step, scope);

            // Rename loop variable
            if (isIdentifier(node.variable)) {
               const newName = generateUniqueName();
               forScope.define(node.variable.name, newName);
               node.variable.name = newName;
            }

            processScope(node.body, forScope);
            break;
         }

         case "ForGenericStatement": {
            // Evaluate iterators with outer scope
            node.iterators.forEach((it: any) => processExpression(it, scope));

            const forScope = scope.createChild();

            // Rename loop variables
            node.variables.forEach((v: any) => {
               if (isIdentifier(v)) {
                  const newName = generateUniqueName();
                  forScope.define(v.name, newName);
                  v.name = newName;
               }
            });

            processScope(node.body, forScope);
            break;
         }

         case "DoStatement": {
            const doScope = scope.createChild();
            processScope(node.body, doScope);
            break;
         }

         case "WhileStatement": {
            processExpression(node.condition, scope);
            processScope(node.body, scope);
            break;
         }

         case "RepeatStatement": {
            processScope(node.body, scope);
            processExpression(node.condition, scope);
            break;
         }

         case "IfStatement": {
            node.clauses.forEach((clause: any) => {
               if (clause.condition)
                  processExpression(clause.condition, scope);
               processScope(clause.body, scope);
            });
            break;
         }

         case "ReturnStatement": {
            node.arguments.forEach((arg: any) => processExpression(arg, scope));
            break;
         }

         case "AssignmentStatement": {
            node.variables.forEach((v: any) => processExpression(v, scope));
            node.init.forEach((init: any) => processExpression(init, scope));
            break;
         }

         case "CallStatement": {
            processExpression(node.expression, scope);
            break;
         }

            // Other statement types don't need special handling
      }
   }

   function processExpression(node: any, scope: RenameScope): void {
      if (!node)
         return;

      switch (node.type) {
         case "Identifier": {
            const renamed = scope.lookup(node.name);
            if (renamed !== undefined) {
               node.name = renamed; // Mutate the AST
            }
            break;
         }

         case "FunctionDeclaration": {
            // Anonymous function expression
            const funcScope = scope.createChild();

            node.parameters.forEach((p: any) => {
               if (isIdentifier(p)) {
                  const newName = generateUniqueName();
                  funcScope.define(p.name, newName);
                  p.name = newName;
               }
            });

            processScope(node.body, funcScope);
            break;
         }

         case "TableConstructorExpression": {
            node.fields.forEach((field: any) => {
               if (field.key)
                  processExpression(field.key, scope);
               if (field.value)
                  processExpression(field.value, scope);
            });
            break;
         }

         case "BinaryExpression":
         case "LogicalExpression": {
            processExpression(node.left, scope);
            processExpression(node.right, scope);
            break;
         }

         case "UnaryExpression": {
            processExpression(node.argument, scope);
            break;
         }

         case "MemberExpression": {
            processExpression(node.base, scope);
            // Don't process identifier - it's a property name, not a variable
            break;
         }

         case "IndexExpression": {
            processExpression(node.base, scope);
            processExpression(node.index, scope);
            break;
         }

         case "CallExpression":
         case "TableCallExpression":
         case "StringCallExpression": {
            processExpression(node.base, scope);
            if (node.arguments) {
               if (Array.isArray(node.arguments)) {
                  node.arguments.forEach((arg: any) => processExpression(arg, scope));
               } else {
                  processExpression(node.arguments, scope);
               }
            }
            break;
         }

            // Literals don't need processing
      }
   }

   // Start with a root scope (globals are not renamed)
   const rootScope = new RenameScope(null);
   processScope(ast.body, rootScope);

   return ast;
}
