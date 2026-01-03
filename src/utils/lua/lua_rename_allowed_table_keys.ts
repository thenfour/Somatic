import * as luaparse from "luaparse";
import {LUA_RESERVED_WORDS} from "./lua_ast";
import {isStringLiteral, nextFreeName, stringValue} from "./lua_utils";

function rewriteExpression(expr: luaparse.Expression, mapping: Map<string, string>): void {
   switch (expr.type) {
      case "Identifier":
         return;

      case "MemberExpression": {
         if (expr.identifier && expr.identifier.type === "Identifier") {
            const mapped = mapping.get(expr.identifier.name);
            if (mapped)
               expr.identifier.name = mapped;
         }
         rewriteExpression(expr.base, mapping);
         return;
      }

      case "IndexExpression": {
         rewriteExpression(expr.base, mapping);
         rewriteExpression(expr.index, mapping);
         if (isStringLiteral(expr.index)) {
            const val = stringValue(expr.index);
            if (val != null) {
               const mapped = mapping.get(val);
               if (mapped) {
                  expr.index = {type: "StringLiteral", value: mapped, raw: JSON.stringify(mapped)} as any;
               }
            }
         }
         return;
      }

      case "CallExpression":
         rewriteExpression(expr.base, mapping);
         expr.arguments.forEach(arg => rewriteExpression(arg, mapping));
         return;

      case "TableCallExpression":
         rewriteExpression(expr.base, mapping);
         rewriteExpression(expr.arguments as luaparse.Expression, mapping);
         return;

      case "StringCallExpression":
         rewriteExpression(expr.base, mapping);
         rewriteExpression(expr.argument as luaparse.Expression, mapping);
         return;

      case "BinaryExpression":
      case "LogicalExpression":
         rewriteExpression(expr.left, mapping);
         rewriteExpression(expr.right, mapping);
         return;

      case "UnaryExpression":
         rewriteExpression(expr.argument, mapping);
         return;

      case "FunctionDeclaration":
         expr.body.forEach(stmt => rewriteStatement(stmt, mapping));
         return;

      case "TableConstructorExpression": {
         expr.fields.forEach(field => {
            if (field.type === "TableKeyString" && field.key) {
               if (field.key.type === "Identifier") {
                  const mapped = mapping.get(field.key.name);
                  if (mapped)
                     field.key.name = mapped;
               } else if (isStringLiteral(field.key)) {
                  const val = stringValue(field.key as luaparse.StringLiteral);
                  if (val != null) {
                     const mapped = mapping.get(val);
                     if (mapped) {
                        (field.key as luaparse.StringLiteral).value = mapped;
                        (field.key as luaparse.StringLiteral).raw = JSON.stringify(mapped);
                     }
                  }
               }
               if (field.value)
                  rewriteExpression(field.value, mapping);
            } else if (field.type === "TableKey") {
               if (field.key)
                  rewriteExpression(field.key, mapping);
               if (field.value)
                  rewriteExpression(field.value, mapping);
            } else if (field.type === "TableValue" && field.value) {
               rewriteExpression(field.value, mapping);
            }
         });
         return;
      }

      default:
         return;
   }
}

function rewriteStatement(stmt: luaparse.Statement, mapping: Map<string, string>): void {
   switch (stmt.type) {
      case "LocalStatement":
         if (stmt.init)
            stmt.init.forEach(expr => rewriteExpression(expr, mapping));
         return;

      case "AssignmentStatement":
         stmt.variables.forEach(v => rewriteExpression(v as luaparse.Expression, mapping));
         stmt.init.forEach(expr => rewriteExpression(expr, mapping));
         return;

      case "CallStatement":
         rewriteExpression(stmt.expression, mapping);
         return;

      case "ReturnStatement":
         stmt.arguments.forEach(arg => rewriteExpression(arg, mapping));
         return;

      case "IfStatement":
         stmt.clauses.forEach(clause => {
            if (clause.type !== "ElseClause" && clause.condition)
               rewriteExpression(clause.condition, mapping);
            clause.body.forEach(s => rewriteStatement(s, mapping));
         });
         return;

      case "WhileStatement":
         rewriteExpression(stmt.condition, mapping);
         stmt.body.forEach(s => rewriteStatement(s, mapping));
         return;

      case "RepeatStatement":
         stmt.body.forEach(s => rewriteStatement(s, mapping));
         rewriteExpression(stmt.condition, mapping);
         return;

      case "ForNumericStatement":
         rewriteExpression(stmt.start, mapping);
         rewriteExpression(stmt.end, mapping);
         if (stmt.step)
            rewriteExpression(stmt.step, mapping);
         stmt.body.forEach(s => rewriteStatement(s, mapping));
         return;

      case "ForGenericStatement":
         stmt.iterators.forEach(it => rewriteExpression(it, mapping));
         stmt.body.forEach(s => rewriteStatement(s, mapping));
         return;

      case "FunctionDeclaration":
         stmt.body.forEach(s => rewriteStatement(s, mapping));
         return;

      case "DoStatement":
         stmt.body.forEach(s => rewriteStatement(s, mapping));
         return;

      default:
         return;
   }
}

export function renameAllowedTableKeysInAST(ast: luaparse.Chunk, keys: string[]|undefined|null): luaparse.Chunk {
   const allow = Array.isArray(keys) ? keys.filter(Boolean) : [];
   if (allow.length === 0)
      return ast;

   const mapping = new Map<string, string>();
   const counter = {value: 0};
   for (const key of allow) {
      if (!mapping.has(key))
         mapping.set(key, nextFreeName(counter));
   }

   ast.body.forEach(stmt => rewriteStatement(stmt, mapping));
   return ast;
}