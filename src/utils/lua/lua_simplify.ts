import * as luaparse from "luaparse";
import {LiteralNode, StringLiteralNode, stringValue} from "./lua_utils";


type ConstEnv = Map<string, LiteralNode>;

type PropScope = {
   env: ConstEnv; locals: Set<string>;
};

// Collect identifiers that are written/introduced within a statement.
// We only track plain identifiers (not table fields) because we propagate
// only plain locals; member/index writes are treated conservatively later.
function collectWrites(stmt: luaparse.Statement, out: Set<string>): void {
   switch (stmt.type) {
      case "LocalStatement": {
         stmt.variables.forEach(v => {
            if (v.type === "Identifier")
               out.add(v.name);
         });
         break;
      }

      case "AssignmentStatement": {
         stmt.variables.forEach(v => {
            if (v.type === "Identifier")
               out.add(v.name);
         });
         break;
      }

      case "ForNumericStatement": {
         if (stmt.variable.type === "Identifier")
            out.add(stmt.variable.name);
         stmt.body.forEach(s => collectWrites(s, out));
         break;
      }

      case "ForGenericStatement": {
         stmt.variables.forEach(v => {
            if (v.type === "Identifier")
               out.add(v.name);
         });
         stmt.body.forEach(s => collectWrites(s, out));
         break;
      }

      case "WhileStatement":
      case "RepeatStatement":
      case "IfStatement":
      case "DoStatement":
      case "FunctionDeclaration": {
         // Recurse into bodies/clauses to collect inner writes.
         const bodies: luaparse.Statement[][] = [];
         if (stmt.type === "WhileStatement" || stmt.type === "DoStatement") {
            bodies.push(stmt.body);
         } else if (stmt.type === "RepeatStatement") {
            bodies.push(stmt.body);
         } else if (stmt.type === "IfStatement") {
            stmt.clauses.forEach(c => bodies.push(c.body));
         } else if (stmt.type === "FunctionDeclaration") {
            bodies.push(stmt.body);
         }
         bodies.forEach(b => b.forEach(s => collectWrites(s, out)));
         break;
      }

      default:
         break;
   }
}

function collectBlockWrites(body: luaparse.Statement[]): Set<string> {
   const writes = new Set<string>();
   body.forEach(stmt => collectWrites(stmt, writes));
   return writes;
}

function cloneScope(scope: PropScope): PropScope {
   return {env: new Map(scope.env), locals: new Set(scope.locals)};
}

function freshScope(): PropScope {
   return {env: new Map(), locals: new Set()};
}

function makeNumericLiteral(value: number): luaparse.NumericLiteral {
   return {type: "NumericLiteral", value, raw: String(value)};
}

function makeBooleanLiteral(value: boolean): luaparse.BooleanLiteral {
   return {type: "BooleanLiteral", value, raw: value ? "true" : "false"};
}

function makeStringLiteral(value: string): StringLiteralNode {
   return {type: "StringLiteral", value, raw: JSON.stringify(value)};
}

function makeNilLiteral(): luaparse.NilLiteral {
   return {type: "NilLiteral", value: null, raw: "nil"};
}

function cloneLiteral(lit: LiteralNode): LiteralNode {
   switch (lit.type) {
      case "NumericLiteral":
         return {...lit};
      case "BooleanLiteral":
         return {...lit};
      case "NilLiteral":
         return {...lit};
      case "StringLiteral": {
         const str = lit as StringLiteralNode;
         return {type: "StringLiteral", value: str.value, raw: str.raw};
      }
      default:
         return lit;
   }
}

function isLiteral(expr: luaparse.Expression|null|undefined): expr is LiteralNode {
   if (!expr)
      return false;
   switch (expr.type) {
      case "NumericLiteral":
      case "BooleanLiteral":
      case "NilLiteral":
      case "StringLiteral":
         return true;
      default:
         return false;
   }
}

