// as-is, this is not as helpful as i was hoping.
// the problem is that it doesn't track field usage through nested tables or passed around between
// scopes. so it's almost rare that a field would be eligible. for example,
/*

local function getTable()
  return {
    fieldA = 1,
    fieldB = 2
  }
end

local t = getTable()


this won't minify at all, because the table is created in one function and used in another.
we would need to follow data flow across function boundaries to track that, which is a lot more complex.

*/

import * as luaparse from "luaparse";
import {isStringLiteral, nextFreeName, stringValue} from "./lua_utils";

type Candidate = {
   name: string; ctor: luaparse.TableConstructorExpression; fields: Set<string>; disqualified: boolean;
   mapping: Map<string, string>;
};

function recordCtorFields(candidate: Candidate): void {
   candidate.ctor.fields.forEach(field => {
      if (field.type === "TableKeyString") {
         if (field.key && field.key.type === "Identifier")
            candidate.fields.add(field.key.name);
         else if (isStringLiteral(field.key)) {
            const val = stringValue(field.key as luaparse.StringLiteral);
            if (val != null)
               candidate.fields.add(val);
         }
      }
   });
}

function scanExpression(expr: luaparse.Expression, candidates: Map<string, Candidate>, inFunction: boolean): void {
   switch (expr.type) {
      case "Identifier": {
         const cand = candidates.get(expr.name);
         if (cand && !cand.disqualified)
            cand.disqualified = true; // bare use / escape
         return;
      }

      case "MemberExpression": {
         if (expr.base.type === "Identifier") {
            const cand = candidates.get(expr.base.name);
            if (cand && !cand.disqualified) {
               if (inFunction) {
                  cand.disqualified = true;
                  return;
               }
               const id = expr.identifier;
               if (id && id.type === "Identifier") {
                  cand.fields.add(id.name);
                  return;
               }
               cand.disqualified = true;
               return;
            }
         }
         scanExpression(expr.base, candidates, inFunction);
         return;
      }

      case "IndexExpression": {
         if (expr.base.type === "Identifier") {
            const cand = candidates.get(expr.base.name);
            if (cand && !cand.disqualified) {
               if (inFunction) {
                  cand.disqualified = true;
                  return;
               }
               if (isStringLiteral(expr.index)) {
                  const val = stringValue(expr.index as luaparse.StringLiteral);
                  if (val != null)
                     cand.fields.add(val);
                  else
                     cand.disqualified = true;
               } else {
                  cand.disqualified = true;
               }
               return;
            }
         }
         scanExpression(expr.base, candidates, inFunction);
         scanExpression(expr.index, candidates, inFunction);
         return;
      }

      case "TableConstructorExpression": {
         expr.fields.forEach(field => {
            if (field.type === "TableKey" || field.type === "TableKeyString") {
               if (field.key)
                  scanExpression(field.key, candidates, inFunction);
               if (field.value)
                  scanExpression(field.value, candidates, inFunction);
            } else if (field.type === "TableValue" && field.value) {
               scanExpression(field.value, candidates, inFunction);
            }
         });
         return;
      }

      case "FunctionDeclaration": {
         expr.body.forEach(stmt => scanStatement(stmt, candidates, true));
         return;
      }

      case "BinaryExpression":
      case "LogicalExpression":
         scanExpression(expr.left, candidates, inFunction);
         scanExpression(expr.right, candidates, inFunction);
         return;

      case "UnaryExpression":
         scanExpression(expr.argument, candidates, inFunction);
         return;

      case "CallExpression": {
         scanExpression(expr.base, candidates, inFunction);
         expr.arguments.forEach(arg => scanExpression(arg, candidates, inFunction));
         return;
      }

      case "TableCallExpression": {
         scanExpression(expr.base, candidates, inFunction);
         scanExpression(expr.arguments as luaparse.Expression, candidates, inFunction);
         return;
      }

      case "StringCallExpression": {
         scanExpression(expr.base, candidates, inFunction);
         scanExpression(expr.argument as luaparse.Expression, candidates, inFunction);
         return;
      }

      default:
         return;
   }
}

