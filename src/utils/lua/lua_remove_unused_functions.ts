import * as luaparse from "luaparse";

export type RemoveUnusedFunctionsOptions = {
   functionNamesToKeep?: string[];
};

const DEFAULT_KEEP_GLOBALS = new Set<string>([
   // TIC-80 lifecycle hooks / entrypoints
   "TIC",
   "BOOT",
   "SCN",
   "BDR",
   "MENU",
   "OVR",
]);

type FnDecl = {
   name: string; node: luaparse.FunctionDeclaration; parentBody: luaparse.Statement[];
};

type ScanResult = {
   reads: Set<string>; writes: Set<string>;
};

function isSimpleIdentifier(node: luaparse.Expression|luaparse.Node|null|undefined): node is luaparse.Identifier {
   return !!node && node.type === "Identifier";
}

function scanExpressionForNames(expr: luaparse.Expression, candidateNames: Set<string>, out: ScanResult): void {
   switch (expr.type) {
      case "Identifier":
         if (candidateNames.has(expr.name))
            out.reads.add(expr.name);
         return;

      case "UnaryExpression":
         scanExpressionForNames(expr.argument, candidateNames, out);
         return;

      case "BinaryExpression":
      case "LogicalExpression":
         scanExpressionForNames(expr.left, candidateNames, out);
         scanExpressionForNames(expr.right, candidateNames, out);
         return;

      case "CallExpression":
         scanExpressionForNames(expr.base, candidateNames, out);
         expr.arguments.forEach(a => scanExpressionForNames(a, candidateNames, out));
         return;

      case "TableCallExpression":
         scanExpressionForNames(expr.base, candidateNames, out);
         scanExpressionForNames(expr.arguments, candidateNames, out);
         return;

      case "StringCallExpression":
         scanExpressionForNames(expr.base, candidateNames, out);
         scanExpressionForNames(expr.argument as luaparse.Expression, candidateNames, out);
         return;

      case "MemberExpression":
         scanExpressionForNames(expr.base, candidateNames, out);
         return;

      case "IndexExpression":
         scanExpressionForNames(expr.base, candidateNames, out);
         scanExpressionForNames(expr.index, candidateNames, out);
         return;

      case "TableConstructorExpression":
         expr.fields.forEach(field => {
            if (field.type === "TableKey" || field.type === "TableKeyString") {
               if (field.key)
                  scanExpressionForNames(field.key, candidateNames, out);
               if (field.value)
                  scanExpressionForNames(field.value, candidateNames, out);
            } else if (field.type === "TableValue" && field.value) {
               scanExpressionForNames(field.value, candidateNames, out);
            }
         });
         return;

      case "FunctionDeclaration":
         // Anonymous (or expression) function: conservatively scan body.
         expr.body.forEach(st => scanStatementForNames(st, candidateNames, out));
         return;

      default:
         return;
   }
}

function scanAssignmentTargetForNames(expr: luaparse.Expression, candidateNames: Set<string>, out: ScanResult): void {
   // In assignment targets, identifiers are writes; complex lvalues also read their base/index.
   switch (expr.type) {
      case "Identifier":
         if (candidateNames.has(expr.name))
            out.writes.add(expr.name);
         return;
      case "MemberExpression":
         scanExpressionForNames(expr.base, candidateNames, out);
         return;
      case "IndexExpression":
         scanExpressionForNames(expr.base, candidateNames, out);
         scanExpressionForNames(expr.index, candidateNames, out);
         return;
      default:
         // Fallback: treat as expression read.
         scanExpressionForNames(expr, candidateNames, out);
         return;
   }
}