function missingInitDefaultsToNil(init: luaparse.Expression[]|undefined): boolean {
   if (!init || init.length === 0)
      return true;
   const last = init[init.length - 1];
   return last.type !== "CallExpression" && last.type !== "TableCallExpression" &&
      last.type !== "StringCallExpression" && last.type !== "VarargLiteral";
}

function literalEquals(a: LiteralNode, b: LiteralNode): boolean {
   if (a.type === "NilLiteral")
      return b.type === "NilLiteral";
   if (a.type === "BooleanLiteral" && b.type === "BooleanLiteral")
      return a.value === b.value;
   if (a.type === "NumericLiteral" && b.type === "NumericLiteral")
      return a.value === b.value;
   if (a.type === "StringLiteral" && b.type === "StringLiteral")
      return stringValue(a as StringLiteralNode) === stringValue(b as StringLiteralNode);
   return false;
}

function isTruthy(lit: LiteralNode): boolean {
   if (lit.type === "NilLiteral")
      return false;
   if (lit.type === "BooleanLiteral" && lit.value === false)
      return false;
   return true;
}

function toNumber(expr: LiteralNode): number|null {
   return expr.type === "NumericLiteral" ? expr.value : null;
}

function toStringLiteral(expr: LiteralNode): StringLiteralNode|null {
   return expr.type === "StringLiteral" ? (expr as StringLiteralNode) : null;
}

function foldBinary(operator: string, left: LiteralNode, right: LiteralNode): LiteralNode|null {
   switch (operator) {
      case "+": {
         const a = toNumber(left);
         const b = toNumber(right);
         if (a == null || b == null)
            return null;
         return makeNumericLiteral(a + b);
      }
      case "-": {
         const a = toNumber(left);
         const b = toNumber(right);
         if (a == null || b == null)
            return null;
         return makeNumericLiteral(a - b);
      }
      case "*": {
         const a = toNumber(left);
         const b = toNumber(right);
         if (a == null || b == null)
            return null;
         return makeNumericLiteral(a * b);
      }
      case "/": {
         const a = toNumber(left);
         const b = toNumber(right);
         if (a == null || b == null)
            return null;
         return makeNumericLiteral(a / b);
      }
      case "//": {
         const a = toNumber(left);
         const b = toNumber(right);
         if (a == null || b == null)
            return null;
         return makeNumericLiteral(Math.floor(a / b));
      }
      case "%": {
         const a = toNumber(left);
         const b = toNumber(right);
         if (a == null || b == null)
            return null;
         return makeNumericLiteral(a - Math.floor(a / b) * b);
      }
      case "^": {
         const a = toNumber(left);
         const b = toNumber(right);
         if (a == null || b == null)
            return null;
         return makeNumericLiteral(Math.pow(a, b));
      }
      case "..": {
         const s1 = toStringLiteral(left);
         const s2 = toStringLiteral(right);
         if (!s1 || !s2)
            return null;
         const v1 = stringValue(s1);
         const v2 = stringValue(s2);
         if (v1 == null || v2 == null)
            return null;
         return makeStringLiteral(v1 + v2);
      }
      case "==":
         return makeBooleanLiteral(literalEquals(left, right));
      case "~=":
         return makeBooleanLiteral(!literalEquals(left, right));
      case "<": {
         const a = toNumber(left);
         const b = toNumber(right);
         if (a == null || b == null)
            return null;
         return makeBooleanLiteral(a < b);
      }
      case "<=": {
         const a = toNumber(left);
         const b = toNumber(right);
         if (a == null || b == null)
            return null;
         return makeBooleanLiteral(a <= b);
      }
      case ">": {
         const a = toNumber(left);
         const b = toNumber(right);
         if (a == null || b == null)
            return null;
         return makeBooleanLiteral(a > b);
      }
      case ">=": {
         const a = toNumber(left);
         const b = toNumber(right);
         if (a == null || b == null)
            return null;
         return makeBooleanLiteral(a >= b);
      }
      default:
         return null;
   }
}

