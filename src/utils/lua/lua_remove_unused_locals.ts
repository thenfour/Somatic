import * as luaparse from "luaparse";

function exprHasSideEffects(expr: luaparse.Expression): boolean {
   switch (expr.type) {
      case "CallExpression":
      case "TableCallExpression":
      case "StringCallExpression":
         return true;
      case "UnaryExpression":
         return exprHasSideEffects(expr.argument);
      case "BinaryExpression":
      case "LogicalExpression":
         return exprHasSideEffects(expr.left) || exprHasSideEffects(expr.right);
      case "MemberExpression":
         return exprHasSideEffects(expr.base);
      case "IndexExpression":
         return exprHasSideEffects(expr.base) || exprHasSideEffects(expr.index);
      case "TableConstructorExpression":
         return expr.fields.some(field => {
            if (field.type === "TableKey" || field.type === "TableKeyString") {
               const keySE = field.key ? exprHasSideEffects(field.key) : false;
               const valSE = field.value ? exprHasSideEffects(field.value) : false;
               return keySE || valSE;
            }
            return field.value ? exprHasSideEffects(field.value) : false;
         });
      case "FunctionDeclaration": {
         // Creating a function value is pure; its body executes later.
         // We still walk the body for free-variable discovery elsewhere.
         return false;
      }
      default:
         return false;
   }
}

function collectReadsFromExpression(expr: luaparse.Expression, out: Set<string>): void {
   switch (expr.type) {
      case "Identifier":
         out.add(expr.name);
         return;

      case "UnaryExpression":
         collectReadsFromExpression(expr.argument, out);
         return;

      case "BinaryExpression":
      case "LogicalExpression":
         collectReadsFromExpression(expr.left, out);
         collectReadsFromExpression(expr.right, out);
         return;

      case "CallExpression":
         collectReadsFromExpression(expr.base, out);
         expr.arguments.forEach(arg => collectReadsFromExpression(arg, out));
         return;

      case "TableCallExpression":
         collectReadsFromExpression(expr.base, out);
         collectReadsFromExpression(expr.arguments, out);
         return;

      case "StringCallExpression":
         collectReadsFromExpression(expr.base, out);
         collectReadsFromExpression(expr.argument as luaparse.Expression, out);
         return;

      case "MemberExpression":
         collectReadsFromExpression(expr.base, out);
         if (expr.identifier)
            collectReadsFromExpression(expr.identifier as luaparse.Expression, out);
         return;

      case "IndexExpression":
         collectReadsFromExpression(expr.base, out);
         collectReadsFromExpression(expr.index, out);
         return;

      case "TableConstructorExpression":
         expr.fields.forEach(field => {
            if (field.type === "TableKey" || field.type === "TableKeyString") {
               if (field.key)
                  collectReadsFromExpression(field.key, out);
               if (field.value)
                  collectReadsFromExpression(field.value, out);
            } else if (field.type === "TableValue" && field.value) {
               collectReadsFromExpression(field.value, out);
            }
         });
         return;

      case "FunctionDeclaration": {
         const bodyReads = new Set<string>();
         expr.body.forEach(stmt => collectReadsFromStatement(stmt, bodyReads));
         const defs = new Set<string>();
         expr.parameters.forEach(p => {
            if (p.type === "Identifier")
               defs.add(p.name);
         });
         expr.body.forEach(stmt => collectDefsFromStatement(stmt, defs));
         bodyReads.forEach(name => {
            if (!defs.has(name))
               out.add(name);
         });
         return;
      }

      default:
         return;
   }
}

function collectReadsFromStatement(stmt: luaparse.Statement, out: Set<string>): void {
   switch (stmt.type) {
      case "LocalStatement":
         if (stmt.init)
            stmt.init.forEach(expr => collectReadsFromExpression(expr, out));
         return;

      case "AssignmentStatement":
         stmt.variables.forEach(v => collectReadsFromExpression(v, out));
         stmt.init.forEach(expr => collectReadsFromExpression(expr, out));
         return;

      case "CallStatement":
         collectReadsFromExpression(stmt.expression, out);
         return;

      case "ReturnStatement":
         stmt.arguments.forEach(arg => collectReadsFromExpression(arg, out));
         return;

      case "IfStatement":
         stmt.clauses.forEach(clause => {
            if (clause.type !== "ElseClause" && clause.condition)
               collectReadsFromExpression(clause.condition, out);
            clause.body.forEach(s => collectReadsFromStatement(s, out));
         });
         return;

      case "WhileStatement":
         collectReadsFromExpression(stmt.condition, out);
         stmt.body.forEach(s => collectReadsFromStatement(s, out));
         return;

      case "RepeatStatement":
         stmt.body.forEach(s => collectReadsFromStatement(s, out));
         collectReadsFromExpression(stmt.condition, out);
         return;

      case "ForNumericStatement":
         collectReadsFromExpression(stmt.start, out);
         collectReadsFromExpression(stmt.end, out);
         if (stmt.step)
            collectReadsFromExpression(stmt.step, out);
         stmt.body.forEach(s => collectReadsFromStatement(s, out));
         return;

      case "ForGenericStatement":
         stmt.iterators.forEach(it => collectReadsFromExpression(it, out));
         stmt.body.forEach(s => collectReadsFromStatement(s, out));
         return;

      case "FunctionDeclaration":
         stmt.body.forEach(s => collectReadsFromStatement(s, out));
         return;

      case "DoStatement":
         stmt.body.forEach(s => collectReadsFromStatement(s, out));
         return;

      default:
         return;
   }
}