function scanStatementForNames(
   stmt: luaparse.Statement, candidateNames: Set<string>, out: ScanResult, skipStatements?: Set<luaparse.Statement>):
   void {
   if (skipStatements && skipStatements.has(stmt)) {
      return;
   }

   switch (stmt.type) {
      case "LocalStatement":
         if (stmt.init)
            stmt.init.forEach(e => scanExpressionForNames(e, candidateNames, out));
         return;

      case "AssignmentStatement":
         stmt.variables.forEach(v => scanAssignmentTargetForNames(v, candidateNames, out));
         stmt.init.forEach(e => scanExpressionForNames(e, candidateNames, out));
         return;

      case "CallStatement":
         scanExpressionForNames(stmt.expression, candidateNames, out);
         return;

      case "ReturnStatement":
         stmt.arguments.forEach(a => scanExpressionForNames(a, candidateNames, out));
         return;

      case "IfStatement":
         stmt.clauses.forEach(clause => {
            if (clause.type !== "ElseClause" && clause.condition)
               scanExpressionForNames(clause.condition, candidateNames, out);
            clause.body.forEach(s => scanStatementForNames(s, candidateNames, out, skipStatements));
         });
         return;

      case "WhileStatement":
         scanExpressionForNames(stmt.condition, candidateNames, out);
         stmt.body.forEach(s => scanStatementForNames(s, candidateNames, out, skipStatements));
         return;

      case "RepeatStatement":
         stmt.body.forEach(s => scanStatementForNames(s, candidateNames, out, skipStatements));
         scanExpressionForNames(stmt.condition, candidateNames, out);
         return;

      case "ForNumericStatement":
         scanExpressionForNames(stmt.start, candidateNames, out);
         scanExpressionForNames(stmt.end, candidateNames, out);
         if (stmt.step)
            scanExpressionForNames(stmt.step, candidateNames, out);
         stmt.body.forEach(s => scanStatementForNames(s, candidateNames, out, skipStatements));
         return;

      case "ForGenericStatement":
         stmt.iterators.forEach(it => scanExpressionForNames(it, candidateNames, out));
         stmt.body.forEach(s => scanStatementForNames(s, candidateNames, out, skipStatements));
         return;

      case "FunctionDeclaration":
         // If identifier is a member/index expression, the base/index are evaluated and thus can read candidate names.
         if (stmt.identifier && !isSimpleIdentifier(stmt.identifier)) {
            scanExpressionForNames(stmt.identifier as luaparse.Expression, candidateNames, out);
         }
         stmt.body.forEach(s => scanStatementForNames(s, candidateNames, out, skipStatements));
         return;

      case "DoStatement":
         stmt.body.forEach(s => scanStatementForNames(s, candidateNames, out, skipStatements));
         return;

      default:
         return;
   }
}

function collectLocalBindingsFromExpression(expr: luaparse.Expression, out: Map<string, number>): void {
   if (expr.type === "FunctionDeclaration") {
      expr.parameters.forEach(p => {
         if (p.type === "Identifier") {
            out.set(p.name, (out.get(p.name) || 0) + 1);
         }
      });
      expr.body.forEach(s => collectLocalBindingsFromStatement(s, out));
      return;
   }

   if (expr.type === "TableConstructorExpression") {
      expr.fields.forEach(field => {
         if ((field.type === "TableKey" || field.type === "TableKeyString") && field.key)
            collectLocalBindingsFromExpression(field.key, out);
         if (field.value)
            collectLocalBindingsFromExpression(field.value, out);
      });
      return;
   }

   if (expr.type === "UnaryExpression") {
      collectLocalBindingsFromExpression(expr.argument, out);
      return;
   }

   if (expr.type === "BinaryExpression" || expr.type === "LogicalExpression") {
      collectLocalBindingsFromExpression(expr.left, out);
      collectLocalBindingsFromExpression(expr.right, out);
      return;
   }

   if (expr.type === "CallExpression") {
      collectLocalBindingsFromExpression(expr.base, out);
      expr.arguments.forEach(a => collectLocalBindingsFromExpression(a, out));
      return;
   }

   if (expr.type === "TableCallExpression") {
      collectLocalBindingsFromExpression(expr.base, out);
      collectLocalBindingsFromExpression(expr.arguments, out);
      return;
   }

   if (expr.type === "StringCallExpression") {
      collectLocalBindingsFromExpression(expr.base, out);
      collectLocalBindingsFromExpression(expr.argument as luaparse.Expression, out);
      return;
   }

   if (expr.type === "MemberExpression") {
      collectLocalBindingsFromExpression(expr.base, out);
      return;
   }

   if (expr.type === "IndexExpression") {
      collectLocalBindingsFromExpression(expr.base, out);
      collectLocalBindingsFromExpression(expr.index, out);
      return;
   }
}

