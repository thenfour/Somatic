
import * as luaparse from "luaparse";
import {replaceLuaBlock, toLuaStringLiteral} from "../utils/utils";
import {renameLocalVariablesInAST} from "./lua_renamer";
import {aliasLiteralsInAST} from "./lua_alias_literals";
import {aliasRepeatedExpressionsInAST} from "./lua_alias_expressions";
import {packLocalDeclarationsInAST} from "./lua_pack_locals";
import {simplifyExpressionsInAST} from "./lua_simplify";
import {removeUnusedLocalsInAST} from "./lua_remove_unused_locals";
import {renameTableFieldsInAST} from "./lua_rename_table_fields";
import {renameAllowedTableKeysInAST} from "./lua_rename_allowed_table_keys";

export type OptimizationRuleOptions = {
   stripComments: boolean;    //
   stripDebugBlocks: boolean; //
   maxIndentLevel: number;    // limits indentation to N levels; beyond that, everything is flattened
   renameLocalVariables: boolean;
   aliasRepeatedExpressions: boolean;

   // literal values like "hello" or numbers like 65535 that appear enough times can be
   // replaced with a local variable to save space.
   // * only done for values that appear enough times to offset the cost of the local declaration.
   // * alias declaration placed in the narrowest possible scope that contains all uses.
   aliasLiterals: boolean;

   // Simplify expressions by folding constants and propagating simple constant locals.
   // * folds basic arithmetic, boolean logic, and string concatenation when operands are literals.
   // * propagates locals that are assigned literal values until they are reassigned or shadowed.
   simplifyExpressions: boolean;

   // Remove local declarations that are never referenced (and whose initializers are side-effect free).
   removeUnusedLocals: boolean;

   // Rename table literal field names when safe (non-escaping locals, string/identifier keys only).
   renameTableFields: boolean;

   // Globally rename specific table entry keys (string/identifier keys and member/index accesses) to short names.
   // Intended for callers that know these keys are safe to minify even when the table escapes.
   tableEntryKeysToRename: string[];

   // Merge consecutive local declarations into one using packing.
   // e.g.,
   // local a=1
   // local b=2
   // ->
   // local a,b = 1,2
   // (18 chars -> 15)
   //
   // we should be conservative in choosing to apply this treatment:
   // * must be consecutive to guarantee no side-effects or dependencies in between.
   // * it's NOT safe when there are any intervening statements with side effects.
   // * or any dependencies between the variables being declared. like,
   //   local a = 1
   //   local b = a + c
   //   -> cannot be packed.
   //   local a, b = 1, a + c -- does not work because 'a' is not defined yet
   // * or if any of the variables are used before all are declared. this is non-trivial because you could
   //   have:
   //   local a = 1
   //   local b = doSomething() -- 'a' is used in doSomething()
   // so we skip packing in that case.
   packLocalDeclarations: boolean;
};

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
         return LOGICAL_PRECEDENCE[node.operator];
      case "BinaryExpression": {
         const op = node.operator;
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

export class LuaPrinter {
   private buf: string[] = [];
   private options: OptimizationRuleOptions;
   private indentLevel = 0;
   private indentUnit = " "; // only used if !minified
   private blockComments: Map<luaparse.Statement[], luaparse.Comment[]>;

   constructor(options: OptimizationRuleOptions, blockComments?: Map<luaparse.Statement[], luaparse.Comment[]>) {
      this.options = options;
      this.blockComments = blockComments || new Map();
   }

   print(chunk: luaparse.Chunk): string {
      this.buf = [];
      this.indentLevel = 0;
      this.printBlock(chunk.body);
      return this.buf.join("");
   }

   // --- low-level emit helpers ---

   private emit(s: string) {
      this.buf.push(s);
   }

   private newline() {
      this.buf.push("\n");
   }

   private emitKeyword(s: string) {
      this.emit(s);
   }

   private startPos(node: {range?: [number, number]}|any): number {
      if (node && Array.isArray(node.range) && node.range.length > 0) {
         return node.range[0] as number;
      }
      return 0;
   }

   private printIndent() {
      const indentLevel = Math.min(this.indentLevel, this.options.maxIndentLevel);
      this.buf.push(this.indentUnit.repeat(indentLevel));
      //   if (!this.options.stripWhitespace) {
      //      this.buf.push(this.indentUnit.repeat(this.indentLevel));
      //   }
   }

   private printBlock(body: luaparse.Statement[]) {
      const comments = [...(this.blockComments.get(body) || [])];
      const items: Array<luaparse.Statement|luaparse.Comment> = [];
      let ci = 0;

      for (const stmt of body) {
         while (ci < comments.length && this.startPos(comments[ci]) <= this.startPos(stmt)) {
            items.push(comments[ci]);
            ci++;
         }
         items.push(stmt);
      }
      while (ci < comments.length) {
         items.push(comments[ci]);
         ci++;
      }

      for (const node of items) {
         this.printIndent();
         this.printStatement(node);
      }
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
            this.printBlock(fn.body);
            this.indentLevel--;

            this.printIndent();
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
               this.printBlock(clause.body);
               this.indentLevel--;
            });
            this.printIndent();
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
            this.printBlock(st.body);
            this.indentLevel--;
            this.printIndent();
            this.emitKeyword("end");
            this.newline();
            break;
         }

         case "RepeatStatement": {
            const st = node as luaparse.RepeatStatement;
            this.emitKeyword("repeat");
            this.newline();
            this.indentLevel++;
            this.printBlock(st.body);
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
            this.printBlock(st.body);
            this.indentLevel--;
            this.printIndent();
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
            this.printBlock(st.body);
            this.indentLevel--;
            this.printIndent();
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
            this.printBlock(st.body);
            this.indentLevel--;
            this.printIndent();
            this.emitKeyword("end");
            this.newline();
            break;
         }

         case "Comment":
            this.printComment(node as luaparse.Comment);
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
            return this.numericLiteral(node as luaparse.NumericLiteral);

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

   private numericLiteral(node: luaparse.NumericLiteral): string {
      const value = node.value;
      const decimalStr = Number.isFinite(value) ? value.toString(10) : String(value);

      if (/^-?0\.\d/.test(decimalStr))
         return decimalStr.replace(/^(-?)0\./, "$1.");

      return decimalStr;
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
      const indexer = node.indexer || ".";
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
      const arg = this.expr(node.arguments);
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
      const bodyPrinter = new LuaPrinter(this.options, this.blockComments);
      // reuse statement printer but avoid duplicating indent handling:
      const innerChunk: luaparse.Chunk = {
         type: "Chunk",
         body: node.body,
         comments: [],
         //globals: [],
      };
      const bodyCode = bodyPrinter.print(innerChunk).trimEnd();

      return `function(${params})\n${bodyCode}\nend`;
   }

   private printComment(node: luaparse.Comment) {
      if (node.raw) {
         this.emit(node.raw);
      } else {
         this.emit("--" + node.value);
      }
      this.newline();
   }
}



