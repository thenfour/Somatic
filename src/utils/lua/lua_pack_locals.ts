import * as luaparse from "luaparse";
import {StringLiteralNode} from "./lua_utils";

// // Optional string literal value helper (luaparse may omit value)
// type StringLiteralNode = luaparse.StringLiteral&{value?: string | null};

function usesAnyIdentifier(node: luaparse.Expression, names: Set<string>): boolean {
   switch (node.type) {
      case "Identifier":
         return names.has(node.name);

      case "MemberExpression":
         return usesAnyIdentifier(node.base, names);

      case "IndexExpression":
         return usesAnyIdentifier(node.base, names) || usesAnyIdentifier(node.index, names);

      case "CallExpression":
         return usesAnyIdentifier(node.base, names) || node.arguments.some(arg => usesAnyIdentifier(arg, names));

      case "TableCallExpression":
         return usesAnyIdentifier(node.base, names) || usesAnyIdentifier(node.arguments, names);

      case "StringCallExpression":
         return usesAnyIdentifier(node.base, names) || usesAnyIdentifier(node.argument as luaparse.Expression, names);

      case "BinaryExpression":
      case "LogicalExpression":
         return usesAnyIdentifier(node.left, names) || usesAnyIdentifier(node.right, names);

      case "UnaryExpression":
         return usesAnyIdentifier(node.argument, names);

      case "TableConstructorExpression":
         return node.fields.some(field => {
            if (field.type === "TableKey" || field.type === "TableKeyString") {
               const keyHit = field.key ? usesAnyIdentifier(field.key, names) : false;
               const valHit = field.value ? usesAnyIdentifier(field.value, names) : false;
               return keyHit || valHit;
            }
            return field.value ? usesAnyIdentifier(field.value, names) : false;
         });

      case "FunctionDeclaration": {
         // Treat parameters as shadowing; don't walk into body here (packing is statement-level)
         const paramNames =
            new Set(node.parameters.filter(p => p.type === "Identifier").map(p => (p as luaparse.Identifier).name));
         const innerNames = new Set([...names].filter(n => !paramNames.has(n)));
         // We still need to see if defaults capture; luaparse FunctionDeclaration as expression has no defaults, so safe.
         return node.body.some(stmt => statementUsesNames(stmt, innerNames));
      }

      case "StringLiteral": {
         const s = node as StringLiteralNode;
         return s.raw ? false : !!s.value;
      }

      default:
         return false;
   }
}

function statementUsesNames(stmt: luaparse.Statement, names: Set<string>): boolean {
   switch (stmt.type) {
      case "LocalStatement":
         if (stmt.init && stmt.init.some(expr => usesAnyIdentifier(expr, names)))
            return true;
         return false;

      case "AssignmentStatement":
         if (stmt.variables.some(v => usesAnyIdentifier(v, names)))
            return true;
         if (stmt.init.some(expr => usesAnyIdentifier(expr, names)))
            return true;
         return false;

      case "CallStatement":
         return usesAnyIdentifier(stmt.expression, names);

      case "ReturnStatement":
         return stmt.arguments.some(arg => usesAnyIdentifier(arg, names));

      case "IfStatement":
         return stmt.clauses.some(clause => {
            const condHit =
               clause.type !== "ElseClause" && clause.condition ? usesAnyIdentifier(clause.condition, names) : false;
            return condHit || clause.body.some(s => statementUsesNames(s, names));
         });

      case "WhileStatement":
         return usesAnyIdentifier(stmt.condition, names) || stmt.body.some(s => statementUsesNames(s, names));

      case "RepeatStatement":
         return stmt.body.some(s => statementUsesNames(s, names)) || usesAnyIdentifier(stmt.condition, names);

      case "ForNumericStatement":
         return usesAnyIdentifier(stmt.start, names) || usesAnyIdentifier(stmt.end, names) ||
            (stmt.step ? usesAnyIdentifier(stmt.step, names) : false) ||
            stmt.body.some(s => statementUsesNames(s, names));

      case "ForGenericStatement":
         return stmt.iterators.some(it => usesAnyIdentifier(it, names)) ||
            stmt.body.some(s => statementUsesNames(s, names));

      case "FunctionDeclaration":
         return stmt.body.some(s => statementUsesNames(s, names));

      case "DoStatement":
         return stmt.body.some(s => statementUsesNames(s, names));

      case "BreakStatement":
      case "LabelStatement":
      case "GotoStatement":
         return false;

      default:
         return false;
   }
}

