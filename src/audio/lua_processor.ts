
import * as luaparse from "luaparse";
import {toLuaStringLiteral} from "../utils/utils";


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



/**
 * Simple AST -> Lua code generator
 * This is a basic implementation that will be enhanced for minification later
 */
class LuaGenerator {
   private indent = 0;
   private indentStr = "\t";
   private output: string[] = [];

   generate(node: luaparse.Node|luaparse.Node[]): string {
      this.output = [];
      this.indent = 0;

      if (Array.isArray(node)) {
         for (const n of node) {
            this.visit(n);
         }
      } else {
         this.visit(node);
      }

      return this.output.join("");
   }

   private write(s: string) {
      this.output.push(s);
   }

   private writeLine(s: string = "") {
      if (s) {
         this.write(this.indentStr.repeat(this.indent) + s);
      }
      this.write("\n");
   }

   private visit(node: luaparse.Node) {
      if (!node)
         return;

      switch (node.type) {
         case "Chunk":
            this.visitChunk(node as luaparse.Chunk);
            break;
         case "AssignmentStatement":
            this.visitAssignment(node as luaparse.AssignmentStatement);
            break;
         case "LocalStatement":
            this.visitLocal(node as luaparse.LocalStatement);
            break;
         case "CallStatement":
            this.visitCallStatement(node as luaparse.CallStatement);
            break;
         case "FunctionDeclaration":
            this.visitFunctionDeclaration(node as luaparse.FunctionDeclaration);
            break;
         case "ForNumericStatement":
            this.visitForNumeric(node as luaparse.ForNumericStatement);
            break;
         case "ForGenericStatement":
            this.visitForGeneric(node as luaparse.ForGenericStatement);
            break;
         case "WhileStatement":
            this.visitWhile(node as luaparse.WhileStatement);
            break;
         case "RepeatStatement":
            this.visitRepeat(node as luaparse.RepeatStatement);
            break;
         case "IfStatement":
            this.visitIf(node as luaparse.IfStatement);
            break;
         case "ReturnStatement":
            this.visitReturn(node as luaparse.ReturnStatement);
            break;
         case "BreakStatement":
            this.writeLine("break");
            break;
         case "DoStatement":
            this.visitDo(node as luaparse.DoStatement);
            break;
         case "Comment":
            this.visitComment(node as luaparse.Comment);
            break;
         default:
            // Unknown statement type
            console.warn(`[LuaGenerator] Unknown node type: ${node.type}`);
            break;
      }
   }

   private visitChunk(node: luaparse.Chunk) {
      for (const stmt of node.body) {
         this.visit(stmt);
      }
      // Handle trailing comments
      if (node.comments) {
         for (const comment of node.comments) {
            this.visit(comment);
         }
      }
   }

   private visitComment(node: luaparse.Comment) {
      const prefix = this.indentStr.repeat(this.indent);
      if (node.raw) {
         this.write(prefix + node.raw);
      } else {
         const marker = node.value.startsWith("[") ? "--" : "--";
         this.write(prefix + marker + node.value);
      }
      this.write("\n");
   }

   private visitAssignment(node: luaparse.AssignmentStatement) {
      const vars = node.variables.map((v) => this.expr(v)).join(", ");
      const vals = node.init.map((v) => this.expr(v)).join(", ");
      this.writeLine(`${vars} = ${vals}`);
   }

   private visitLocal(node: luaparse.LocalStatement) {
      const vars = node.variables.map((v) => this.expr(v)).join(", ");
      if (node.init.length > 0) {
         const vals = node.init.map((v) => this.expr(v)).join(", ");
         this.writeLine(`local ${vars} = ${vals}`);
      } else {
         this.writeLine(`local ${vars}`);
      }
   }

   private visitCallStatement(node: luaparse.CallStatement) {
      this.writeLine(this.expr(node.expression));
   }

   private visitFunctionDeclaration(node: luaparse.FunctionDeclaration) {
      const params = node.parameters.map((p) => this.expr(p)).join(", ");
      const funcKeyword = node.isLocal ? "local function" : "function";

      if (node.identifier) {
         this.writeLine(`${funcKeyword} ${this.expr(node.identifier)}(${params})`);
      } else {
         this.write(`${funcKeyword}(${params})`);
      }

      this.indent++;
      for (const stmt of node.body) {
         this.visit(stmt);
      }
      this.indent--;
      this.writeLine("end");
   }

   private visitForNumeric(node: luaparse.ForNumericStatement) {
      const varName = this.expr(node.variable);
      const start = this.expr(node.start);
      const end = this.expr(node.end);
      const step = node.step ? `, ${this.expr(node.step)}` : "";
      this.writeLine(`for ${varName} = ${start}, ${end}${step} do`);
      this.indent++;
      for (const stmt of node.body) {
         this.visit(stmt);
      }
      this.indent--;
      this.writeLine("end");
   }

   private visitForGeneric(node: luaparse.ForGenericStatement) {
      const vars = node.variables.map((v) => this.expr(v)).join(", ");
      const iters = node.iterators.map((i) => this.expr(i)).join(", ");
      this.writeLine(`for ${vars} in ${iters} do`);
      this.indent++;
      for (const stmt of node.body) {
         this.visit(stmt);
      }
      this.indent--;
      this.writeLine("end");
   }