function simplifyExpression(expr: luaparse.Expression, scope: PropScope): luaparse.Expression {
   switch (expr.type) {
      case "Identifier": {
         const replacement = scope.env.get(expr.name);
         return replacement ? cloneLiteral(replacement) : expr;
      }

      case "UnaryExpression": {
         expr.argument = simplifyExpression(expr.argument, scope);
         if (isLiteral(expr.argument)) {
            if (expr.operator === "-") {
               const n = toNumber(expr.argument);
               if (n != null)
                  return makeNumericLiteral(-n);
            } else if (expr.operator === "not") {
               return makeBooleanLiteral(!isTruthy(expr.argument));
            }
         }
         return expr;
      }

      case "BinaryExpression": {
         expr.left = simplifyExpression(expr.left, scope);
         expr.right = simplifyExpression(expr.right, scope);
         if (isLiteral(expr.left) && isLiteral(expr.right)) {
            const folded = foldBinary(expr.operator, expr.left, expr.right);
            if (folded)
               return folded;
         }
         return expr;
      }

      case "LogicalExpression": {
         expr.left = simplifyExpression(expr.left, scope);
         if (isLiteral(expr.left)) {
            if (expr.operator === "and") {
               if (!isTruthy(expr.left))
                  return cloneLiteral(expr.left);
               expr.right = simplifyExpression(expr.right, scope);
               return expr.right;
            } else if (expr.operator === "or") {
               if (isTruthy(expr.left))
                  return cloneLiteral(expr.left);
               expr.right = simplifyExpression(expr.right, scope);
               return expr.right;
            }
         }
         expr.right = simplifyExpression(expr.right, scope);
         if (isLiteral(expr.left) && isLiteral(expr.right)) {
            const result = expr.operator === "and" ? (isTruthy(expr.left) ? expr.right : expr.left) :
                                                     (isTruthy(expr.left) ? expr.left : expr.right);
            return isLiteral(result) ? cloneLiteral(result) : result;
         }
         return expr;
      }

      case "CallExpression": {
         expr.base = simplifyExpression(expr.base, scope);
         expr.arguments = expr.arguments.map(arg => simplifyExpression(arg, scope));
         return expr;
      }

      case "TableCallExpression": {
         expr.base = simplifyExpression(expr.base, scope);
         expr.arguments = simplifyExpression(expr.arguments, scope) as luaparse.TableConstructorExpression;
         return expr;
      }

      case "StringCallExpression": {
         expr.base = simplifyExpression(expr.base, scope);
         return expr;
      }

      case "MemberExpression": {
         expr.base = simplifyExpression(expr.base, scope);
         return expr;
      }

      case "IndexExpression": {
         expr.base = simplifyExpression(expr.base, scope);
         expr.index = simplifyExpression(expr.index, scope);
         return expr;
      }

      case "TableConstructorExpression": {
         expr.fields.forEach(field => {
            if (field.type === "TableKey" || field.type === "TableKeyString") {
               if (field.key)
                  field.key = simplifyExpression(field.key, scope);
               if (field.value)
                  field.value = simplifyExpression(field.value, scope);
            } else if (field.type === "TableValue" && field.value) {
               field.value = simplifyExpression(field.value, scope);
            }
         });
         return expr;
      }

      case "FunctionDeclaration": {
         const bodyScope = freshScope();
         for (const param of expr.parameters) {
            if (param.type === "Identifier")
               bodyScope.locals.add(param.name);
         }
         simplifyBlock(expr.body, bodyScope);
         return expr;
      }

      default:
         return expr;
   }
}