type LuaRange = [number, number];

function nodeRange(node: {range?: LuaRange}|any): LuaRange {
   if (node && Array.isArray(node.range) && node.range.length > 1) {
      return node.range as LuaRange;
   }
   return [0, Number.MAX_SAFE_INTEGER];
}

function rangeContains(outer: LuaRange, inner: LuaRange): boolean {
   return inner[0] >= outer[0] && inner[1] <= outer[1];
}

// Collect all statement blocks (function bodies, if/else bodies, loops, etc.)
function collectBlocksFromStatement(
   node: luaparse.Statement, blocks: Array<{body: luaparse.Statement[]; range: LuaRange}>) {
   switch (node.type) {
      case "FunctionDeclaration": {
         const fn = node as luaparse.FunctionDeclaration;
         blocks.push({body: fn.body, range: nodeRange(fn)});
         fn.body.forEach(st => collectBlocksFromStatement(st, blocks));
         break;
      }

      case "IfStatement": {
         const ifs = node as luaparse.IfStatement;
         ifs.clauses.forEach(clause => {
            blocks.push({body: clause.body, range: nodeRange(clause)});
            clause.body.forEach(st => collectBlocksFromStatement(st, blocks));
         });
         break;
      }

      case "WhileStatement":
      case "RepeatStatement":
      case "ForNumericStatement":
      case "ForGenericStatement":
      case "DoStatement": {
         const body = node.body as luaparse.Statement[];
         blocks.push({body, range: nodeRange(node)});
         body.forEach(st => collectBlocksFromStatement(st, blocks));
         break;
      }

      default:
         break;
   }
}