function scanStatement(stmt: luaparse.Statement, candidates: Map<string, Candidate>, inFunction: boolean): void {
   switch (stmt.type) {
      case "LocalStatement": {
         if (stmt.init)
            stmt.init.forEach(expr => scanExpression(expr, candidates, inFunction));
         return;
      }

      case "AssignmentStatement": {
         stmt.variables.forEach(v => scanExpression(v as luaparse.Expression, candidates, inFunction));
         stmt.init.forEach(expr => scanExpression(expr, candidates, inFunction));
         return;
      }

      case "CallStatement":
         scanExpression(stmt.expression, candidates, inFunction);
         return;

      case "ReturnStatement":
         stmt.arguments.forEach(arg => scanExpression(arg, candidates, inFunction));
         return;

      case "IfStatement":
         stmt.clauses.forEach(clause => {
            if ("condition" in clause && clause.condition)
               scanExpression(clause.condition, candidates, inFunction);
            clause.body.forEach(s => scanStatement(s, candidates, inFunction));
         });
         return;

      case "WhileStatement":
         scanExpression(stmt.condition, candidates, inFunction);
         stmt.body.forEach(s => scanStatement(s, candidates, inFunction));
         return;

      case "RepeatStatement":
         stmt.body.forEach(s => scanStatement(s, candidates, inFunction));
         scanExpression(stmt.condition, candidates, inFunction);
         return;

      case "ForNumericStatement":
         scanExpression(stmt.start, candidates, inFunction);
         scanExpression(stmt.end, candidates, inFunction);
         if (stmt.step)
            scanExpression(stmt.step, candidates, inFunction);
         stmt.body.forEach(s => scanStatement(s, candidates, inFunction));
         return;

      case "ForGenericStatement":
         stmt.iterators.forEach(it => scanExpression(it, candidates, inFunction));
         stmt.body.forEach(s => scanStatement(s, candidates, inFunction));
         return;

      case "FunctionDeclaration": {
         // scan body as nested function (outer candidates escape)
         stmt.body.forEach(s => scanStatement(s, candidates, true));
         return;
      }

      case "DoStatement":
         stmt.body.forEach(s => scanStatement(s, candidates, inFunction));
         return;

      default:
         return;
   }
}

function rewriteExpression(expr: luaparse.Expression, candidates: Map<string, Candidate>): void {
   switch (expr.type) {
      case "MemberExpression": {
         if (expr.base.type === "Identifier") {
            const cand = candidates.get(expr.base.name);
            if (cand && !cand.disqualified) {
               const id = expr.identifier;
               if (id && id.type === "Identifier") {
                  const mapped = cand.mapping.get(id.name);
                  if (mapped)
                     id.name = mapped;
               }
               return;
            }
         }
         rewriteExpression(expr.base, candidates);
         return;
      }

      case "IndexExpression": {
         if (expr.base.type === "Identifier") {
            const cand = candidates.get(expr.base.name);
            if (cand && !cand.disqualified && isStringLiteral(expr.index)) {
               const val = stringValue(expr.index as luaparse.StringLiteral);
               if (val != null) {
                  const mapped = cand.mapping.get(val);
                  if (mapped) {
                     expr.index = {type: "StringLiteral", value: mapped, raw: JSON.stringify(mapped)} as any;
                     return;
                  }
               }
            }
         }
         rewriteExpression(expr.base, candidates);
         rewriteExpression(expr.index, candidates);
         return;
      }

      case "TableConstructorExpression": {
         expr.fields.forEach(field => {
            if (field.type === "TableKeyString") {
               if (field.value)
                  rewriteExpression(field.value, candidates);
               if (field.key) {
                  if (field.key.type === "Identifier") {
                     // key of a string field is not an expression; nothing to rewrite
                  } else if (isStringLiteral(field.key)) {
                     // literal key stays unless constructor itself is rewritten via mapping
                  }
               }
            } else if (field.type === "TableKey") {
               if (field.key)
                  rewriteExpression(field.key, candidates);
               if (field.value)
                  rewriteExpression(field.value, candidates);
            } else if (field.type === "TableValue" && field.value) {
               rewriteExpression(field.value, candidates);
            }
         });
         return;
      }

      case "BinaryExpression":
      case "LogicalExpression":
         rewriteExpression(expr.left, candidates);
         rewriteExpression(expr.right, candidates);
         return;

      case "UnaryExpression":
         rewriteExpression(expr.argument, candidates);
         return;

      case "CallExpression": {
         rewriteExpression(expr.base, candidates);
         expr.arguments.forEach(arg => rewriteExpression(arg, candidates));
         return;
      }

      case "TableCallExpression": {
         rewriteExpression(expr.base, candidates);
         rewriteExpression(expr.arguments as luaparse.Expression, candidates);
         return;
      }

      case "StringCallExpression": {
         rewriteExpression(expr.base, candidates);
         rewriteExpression(expr.argument as luaparse.Expression, candidates);
         return;
      }

      case "FunctionDeclaration":
         expr.body.forEach(stmt => rewriteStatement(stmt, candidates));
         return;

      default:
         return;
   }
}

