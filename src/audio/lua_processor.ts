
import * as luaparse from "luaparse";
import {toLuaStringLiteral} from "../utils/utils";


// Precedence tables, low → high
const LOGICAL_PRECEDENCE: Record<string, number> = {
   or: 1,
   and: 2,
};

const BINARY_PRECEDENCE: Record<string, number> = {
   "<": 3,
   ">": 3,
   "<=": 3,
   ">=": 3,
   "~=": 3,
   "==": 3,
   "|": 4,
   "~": 5,
   "&": 6,
   "<<": 7,
   ">>": 7,
   "..": 8, // right associative
   "+": 9,
   "-": 9,
   "*": 10,
   "/": 10,
   "//": 10,
   "%": 10,
};

const UNARY_PRECEDENCE = 11; // not, #, -, ~
const POW_PRECEDENCE = 12;   // ^

function getPrecedence(node: luaparse.Expression): number {
   switch (node.type) {
      case "LogicalExpression":
         return LOGICAL_PRECEDENCE[(node as any).operator];
      case "BinaryExpression": {
         const op = (node as any).operator;
         if (op === "^")
            return POW_PRECEDENCE;
         return BINARY_PRECEDENCE[op];
      }
      case "UnaryExpression":
         return UNARY_PRECEDENCE;
      default:
         // Primary expressions (literals, identifiers, calls, table ctors, etc.)
         return 100;
   }
}

export interface LuaPrinterOptions {
   minified?: boolean; // if false, you can add more newlines/indent later
}

export class LuaPrinter {
   private buf: string[] = [];
   private options: LuaPrinterOptions;
   private indentLevel = 0;
   private indentUnit = "  "; // only used if !minified

   constructor(options: LuaPrinterOptions = {}) {
      this.options = options;
   }

   print(chunk: luaparse.Chunk): string {
      this.buf = [];
      this.indentLevel = 0;

      for (const stmt of chunk.body) {
         this.printStatement(stmt);
      }

      return this.buf.join("");
   }

   // --- low-level emit helpers ---

   private emit(s: string) {
      this.buf.push(s);
   }

   private newline() {
      if (this.options.minified) {
         this.buf.push("\n"); // could also use ';' but newlines are cheap + nice
      } else {
         this.buf.push("\n");
         this.buf.push(this.indentUnit.repeat(this.indentLevel));
      }
   }

   private emitKeyword(s: string) {
      this.emit(s);
   }

   // --- statement printer ---

