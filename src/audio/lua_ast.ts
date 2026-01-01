// AST Helper Utilities
// luaparse's AST is a bit annoying to manipulate / query; put helpers here to keep things as sane and self-documenting as possible.
import * as luaparse from "luaparse";

// Lua reserved keywords that cannot be used as variable names
export const LUA_RESERVED_WORDS = new Set([
   "and", "break", "do",  "else", "elseif", "end",    "false",  "for",  "function", "goto",  "if",
   "in",  "local", "nil", "not",  "or",     "repeat", "return", "then", "true",     "until", "while"
]);



// Walk all nodes in the AST, calling visitor for each node
export function walkAST(node: any, visitor: (node: any, parent?: any) => void, parent?: any) {
   if (!node || typeof node !== "object")
      return;

   visitor(node, parent);

   if (Array.isArray(node)) {
      node.forEach(child => walkAST(child, visitor, parent));
      return;
   }

   // Walk object properties
   for (const key of Object.keys(node)) {
      const value = node[key];
      if (key === "type" || key === "range" || key === "loc" || key === "raw")
         continue;
      if (Array.isArray(value)) {
         value.forEach(child => walkAST(child, visitor, node));
      } else if (value && typeof value === "object") {
         walkAST(value, visitor, node);
      }
   }
}

export function isIdentifier(node: any): node is luaparse.Identifier {
   return node && node.type === "Identifier";
}

export function isLocalDeclaration(node: any): boolean {
   return node && node.type === "LocalStatement";
}

// Check if a node creates a new scope
export function createsScope(node: any): boolean {
   return node &&
      (node.type === "FunctionDeclaration" || node.type === "ForNumericStatement" ||
       node.type === "ForGenericStatement" || node.type === "DoStatement" || node.type === "Chunk");
}

// Get all identifiers that are declared in a node
export function getDeclaredIdentifiers(node: any): luaparse.Identifier[] {
   const identifiers: luaparse.Identifier[] = [];

   if (node.type === "LocalStatement") {
      return node.variables.filter(isIdentifier);
   }

   if (node.type === "FunctionDeclaration") {
      return node.parameters.filter(isIdentifier);
   }

   if (node.type === "ForNumericStatement") {
      return [node.variable].filter(isIdentifier);
   }

   if (node.type === "ForGenericStatement") {
      return node.variables.filter(isIdentifier);
   }

   return identifiers;
}

// Get the body of a scope-creating node
export function getScopeBody(node: any): luaparse.Statement[]|null {
   if (node.type === "FunctionDeclaration")
      return node.body;
   if (node.type === "ForNumericStatement")
      return node.body;
   if (node.type === "ForGenericStatement")
      return node.body;
   if (node.type === "DoStatement")
      return node.body;
   if (node.type === "Chunk")
      return node.body;
   if (node.type === "IfClause")
      return node.body;
   if (node.type === "ElseifClause")
      return node.body;
   if (node.type === "ElseClause")
      return node.body;
   if (node.type === "WhileStatement")
      return node.body;
   if (node.type === "RepeatStatement")
      return node.body;
   return null;
}