function rewriteStatement(stmt: luaparse.Statement, candidates: Map<string, Candidate>): void {
   switch (stmt.type) {
      case "LocalStatement":
         if (stmt.init)
            stmt.init.forEach(expr => rewriteExpression(expr, candidates));
         return;

      case "AssignmentStatement":
         stmt.variables.forEach(v => rewriteExpression(v as luaparse.Expression, candidates));
         stmt.init.forEach(expr => rewriteExpression(expr, candidates));
         return;

      case "CallStatement":
         rewriteExpression(stmt.expression, candidates);
         return;

      case "ReturnStatement":
         stmt.arguments.forEach(arg => rewriteExpression(arg, candidates));
         return;

      case "IfStatement":
         stmt.clauses.forEach(clause => {
            if ("condition" in clause && clause.condition)
               rewriteExpression(clause.condition, candidates);
            clause.body.forEach(s => rewriteStatement(s, candidates));
         });
         return;

      case "WhileStatement":
         rewriteExpression(stmt.condition, candidates);
         stmt.body.forEach(s => rewriteStatement(s, candidates));
         return;

      case "RepeatStatement":
         stmt.body.forEach(s => rewriteStatement(s, candidates));
         rewriteExpression(stmt.condition, candidates);
         return;

      case "ForNumericStatement":
         rewriteExpression(stmt.start, candidates);
         rewriteExpression(stmt.end, candidates);
         if (stmt.step)
            rewriteExpression(stmt.step, candidates);
         stmt.body.forEach(s => rewriteStatement(s, candidates));
         return;

      case "ForGenericStatement":
         stmt.iterators.forEach(it => rewriteExpression(it, candidates));
         stmt.body.forEach(s => rewriteStatement(s, candidates));
         return;

      case "FunctionDeclaration":
         stmt.body.forEach(s => rewriteStatement(s, candidates));
         return;

      case "DoStatement":
         stmt.body.forEach(s => rewriteStatement(s, candidates));
         return;

      default:
         return;
   }
}

function rewriteConstructors(candidates: Map<string, Candidate>): void {
   candidates.forEach(cand => {
      if (cand.disqualified)
         return;
      cand.ctor.fields.forEach(field => {
         if (field.type === "TableKeyString" && field.key) {
            if (field.key.type === "Identifier") {
               const mapped = cand.mapping.get(field.key.name);
               if (mapped)
                  field.key.name = mapped;
            } else if (isStringLiteral(field.key)) {
               const val = stringValue(field.key as luaparse.StringLiteral);
               if (val != null) {
                  const mapped = cand.mapping.get(val);
                  if (mapped) {
                     (field.key as luaparse.StringLiteral).value = mapped;
                     (field.key as luaparse.StringLiteral).raw = JSON.stringify(mapped);
                  }
               }
            }
         }
      });
   });
}

function collectCandidates(chunk: luaparse.Chunk): Map<string, Candidate> {
   const candidates = new Map<string, Candidate>();

   function visitStatement(stmt: luaparse.Statement): void {
      if (stmt.type === "LocalStatement" && stmt.init) {
         stmt.variables.forEach((v, idx) => {
            if (v.type === "Identifier") {
               const init = stmt.init ? stmt.init[idx] : undefined;
               if (init && init.type === "TableConstructorExpression") {
                  const cand: Candidate = {
                     name: v.name,
                     ctor: init,
                     fields: new Set<string>(),
                     disqualified: false,
                     mapping: new Map<string, string>(),
                  };
                  recordCtorFields(cand);
                  const existing = candidates.get(v.name);
                  if (existing) {
                     existing.disqualified = true;
                     cand.disqualified = true;
                  }
                  candidates.set(v.name, cand);
               }
            }
         });
      }

      switch (stmt.type) {
         case "IfStatement":
            stmt.clauses.forEach(clause => clause.body.forEach(visitStatement));
            break;
         case "WhileStatement":
         case "RepeatStatement":
         case "ForNumericStatement":
         case "ForGenericStatement":
         case "DoStatement":
            stmt.body.forEach(visitStatement);
            break;
         case "FunctionDeclaration":
            stmt.body.forEach(visitStatement);
            break;
         default:
            break;
      }
   }

   chunk.body.forEach(visitStatement);
   return candidates;
}

export function renameTableFieldsInAST(ast: luaparse.Chunk): luaparse.Chunk {
   const candidates = collectCandidates(ast);
   if (candidates.size === 0)
      return ast;

   // Disqualify and gather field usages
   ast.body.forEach(stmt => scanStatement(stmt, candidates, false));

   // Build mappings for survivors
   const counter = {value: 0};
   candidates.forEach(cand => {
      if (cand.disqualified)
         return;
      cand.fields.forEach(field => {
         if (!cand.mapping.has(field))
            cand.mapping.set(field, nextFreeName(counter));
      });
   });

   rewriteConstructors(candidates);
   ast.body.forEach(stmt => rewriteStatement(stmt, candidates));

   return ast;
}