function isPackableLocal(stmt: luaparse.LocalStatement): boolean {
   // Only pack 1-variable locals. Multi-variable locals can rely on Lua's multi-return
   // fill semantics (e.g. `local a,b,c = f()`), and packing them with neighbors can
   // silently change results.
   return stmt.variables.length === 1 && stmt.variables.every(v => v.type === "Identifier");
}

function nilLiteral(): luaparse.NilLiteral {
   return {type: "NilLiteral", value: null, raw: "nil"};
}

function processBlock(body: luaparse.Statement[]): luaparse.Statement[] {
   const result: luaparse.Statement[] = [];
   let i = 0;

   while (i < body.length) {
      const stmt = body[i];

      if (stmt.type === "LocalStatement" && isPackableLocal(stmt)) {
         const group: luaparse.LocalStatement[] = [];
         const declared = new Set<string>();

         // seed group with first local
         group.push(stmt);
         stmt.variables.forEach(v => declared.add((v as luaparse.Identifier).name));

         let j = i + 1;
         while (j < body.length) {
            const next = body[j];
            if (next.type !== "LocalStatement" || !isPackableLocal(next))
               break;

            // Don't pack across a redeclaration (Lua allows it; packing would change shadowing boundaries).
            const nextVarNames = new Set((next.variables as luaparse.Identifier[]).map(v => v.name));
            const isRedeclaration = [...nextVarNames].some(n => declared.has(n));
            if (isRedeclaration)
               break;

            // Forward-reference hazard: if any earlier initializer references a name that will be declared
            // by `next`, packing would make that identifier resolve to an uninitialized local (nil) instead
            // of a global/outer binding.
            const groupHasForwardRef = group.some(ls => {
               const inits = ls.init || [];
               return inits.some(expr => usesAnyIdentifier(expr, nextVarNames));
            });
            if (groupHasForwardRef)
               break;

            // dependency check: next init must not reference already-declared names in this group
            const inits = next.init || [];
            const hasDependency = inits.some(expr => usesAnyIdentifier(expr, declared));
            if (hasDependency)
               break;

            group.push(next);
            next.variables.forEach(v => declared.add((v as luaparse.Identifier).name));
            j++;
         }

         if (group.length === 1) {
            result.push(stmt);
            i += 1;
            continue;
         }

         // Merge group
         const mergedVars: luaparse.Identifier[] = [];
         const mergedInits: luaparse.Expression[] = [];

         group.forEach(ls => {
            const vars = ls.variables as luaparse.Identifier[];
            const inits = ls.init || [];
            vars.forEach((v, idx) => {
               mergedVars.push(v);
               if (idx < inits.length) {
                  mergedInits.push(inits[idx]);
               } else {
                  mergedInits.push(nilLiteral());
               }
            });
         });

         const packed: luaparse.LocalStatement = {
            type: "LocalStatement",
            variables: mergedVars,
            init: mergedInits,
         };

         result.push(packed);
         i = j;
         continue;
      }

      // Recurse into child blocks
      switch (stmt.type) {
         case "IfStatement":
            stmt.clauses.forEach(clause => {
               clause.body = processBlock(clause.body);
            });
            break;

         case "WhileStatement":
            stmt.body = processBlock(stmt.body);
            break;

         case "RepeatStatement":
            stmt.body = processBlock(stmt.body);
            break;

         case "ForNumericStatement":
            stmt.body = processBlock(stmt.body);
            break;

         case "ForGenericStatement":
            stmt.body = processBlock(stmt.body);
            break;

         case "FunctionDeclaration":
            stmt.body = processBlock(stmt.body);
            break;

         case "DoStatement":
            stmt.body = processBlock(stmt.body);
            break;
      }

      result.push(stmt);
      i += 1;
   }

   return result;
}

export function packLocalDeclarationsInAST(ast: luaparse.Chunk): luaparse.Chunk {
   ast.body = processBlock(ast.body);
   return ast;
}