   private printStatement(node: luaparse.Statement|luaparse.Comment): void {
      switch (node.type) {
         case "AssignmentStatement": {
            const st = node as luaparse.AssignmentStatement;
            const vars = st.variables.map(v => this.expr(v)).join(",");
            const vals = st.init.map(v => this.expr(v)).join(",");
            this.emit(vars);
            this.emit("=");
            this.emit(vals);
            this.newline();
            break;
         }

         case "LocalStatement": {
            const st = node as luaparse.LocalStatement;
            const vars = st.variables.map(v => this.expr(v)).join(",");
            this.emitKeyword("local");
            this.emit(" ");
            this.emit(vars);
            if (st.init && st.init.length > 0) {
               const vals = st.init.map(v => this.expr(v)).join(",");
               this.emit("=");
               this.emit(vals);
            }
            this.newline();
            break;
         }

         case "CallStatement": {
            const st = node as luaparse.CallStatement;
            this.emit(this.expr(st.expression));
            this.newline();
            break;
         }

         case "FunctionDeclaration": {
            const fn = node as luaparse.FunctionDeclaration;
            if (fn.isLocal) {
               this.emitKeyword("local");
               this.emit(" ");
            }
            this.emitKeyword("function");
            this.emit(" ");
            if (fn.identifier) {
               this.emit(this.expr(fn.identifier));
            }
            this.emit("(");
            this.emit(fn.parameters.map(p => this.expr(p)).join(","));
            this.emit(")");
            this.newline();

            this.indentLevel++;
            for (const st of fn.body) {
               if (!this.options.minified) {
                  this.buf.push(this.indentUnit.repeat(this.indentLevel));
               }
               this.printStatement(st);
            }
            this.indentLevel--;

            this.emitKeyword("end");
            this.newline();
            break;
         }

         case "IfStatement": {
            const ifs = node as luaparse.IfStatement;
            ifs.clauses.forEach((clause, idx) => {
               if (clause.type === "IfClause") {
                  this.emitKeyword("if");
                  this.emit(" ");
                  this.emit(this.expr(clause.condition));
                  this.emitKeyword(" then");
               } else if (clause.type === "ElseifClause") {
                  this.emitKeyword("elseif");
                  this.emit(" ");
                  this.emit(this.expr(clause.condition));
                  this.emitKeyword(" then");
               } else {
                  this.emitKeyword("else");
               }
               this.newline();
               this.indentLevel++;
               for (const st of clause.body) {
                  if (!this.options.minified) {
                     this.buf.push(this.indentUnit.repeat(this.indentLevel));
                  }
                  this.printStatement(st);
               }
               this.indentLevel--;
            });
            this.emitKeyword("end");
            this.newline();
            break;
         }

         case "WhileStatement": {
            const st = node as luaparse.WhileStatement;
            this.emitKeyword("while");
            this.emit(" ");
            this.emit(this.expr(st.condition));
            this.emitKeyword(" do");
            this.newline();
            this.indentLevel++;
            for (const s of st.body) {
               if (!this.options.minified) {
                  this.buf.push(this.indentUnit.repeat(this.indentLevel));
               }
               this.printStatement(s);
            }
            this.indentLevel--;
            this.emitKeyword("end");
            this.newline();
            break;
         }

         case "RepeatStatement": {
            const st = node as luaparse.RepeatStatement;
            this.emitKeyword("repeat");
            this.newline();
            this.indentLevel++;
            for (const s of st.body) {
               if (!this.options.minified) {
                  this.buf.push(this.indentUnit.repeat(this.indentLevel));
               }
               this.printStatement(s);
            }
            this.indentLevel--;
            this.emitKeyword("until");
            this.emit(" ");
            this.emit(this.expr(st.condition));
            this.newline();
            break;
         }

         case "ForNumericStatement": {
            const st = node as luaparse.ForNumericStatement;
            this.emitKeyword("for");
            this.emit(" ");
            this.emit(this.expr(st.variable));
            this.emit("=");
            this.emit(this.expr(st.start));
            this.emit(",");
            this.emit(this.expr(st.end));
            if (st.step) {
               this.emit(",");
               this.emit(this.expr(st.step));
            }
            this.emitKeyword(" do");
            this.newline();
            this.indentLevel++;
            for (const s of st.body) {
               if (!this.options.minified) {
                  this.buf.push(this.indentUnit.repeat(this.indentLevel));
               }
               this.printStatement(s);
            }
            this.indentLevel--;
            this.emitKeyword("end");
            this.newline();
            break;
         }

         case "ForGenericStatement": {
            const st = node as luaparse.ForGenericStatement;
            this.emitKeyword("for");
            this.emit(" ");
            this.emit(st.variables.map(v => this.expr(v)).join(","));
            this.emitKeyword(" in ");
            this.emit(st.iterators.map(it => this.expr(it)).join(","));
            this.emitKeyword(" do");
            this.newline();
            this.indentLevel++;
            for (const s of st.body) {
               if (!this.options.minified) {
                  this.buf.push(this.indentUnit.repeat(this.indentLevel));
               }
               this.printStatement(s);
            }
            this.indentLevel--;
            this.emitKeyword("end");
            this.newline();
            break;
         }

         case "ReturnStatement": {
            const st = node as luaparse.ReturnStatement;
            this.emitKeyword("return");
            if (st.arguments.length > 0) {
               this.emit(" ");
               this.emit(st.arguments.map(a => this.expr(a)).join(","));
            }
            this.newline();
            break;
         }

         case "BreakStatement": {
            this.emitKeyword("break");
            this.newline();
            break;
         }

         case "DoStatement": {
            const st = node as luaparse.DoStatement;
            this.emitKeyword("do");
            this.newline();
            this.indentLevel++;
            for (const s of st.body) {
               if (!this.options.minified) {
                  this.buf.push(this.indentUnit.repeat(this.indentLevel));
               }
               this.printStatement(s);
            }
            this.indentLevel--;
            this.emitKeyword("end");
            this.newline();
            break;
         }

         case "Comment":
            // drop comments entirely.
            break;
         default:
            // console.warn("Unimplemented statement type:", node.type);
            break;
      }
   }

   // --- expression printer ---

   private expr(node: luaparse.Expression|luaparse.Node, parentPrec = 0): string {
      if (!node)
         return "";

      switch (node.type) {
         case "Identifier":
            return (node as luaparse.Identifier).name;

         case "StringLiteral":
            return this.stringLiteral(node as luaparse.StringLiteral);

         case "NumericLiteral":
            return String((node as luaparse.NumericLiteral).value);

         case "BooleanLiteral":
            return (node as luaparse.BooleanLiteral).value ? "true" : "false";

         case "NilLiteral":
            return "nil";

         case "VarargLiteral":
            return "...";

         case "TableConstructorExpression":
            return this.tableConstructor(node as luaparse.TableConstructorExpression);

         case "UnaryExpression":
            return this.unaryExpr(node as luaparse.UnaryExpression, parentPrec);

         case "BinaryExpression":
            return this.binaryExpr(node as luaparse.BinaryExpression, parentPrec);

         case "LogicalExpression":
            return this.logicalExpr(node as luaparse.LogicalExpression, parentPrec);

         case "MemberExpression":
            return this.memberExpr(node as luaparse.MemberExpression);

         case "IndexExpression":
            return this.indexExpr(node as luaparse.IndexExpression);

         case "CallExpression":
            return this.callExpr(node as luaparse.CallExpression);

         case "TableCallExpression":
            return this.tableCallExpr(node as luaparse.TableCallExpression);

         case "StringCallExpression":
            return this.stringCallExpr(node as luaparse.StringCallExpression);

         case "FunctionDeclaration":
            return this.functionExpr(node as luaparse.FunctionDeclaration);

         default:
            return `<${node.type}>`;
      }
   }