function collectAllStatementBlocks(chunk: luaparse.Chunk): Array<{body: luaparse.Statement[]; range: LuaRange}> {
   const blocks: Array<{body: luaparse.Statement[]; range: LuaRange}> = [
      {body: chunk.body, range: nodeRange(chunk)},
   ];

   for (const st of chunk.body) {
      collectBlocksFromStatement(st, blocks);
   }

   return blocks;
}

// Build a map from statement blocks to comments contained within them
// why is this needed?
// luaparse gives comments attached to the root chunk only, not to inner blocks
// so we have to manually assign them to the correct blocks
function buildCommentMap(ast: luaparse.Chunk): Map<luaparse.Statement[], luaparse.Comment[]> {
   const blocks = collectAllStatementBlocks(ast);
   const map = new Map<luaparse.Statement[], luaparse.Comment[]>();
   blocks.forEach(b => map.set(b.body, []));

   const comments = ast.comments || [];
   for (const c of comments) {
      const cr = nodeRange(c);
      let target = blocks[0];
      for (const blk of blocks) {
         if (rangeContains(blk.range, cr)) {
            const widthCurrent = target ? target.range[1] - target.range[0] : Number.MAX_SAFE_INTEGER;
            const widthCandidate = blk.range[1] - blk.range[0];
            if (widthCandidate <= widthCurrent) {
               target = blk;
            }
         }
      }

      const list = map.get(target.body) || [];
      list.push(c as luaparse.Comment);
      map.set(target.body, list);
   }

   for (const [body, list] of map.entries()) {
      list.sort((a, b) => nodeRange(a)[0] - nodeRange(b)[0]);
   }

   return map;
}

// Generate Lua code from an AST
export function unparseLua(ast: luaparse.Chunk, ruleOptions: OptimizationRuleOptions): string {
   const generator = new LuaPrinter(ruleOptions, buildCommentMap(ast));
   return generator.print(ast);
}

export function parseLua(code: string): luaparse.Chunk|null {
   //console.log(code);
   try {
      const ast = luaparse.parse(code, {
         luaVersion: "5.3", // TIC-80 is 5.3-ish
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

export function processLua(code: string, ruleOptions: OptimizationRuleOptions): string {
   // Apply optimization rules
   //const options = {...DEFAULT_OPTIMIZATION_RULES, ...ruleOptions};

   // Strip debug blocks and lines before parsing (line-based string matching)
   let processedCode = code;
   if (ruleOptions.stripDebugBlocks) {
      // Strip debug blocks
      processedCode = replaceLuaBlock(processedCode, "-- BEGIN_DEBUG_ONLY", "-- END_DEBUG_ONLY", "");

      // Strip individual lines marked with -- DEBUG_ONLY
      const eol = processedCode.includes("\r\n") ? "\r\n" : "\n";
      const lines = processedCode.split(eol);
      const filteredLines = lines.filter(line => !line.includes("-- DEBUG_ONLY"));
      processedCode = filteredLines.join(eol);
   }

   let ast = parseLua(processedCode);
   if (!ast) {
      console.error("Failed to parse Lua code; returning original code.");
      return code;
   }
   //console.log("Parsed Lua AST:", ast);

   if (ruleOptions.stripComments) {
      ast.comments = [];
   }

   if (ruleOptions.packLocalDeclarations) {
      ast = packLocalDeclarationsInAST(ast);
   }

   if (ruleOptions.simplifyExpressions) {
      ast = simplifyExpressionsInAST(ast);
   }

   if (ruleOptions.removeUnusedLocals) {
      ast = removeUnusedLocalsInAST(ast);
   }

   if (ruleOptions.aliasLiterals) {
      ast = aliasLiteralsInAST(ast);
   }

   if (ruleOptions.aliasRepeatedExpressions) {
      ast = aliasRepeatedExpressionsInAST(ast);
   }

   if (ruleOptions.renameLocalVariables) {
      ast = renameLocalVariablesInAST(ast);
   }

   if (ruleOptions.tableEntryKeysToRename && ruleOptions.tableEntryKeysToRename.length > 0) {
      ast = renameAllowedTableKeysInAST(ast, ruleOptions.tableEntryKeysToRename);
   }

   if (ruleOptions.renameTableFields) {
      ast = renameTableFieldsInAST(ast);
   }

   return unparseLua(ast, ruleOptions);
}