function collectLocalBindingsFromStatement(stmt: luaparse.Statement, out: Map<string, number>): void {
   switch (stmt.type) {
      case "LocalStatement":
         stmt.variables.forEach(v => {
            if (v.type === "Identifier")
               out.set(v.name, (out.get(v.name) || 0) + 1);
         });
         if (stmt.init)
            stmt.init.forEach(e => collectLocalBindingsFromExpression(e, out));
         return;

      case "ForNumericStatement":
         if (stmt.variable.type === "Identifier")
            out.set(stmt.variable.name, (out.get(stmt.variable.name) || 0) + 1);
         stmt.body.forEach(s => collectLocalBindingsFromStatement(s, out));
         return;

      case "ForGenericStatement":
         stmt.variables.forEach(v => {
            if (v.type === "Identifier")
               out.set(v.name, (out.get(v.name) || 0) + 1);
         });
         stmt.body.forEach(s => collectLocalBindingsFromStatement(s, out));
         return;

      case "IfStatement":
         stmt.clauses.forEach(clause => clause.body.forEach(s => collectLocalBindingsFromStatement(s, out)));
         return;

      case "WhileStatement":
      case "RepeatStatement":
      case "DoStatement":
         stmt.body.forEach(s => collectLocalBindingsFromStatement(s, out));
         return;

      case "AssignmentStatement":
         stmt.init.forEach(e => collectLocalBindingsFromExpression(e, out));
         return;

      case "CallStatement":
         collectLocalBindingsFromExpression(stmt.expression, out);
         return;

      case "ReturnStatement":
         stmt.arguments.forEach(a => collectLocalBindingsFromExpression(a, out));
         return;

      case "FunctionDeclaration":
         if (stmt.isLocal && stmt.identifier && stmt.identifier.type === "Identifier") {
            out.set(stmt.identifier.name, (out.get(stmt.identifier.name) || 0) + 1);
         }
         stmt.parameters.forEach(p => {
            if (p.type === "Identifier")
               out.set(p.name, (out.get(p.name) || 0) + 1);
         });
         stmt.body.forEach(s => collectLocalBindingsFromStatement(s, out));
         return;

      default:
         return;
   }
}

function computeClosure(
   candidates: Map<string, FnDecl[]>,
   keepNames: Set<string>,
   externalReads: Set<string>,
   externalWrites: Set<string>,
   depsByName: Map<string, Set<string>>): Set<string> {
   const keep = new Set<string>();

   // always keep explicit keep list
   keepNames.forEach(n => keep.add(n));

   // keep anything referenced outside of candidate bodies
   externalReads.forEach(n => keep.add(n));

   // keep anything written outside of candidate bodies
   externalWrites.forEach(n => keep.add(n));

   // duplicate declarations: keep to avoid ambiguity
   for (const [name, decls] of candidates.entries()) {
      if (decls.length > 1) {
         keep.add(name);
      }
   }

   let changed = true;
   while (changed) {
      changed = false;
      for (const name of [...keep]) {
         const deps = depsByName.get(name);
         if (!deps)
            continue;
         for (const dep of deps) {
            if (!keep.has(dep)) {
               keep.add(dep);
               changed = true;
            }
         }
      }
   }

   return keep;
}

function filterBody(body: luaparse.Statement[], toRemove: Set<luaparse.Statement>): luaparse.Statement[] {
   if (toRemove.size === 0)
      return body;
   return body.filter(st => !toRemove.has(st));
}