   private visitWhile(node: luaparse.WhileStatement) {
      this.writeLine(`while ${this.expr(node.condition)} do`);
      this.indent++;
      for (const stmt of node.body) {
         this.visit(stmt);
      }
      this.indent--;
      this.writeLine("end");
   }

   private visitRepeat(node: luaparse.RepeatStatement) {
      this.writeLine("repeat");
      this.indent++;
      for (const stmt of node.body) {
         this.visit(stmt);
      }
      this.indent--;
      this.writeLine(`until ${this.expr(node.condition)}`);
   }

   private visitIf(node: luaparse.IfStatement) {
      // First clause
      for (let i = 0; i < node.clauses.length; i++) {
         const clause = node.clauses[i];
         if (clause.type === "IfClause") {
            this.writeLine(`if ${this.expr(clause.condition)} then`);
         } else if (clause.type === "ElseifClause") {
            this.writeLine(`elseif ${this.expr(clause.condition)} then`);
         } else {
            // ElseClause
            this.writeLine("else");
         }
         this.indent++;
         for (const stmt of clause.body) {
            this.visit(stmt);
         }
         this.indent--;
      }
      this.writeLine("end");
   }

   private visitReturn(node: luaparse.ReturnStatement) {
      if (node.arguments.length > 0) {
         const args = node.arguments.map((a) => this.expr(a)).join(", ");
         this.writeLine(`return ${args}`);
      } else {
         this.writeLine("return");
      }
   }

   private visitDo(node: luaparse.DoStatement) {
      this.writeLine("do");
      this.indent++;
      for (const stmt of node.body) {
         this.visit(stmt);
      }
      this.indent--;
      this.writeLine("end");
   }

   // Expression visitor that returns a string
   private expr(node: luaparse.Expression|luaparse.Node): string {
      if (!node)
         return "";

      switch (node.type) {
         case "Identifier":
            return (node as luaparse.Identifier).name;
         case "StringLiteral":
            return this.stringLiteral(node);
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
         case "BinaryExpression":
            return this.binaryExpr(node as luaparse.BinaryExpression);
         case "UnaryExpression":
            return this.unaryExpr(node as luaparse.UnaryExpression);
         case "LogicalExpression":
            return this.logicalExpr(node as luaparse.LogicalExpression);
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
            return `<unknown:${node.type}>`;
      }
   }

   private stringLiteral(node: luaparse.StringLiteral): string {
      if (node.value == null) {
         if (node.raw) {
            return node.raw;
         }
      }
      return toLuaStringLiteral(node.value);
   }

   private tableConstructor(node: luaparse.TableConstructorExpression): string {
      if (node.fields.length === 0) {
         return "{}";
      }

      const fields = node.fields.map((field) => {
         if (field.type === "TableKey") {
            return `[${this.expr(field.key)}] = ${this.expr(field.value)}`;
         } else if (field.type === "TableKeyString") {
            return `${this.expr(field.key)} = ${this.expr(field.value)}`;
         } else {
            // TableValue
            return this.expr(field.value);
         }
      });

      return `{${fields.join(", ")}}`;
   }

   private binaryExpr(node: luaparse.BinaryExpression): string {
      return `${this.expr(node.left)} ${node.operator} ${this.expr(node.right)}`;
   }

   private unaryExpr(node: luaparse.UnaryExpression): string {
      return `${node.operator}${this.expr(node.argument)}`;
   }

   private logicalExpr(node: luaparse.LogicalExpression): string {
      return `${this.expr(node.left)} ${node.operator} ${this.expr(node.right)}`;
   }

   private memberExpr(node: luaparse.MemberExpression): string {
      return `${this.expr(node.base)}.${this.expr(node.identifier)}`;
   }

   private indexExpr(node: luaparse.IndexExpression): string {
      return `${this.expr(node.base)}[${this.expr(node.index)}]`;
   }

   private callExpr(node: luaparse.CallExpression): string {
      const base = this.expr(node.base);
      const args = node.arguments.map((a) => this.expr(a)).join(", ");
      return `${base}(${args})`;
   }

   private tableCallExpr(node: luaparse.TableCallExpression): string {
      return `${this.expr(node.base)}${this.expr(node.arguments)}`;
   }

   private stringCallExpr(node: luaparse.StringCallExpression): string {
      const argNode = node.argument as luaparse.StringLiteral;
      return `${this.expr(node.base)}${this.stringLiteral(argNode)}`;
   }

   private functionExpr(node: luaparse.FunctionDeclaration): string {
      const params = node.parameters.map((p) => this.expr(p)).join(", ");
      let result = `function(${params})\n`;
      this.indent++;
      for (const stmt of node.body) {
         this.visit(stmt);
      }
      this.indent--;
      result += this.indentStr.repeat(this.indent) + "end";
      return result;
   }
}

// Generate Lua code from an AST
export function unparseLua(ast: luaparse.Chunk): string {
   const generator = new LuaGenerator();
   return generator.generate(ast);
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