// Detect whether an expression references a given identifier name.
function referencesIdentifier(expr: luaparse.Expression, name: string): boolean {
   switch (expr.type) {
      case "Identifier":
         return expr.name === name;
      case "UnaryExpression":
         return referencesIdentifier(expr.argument, name);
      case "BinaryExpression":
      case "LogicalExpression":
         return referencesIdentifier(expr.left, name) || referencesIdentifier(expr.right, name);
      case "CallExpression":
         return referencesIdentifier(expr.base, name) || expr.arguments.some(arg => referencesIdentifier(arg, name));
      case "TableCallExpression":
         return referencesIdentifier(expr.base, name) || referencesIdentifier(expr.arguments, name);
      case "StringCallExpression":
         return referencesIdentifier(expr.base, name);
      case "MemberExpression":
         return referencesIdentifier(expr.base, name) ||
            (expr.identifier ? referencesIdentifier(expr.identifier as any, name) : false);
      case "IndexExpression":
         return referencesIdentifier(expr.base, name) || referencesIdentifier(expr.index, name);
      case "TableConstructorExpression":
         return expr.fields.some(field => {
            if (field.type === "TableKey" || field.type === "TableKeyString") {
               return (field.key && referencesIdentifier(field.key, name)) ||
                  (field.value && referencesIdentifier(field.value, name));
            } else if (field.type === "TableValue") {
               return field.value ? referencesIdentifier(field.value, name) : false;
            }
            return false;
         });
      default:
         return false;
   }
}