function removeUnusedLocalFunctionsInBody(body: luaparse.Statement[], keepNames: Set<string>): luaparse.Statement[] {
   const localCandidatesByName = new Map<string, FnDecl[]>();
   const candidateStatements = new Set<luaparse.Statement>();

   for (const st of body) {
      if (st.type === "FunctionDeclaration") {
         const fn = st as luaparse.FunctionDeclaration;
         if (fn.isLocal && isSimpleIdentifier(fn.identifier)) {
            const name = fn.identifier.name;
            const decl: FnDecl = {name, node: fn, parentBody: body};
            const list = localCandidatesByName.get(name) || [];
            list.push(decl);
            localCandidatesByName.set(name, list);
            candidateStatements.add(st);
         }
      }
   }

   if (localCandidatesByName.size === 0)
      return body;

   const candidateNames = new Set<string>(localCandidatesByName.keys());

   // Shadowing detection: any other local binding of the same name anywhere within this block tree
   // makes analysis ambiguous; keep in that case.
   const bindings = new Map<string, number>();
   body.forEach(st => collectLocalBindingsFromStatement(st, bindings));

   for (const name of candidateNames) {
      const count = bindings.get(name) || 0;
      const declCount = localCandidatesByName.get(name)?.length || 0;
      if (count !== declCount) {
         // There exists some other binding besides the candidate decl(s).
         keepNames.add(name);
      }
   }

   // External scan: scan block but skip candidate decl statements (so reads within candidate bodies are not considered roots).
   const external: ScanResult = {reads: new Set<string>(), writes: new Set<string>()};
   for (const st of body) {
      scanStatementForNames(st, candidateNames, external, candidateStatements);
   }

   // Dependencies: for each candidate, scan its body for references to other candidate names.
   const depsByName = new Map<string, Set<string>>();
   for (const [name, decls] of localCandidatesByName.entries()) {
      const deps = new Set<string>();
      for (const decl of decls) {
         const sr: ScanResult = {reads: new Set<string>(), writes: new Set<string>()};
         decl.node.body.forEach(st => scanStatementForNames(st, candidateNames, sr));
         sr.reads.forEach(r => {
            if (r !== name)
               deps.add(r);
         });
      }
      depsByName.set(name, deps);
   }

   const keep = computeClosure(localCandidatesByName, keepNames, external.reads, external.writes, depsByName);

   const toRemove = new Set<luaparse.Statement>();
   for (const [name, decls] of localCandidatesByName.entries()) {
      if (keep.has(name))
         continue;
      decls.forEach(d => toRemove.add(d.node as unknown as luaparse.Statement));
   }

   return filterBody(body, toRemove);
}

function collectGlobalFunctionDecls(body: luaparse.Statement[], out: FnDecl[]): void {
   for (const st of body) {
      if (st.type === "FunctionDeclaration") {
         const fn = st as luaparse.FunctionDeclaration;
         if (!fn.isLocal && isSimpleIdentifier(fn.identifier)) {
            out.push({name: fn.identifier.name, node: fn, parentBody: body});
         }
         // Global functions can still be declared inside other function bodies.
         collectGlobalFunctionDecls(fn.body, out);
         continue;
      }

      switch (st.type) {
         case "IfStatement":
            st.clauses.forEach(clause => collectGlobalFunctionDecls(clause.body, out));
            break;
         case "WhileStatement":
         case "RepeatStatement":
         case "ForNumericStatement":
         case "ForGenericStatement":
         case "DoStatement":
            collectGlobalFunctionDecls(st.body, out);
            break;
         default:
            break;
      }
   }
}