   private stringLiteral(node: luaparse.StringLiteral): string {
      if (node.raw)
         return node.raw;
      return toLuaStringLiteral(node.value);
   }

   private tableConstructor(node: luaparse.TableConstructorExpression): string {
      if (node.fields.length === 0)
         return "{}";

      const parts: string[] = [];
      for (const f of node.fields) {
         if (f.type === "TableKey") {
            parts.push(`[${this.expr(f.key)}]=${this.expr(f.value)}`);
         } else if (f.type === "TableKeyString") {
            // luaparse gives key as an Identifier or StringLiteral
            parts.push(`${this.expr(f.key)}=${this.expr(f.value)}`);
         } else {
            // TableValue
            parts.push(this.expr(f.value));
         }
      }
      return `{${parts.join(",")}}`;
   }

   private unaryExpr(node: luaparse.UnaryExpression, parentPrec: number): string {
      const prec = getPrecedence(node);
      const arg = this.expr(node.argument, prec);
      const op = node.operator;

      let s: string;
      if (op === "not") {
         s = `not ${arg}`;
      } else {
         s = op + arg;
      }

      if (prec < parentPrec)
         s = `(${s})`;
      return s;
   }

   private binaryExpr(node: luaparse.BinaryExpression, parentPrec: number): string {
      const prec = getPrecedence(node);
      const left = this.expr(node.left, prec);
      const right = this.expr(node.right, prec);
      let s = `${left}${node.operator}${right}`;
      if (prec < parentPrec)
         s = `(${s})`;
      return s;
   }

   private logicalExpr(node: luaparse.LogicalExpression, parentPrec: number): string {
      const prec = getPrecedence(node);
      const left = this.expr(node.left, prec);
      const right = this.expr(node.right, prec);
      let s = `${left} ${node.operator} ${right}`;
      if (prec < parentPrec)
         s = `(${s})`;
      return s;
   }

   private memberExpr(node: luaparse.MemberExpression): string {
      // luaparse usually gives . or : in node.indexer
      const base = this.expr(node.base, 100); // force parens if non-primary
      const id = this.expr(node.identifier);
      const indexer = (node as any).indexer || ".";
      return `${base}${indexer}${id}`;
   }

   private indexExpr(node: luaparse.IndexExpression): string {
      const base = this.expr(node.base, 100);
      return `${base}[${this.expr(node.index)}]`;
   }

   private callExpr(node: luaparse.CallExpression): string {
      const base = this.expr(node.base, 100);
      const args = node.arguments.map(a => this.expr(a)).join(",");
      return `${base}(${args})`;
   }

   private tableCallExpr(node: luaparse.TableCallExpression): string {
      // sugar: f{...}  → f({ ... })
      const base = this.expr(node.base, 100);
      const arg = this.expr(node.arguments as any);
      return `${base}(${arg})`;
   }

   private stringCallExpr(node: luaparse.StringCallExpression): string {
      // sugar: f"str" → f("str")
      const base = this.expr(node.base, 100);
      const arg = this.stringLiteral(node.argument as luaparse.StringLiteral);
      return `${base}(${arg})`;
   }

   private functionExpr(node: luaparse.FunctionDeclaration): string {
      // function used as expression: "function(a,b) ... end"
      const params = node.parameters.map(p => this.expr(p)).join(",");
      const bodyPrinter = new LuaPrinter({minified: this.options.minified});
      // reuse statement printer but avoid duplicating indent handling:
      const innerChunk: luaparse.Chunk = {
         type: "Chunk",
         body: node.body as any,
         comments: [],
         //globals: [],
      };
      const bodyCode = bodyPrinter.print(innerChunk).trimEnd();

      return `function(${params})\n${bodyCode}\nend`;
   }
}



// Generate Lua code from an AST
export function unparseLua(ast: luaparse.Chunk): string {
   const generator = new LuaPrinter();
   return generator.print(ast);
}

export function parseLua(code: string): luaparse.Chunk|null {
   //console.log(code);
   try {
      const ast = luaparse.parse(code, {
         luaVersion: "5.3", // TIC-80 is 5.3-ish; adjust if needed
         comments: true,
         locations: true,
         ranges: true,
      });
      return ast;
   } catch (error) {
      console.error("Error parsing Lua code:", error);
   }

   return null;
}

export function processLua(code: string): string {
   const ast = parseLua(code);
   if (!ast) {
      console.error("[LuaProcessor] Failed to parse Lua code; returning original code.");
      return code;
   }
   console.log("[LuaProcessor] Parsed Lua AST:", ast);
   return unparseLua(ast);
}