function simplifyStatement(stmt: luaparse.Statement, scope: PropScope): void {
   switch (stmt.type) {
      case "LocalStatement": {
         const simplifiedInit = stmt.init ? stmt.init.map(expr => simplifyExpression(expr, scope)) : undefined;
         if (simplifiedInit)
            stmt.init = simplifiedInit;
         const defaultMissingToNil = missingInitDefaultsToNil(simplifiedInit);
         stmt.variables.forEach((variable, idx) => {
            if (variable.type !== "Identifier")
               return;
            scope.locals.add(variable.name);
            const initExpr = simplifiedInit ? simplifiedInit[idx] : undefined;
            const literal =
               initExpr ? (isLiteral(initExpr) ? initExpr : null) : (defaultMissingToNil ? makeNilLiteral() : null);
            if (literal)
               scope.env.set(variable.name, literal as LiteralNode);
            else
               scope.env.delete(variable.name);
         });
         break;
      }

      case "AssignmentStatement": {
         const originalInit = stmt.init.slice();
         const simplifiedInit: luaparse.Expression[] = originalInit.map((expr, idx) => {
            const variable = stmt.variables[idx];
            if (variable && variable.type === "Identifier" && expr) {
               const rhsUsesLhs = referencesIdentifier(expr, variable.name);
               if (rhsUsesLhs) {
                  const scoped = cloneScope(scope);
                  scoped.env.delete(variable.name);
                  return simplifyExpression(expr, scoped);
               }
            }
            return simplifyExpression(expr, scope);
         });
         stmt.init = simplifiedInit;
         const defaultMissingToNil = missingInitDefaultsToNil(simplifiedInit);
         stmt.variables.forEach((variable, idx) => {
            if (variable.type !== "Identifier")
               return;
            if (!scope.locals.has(variable.name)) {
               scope.env.delete(variable.name);
               return;
            }
            const initExpr = simplifiedInit[idx];

            // If RHS references the LHS (self-update) or is non-literal, drop from env.
            const rhsUsesLhs = originalInit[idx] && referencesIdentifier(originalInit[idx], variable.name);
            const literal = !rhsUsesLhs && initExpr ? (isLiteral(initExpr) ? initExpr : null) :
                                                      (!initExpr && defaultMissingToNil ? makeNilLiteral() : null);

            if (literal)
               scope.env.set(variable.name, literal as LiteralNode);
            else
               scope.env.delete(variable.name);
         });
         break;
      }

      case "CallStatement": {
         stmt.expression = simplifyExpression(stmt.expression, scope) as luaparse.CallExpression |
            luaparse.TableCallExpression | luaparse.StringCallExpression;
         break;
      }

      case "ReturnStatement": {
         stmt.arguments = stmt.arguments.map(arg => simplifyExpression(arg, scope));
         break;
      }

      case "IfStatement": {
         const writes = new Set<string>();
         for (const clause of stmt.clauses) {
            if (clause.type !== "ElseClause" && clause.condition)
               clause.condition = simplifyExpression(clause.condition, scope);
            const innerScope = cloneScope(scope);
            simplifyBlock(clause.body, innerScope);
            clause.body.forEach(s => collectWrites(s, writes));
         }
         writes.forEach(name => scope.env.delete(name));
         break;
      }

      case "WhileStatement": {
         const bodyWrites = collectBlockWrites(stmt.body);
         bodyWrites.forEach(name => scope.env.delete(name));
         const condScope = cloneScope(scope);
         condScope.env = new Map(); // avoid propagating locals into loop conditions
         stmt.condition = simplifyExpression(stmt.condition, condScope);
         const inner = cloneScope(scope);
         simplifyBlock(stmt.body, inner);
         bodyWrites.forEach(name => scope.env.delete(name));
         break;
      }

      case "RepeatStatement": {
         const bodyWrites = collectBlockWrites(stmt.body);
         bodyWrites.forEach(name => scope.env.delete(name));
         const inner = cloneScope(scope);
         simplifyBlock(stmt.body, inner);
         const condScope = cloneScope(scope);
         condScope.env = new Map();
         stmt.condition = simplifyExpression(stmt.condition, condScope);
         bodyWrites.forEach(name => scope.env.delete(name));
         break;
      }

      case "ForNumericStatement": {
         const bodyWrites = collectBlockWrites(stmt.body);
         bodyWrites.forEach(name => scope.env.delete(name));
         stmt.start = simplifyExpression(stmt.start, scope);
         stmt.end = simplifyExpression(stmt.end, scope);
         if (stmt.step)
            stmt.step = simplifyExpression(stmt.step, scope);
         const bodyScope = cloneScope(scope);
         if (stmt.variable.type === "Identifier") {
            bodyScope.locals.add(stmt.variable.name);
            bodyScope.env.delete(stmt.variable.name);
            scope.env.delete(stmt.variable.name); // do not treat loop var as const outside
         }
         simplifyBlock(stmt.body, bodyScope);
         bodyWrites.forEach(name => scope.env.delete(name));
         break;
      }

      case "ForGenericStatement": {
         const bodyWrites = collectBlockWrites(stmt.body);
         bodyWrites.forEach(name => scope.env.delete(name));
         stmt.iterators = stmt.iterators.map(it => simplifyExpression(it, scope));
         const bodyScope = cloneScope(scope);
         stmt.variables.forEach(v => {
            if (v.type === "Identifier") {
               bodyScope.locals.add(v.name);
               bodyScope.env.delete(v.name);
               scope.env.delete(v.name);
            }
         });
         simplifyBlock(stmt.body, bodyScope);
         bodyWrites.forEach(name => scope.env.delete(name));
         break;
      }

      case "FunctionDeclaration": {
         const bodyScope = freshScope();
         stmt.parameters.forEach(param => {
            if (param.type === "Identifier")
               bodyScope.locals.add(param.name);
         });
         simplifyBlock(stmt.body, bodyScope);
         break;
      }

      case "DoStatement": {
         simplifyBlock(stmt.body, cloneScope(scope));
         break;
      }

      default:
         break;
   }
}

function simplifyBlock(body: luaparse.Statement[], scope: PropScope): void {
   for (const stmt of body) {
      simplifyStatement(stmt, scope);
   }
}

export function simplifyExpressionsInAST(ast: luaparse.Chunk): luaparse.Chunk {
   simplifyBlock(ast.body, freshScope());
   return ast;
}