function removeStatementsRecursively(stmt: luaparse.Statement, toRemove: Set<luaparse.Statement>): luaparse.Statement {
   switch (stmt.type) {
      case "IfStatement":
         stmt.clauses.forEach(clause => {
            clause.body = clause.body.filter(s => !toRemove.has(s));
            clause.body = clause.body.map(s => removeStatementsRecursively(s, toRemove));
         });
         return stmt;
      case "WhileStatement":
      case "RepeatStatement":
      case "ForNumericStatement":
      case "ForGenericStatement":
      case "DoStatement":
         stmt.body = stmt.body.filter(s => !toRemove.has(s));
         stmt.body = stmt.body.map(s => removeStatementsRecursively(s, toRemove));
         return stmt;
      case "FunctionDeclaration": {
         const fn = stmt as luaparse.FunctionDeclaration;
         fn.body = fn.body.filter(s => !toRemove.has(s));
         fn.body = fn.body.map(s => removeStatementsRecursively(s, toRemove));
         return stmt;
      }
      default:
         return stmt;
   }
}

export function removeUnusedFunctionsInAST(
   ast: luaparse.Chunk, options: RemoveUnusedFunctionsOptions = {}): luaparse.Chunk {
   const keepNames = new Set<string>([...DEFAULT_KEEP_GLOBALS]);
   (options.functionNamesToKeep || []).forEach(n => keepNames.add(n));

   // === Global function candidates (simple identifier only) ===
   const globalDecls: FnDecl[] = [];
   collectGlobalFunctionDecls(ast.body, globalDecls);

   const globalCandidatesByName = new Map<string, FnDecl[]>();
   const globalCandidateStatements = new Set<luaparse.Statement>();

   for (const d of globalDecls) {
      const list = globalCandidatesByName.get(d.name) || [];
      list.push(d);
      globalCandidatesByName.set(d.name, list);
      globalCandidateStatements.add(d.node as unknown as luaparse.Statement);
   }

   const globalCandidateNames = new Set<string>(globalCandidatesByName.keys());

   // External scan for globals: whole chunk, but skip candidate global decl statements.
   const externalGlobals: ScanResult = {reads: new Set<string>(), writes: new Set<string>()};
   ast.body.forEach(st => scanStatementForNames(st, globalCandidateNames, externalGlobals, globalCandidateStatements));

   // Dependencies between candidate globals: scan candidate bodies.
   const globalDepsByName = new Map<string, Set<string>>();
   for (const [name, decls] of globalCandidatesByName.entries()) {
      const deps = new Set<string>();
      for (const decl of decls) {
         const sr: ScanResult = {reads: new Set<string>(), writes: new Set<string>()};
         decl.node.body.forEach(st => scanStatementForNames(st, globalCandidateNames, sr));
         sr.reads.forEach(r => {
            if (r !== name)
               deps.add(r);
         });
      }
      globalDepsByName.set(name, deps);
   }

   const keepGlobal = computeClosure(
      globalCandidatesByName, keepNames, externalGlobals.reads, externalGlobals.writes, globalDepsByName);

   const removeGlobalStatements = new Set<luaparse.Statement>();
   for (const [name, decls] of globalCandidatesByName.entries()) {
      if (keepGlobal.has(name))
         continue;
      decls.forEach(d => removeGlobalStatements.add(d.node as unknown as luaparse.Statement));
   }

   // Remove global statements across the entire tree.
   ast.body = ast.body.filter(st => !removeGlobalStatements.has(st));
   ast.body = ast.body.map(st => removeStatementsRecursively(st, removeGlobalStatements));

   // === Local functions: process each block recursively ===
   const rewriteBlock = (body: luaparse.Statement[]): luaparse.Statement[] => {
      let out = removeUnusedLocalFunctionsInBody(body, keepNames);
      out = out.map(st => {
         switch (st.type) {
            case "IfStatement":
               st.clauses.forEach(clause => {
                  clause.body = rewriteBlock(clause.body);
               });
               return st;
            case "WhileStatement":
            case "RepeatStatement":
            case "ForNumericStatement":
            case "ForGenericStatement":
            case "DoStatement":
               st.body = rewriteBlock(st.body);
               return st;
            case "FunctionDeclaration":
               st.body = rewriteBlock(st.body);
               return st;
            default:
               return st;
         }
      });
      return out;
   };

   ast.body = rewriteBlock(ast.body);
   return ast;
}