function collectDefsFromStatement(stmt: luaparse.Statement, out: Set<string>): void {
   switch (stmt.type) {
      case "LocalStatement":
         stmt.variables.forEach(v => {
            if (v.type === "Identifier")
               out.add(v.name);
         });
         return;

      case "AssignmentStatement":
         stmt.variables.forEach(v => {
            if (v.type === "Identifier")
               out.add(v.name);
         });
         return;

      case "ForNumericStatement":
         if (stmt.variable.type === "Identifier")
            out.add(stmt.variable.name);
         stmt.body.forEach(s => collectDefsFromStatement(s, out));
         return;

      case "ForGenericStatement":
         stmt.variables.forEach(v => {
            if (v.type === "Identifier")
               out.add(v.name);
         });
         stmt.body.forEach(s => collectDefsFromStatement(s, out));
         return;

      case "IfStatement":
         stmt.clauses.forEach(clause => clause.body.forEach(s => collectDefsFromStatement(s, out)));
         return;

      case "WhileStatement":
      case "RepeatStatement":
      case "DoStatement":
         stmt.body.forEach(s => collectDefsFromStatement(s, out));
         return;

      case "FunctionDeclaration":
         if (stmt.identifier && stmt.identifier.type === "Identifier")
            out.add(stmt.identifier.name);
         stmt.body.forEach(s => collectDefsFromStatement(s, out));
         return;

      default:
         return;
   }
}

function rewriteChildBlocks(stmt: luaparse.Statement): luaparse.Statement {
   switch (stmt.type) {
      case "IfStatement":
         stmt.clauses.forEach(clause => {
            clause.body = removeUnusedLocalsInBlock(clause.body);
         });
         return stmt;
      case "WhileStatement":
         stmt.body = removeUnusedLocalsInBlock(stmt.body);
         return stmt;
      case "RepeatStatement":
         stmt.body = removeUnusedLocalsInBlock(stmt.body);
         return stmt;
      case "ForNumericStatement":
         stmt.body = removeUnusedLocalsInBlock(stmt.body);
         return stmt;
      case "ForGenericStatement":
         stmt.body = removeUnusedLocalsInBlock(stmt.body);
         return stmt;
      case "FunctionDeclaration":
         stmt.body = removeUnusedLocalsInBlock(stmt.body);
         return stmt;
      case "DoStatement":
         stmt.body = removeUnusedLocalsInBlock(stmt.body);
         return stmt;
      default:
         return stmt;
   }
}

function removeUnusedLocalsInBlock(body: luaparse.Statement[]): luaparse.Statement[] {
   const used = new Set<string>();
   const kept: luaparse.Statement[] = [];

   for (let i = body.length - 1; i >= 0; i--) {
      const stmt = rewriteChildBlocks(body[i]);

      const reads = new Set<string>();
      collectReadsFromStatement(stmt, reads);

      const defs = new Set<string>();
      switch (stmt.type) {
         case "LocalStatement":
            stmt.variables.forEach(v => {
               if (v.type === "Identifier")
                  defs.add(v.name);
            });
            break;
         case "AssignmentStatement":
            stmt.variables.forEach(v => {
               if (v.type === "Identifier")
                  defs.add(v.name);
            });
            break;
         case "ForNumericStatement":
            if (stmt.variable.type === "Identifier")
               defs.add(stmt.variable.name);
            break;
         case "ForGenericStatement":
            stmt.variables.forEach(v => {
               if (v.type === "Identifier")
                  defs.add(v.name);
            });
            break;
         case "FunctionDeclaration":
            if (stmt.identifier && stmt.identifier.type === "Identifier")
               defs.add(stmt.identifier.name);
            break;
         default:
            break;
      }

      if (stmt.type === "LocalStatement") {
         const hasSideEffects = (stmt.init || []).some(expr => exprHasSideEffects(expr));
         const usedAfter = new Set(used);
         const liveDefs = [...defs].some(name => usedAfter.has(name));

         if (!liveDefs && !hasSideEffects) {
            // Drop the local entirely; since it is removed, do not add its reads.
            continue;
         }

         // used_before = reads ∪ (used_after − defs)
         const nextUsed = new Set<string>();
         used.forEach(name => {
            if (!defs.has(name))
               nextUsed.add(name);
         });
         reads.forEach(name => nextUsed.add(name));
         used.clear();
         nextUsed.forEach(name => used.add(name));

         kept.push(stmt);
         continue;
      }

      // Generic statement: used_before = reads ∪ (used_after − defs)
      const nextUsed = new Set<string>();
      used.forEach(name => {
         if (!defs.has(name))
            nextUsed.add(name);
      });
      reads.forEach(name => nextUsed.add(name));
      used.clear();
      nextUsed.forEach(name => used.add(name));

      kept.push(stmt);
   }

   kept.reverse();
   return kept;
}

export function removeUnusedLocalsInAST(ast: luaparse.Chunk): luaparse.Chunk {
   ast.body = removeUnusedLocalsInBlock(ast.body);
   return ast;
}
