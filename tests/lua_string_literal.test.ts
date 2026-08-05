import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {toLuaStringLiteral} from "../src/utils/lua/lua_fundamentals";
import {OptimizationRuleOptions, processLua} from "../src/utils/lua/lua_processor";
import {decodeRawString} from "../src/utils/lua/lua_utils";

const printOnlyOptions: OptimizationRuleOptions = {
   stripComments: false,
   stripDebugBlocks: false,
   maxIndentLevel: 50,
   lineBehavior: "pretty",
   maxLineLength: 120,
   renameLocalVariables: false,
   aliasRepeatedExpressions: false,
   aliasLiterals: false,
   simplifyExpressions: false,
   removeUnusedLocals: false,
   removeUnusedFunctions: false,
   functionNamesToKeep: [],
   renameTableFields: false,
   tableEntryKeysToRename: [],
   packLocalDeclarations: false,
};

describe("compact Lua string literals", () => {
   it("uses quotes for ordinary text and long brackets when escaping costs more", () => {
      assert.equal(toLuaStringLiteral("ordinary"), '"ordinary"');
      assert.equal(toLuaStringLiteral('a"b'), '"a\\"b"');

      const troublesome = '"""\\\\payload]]tail';
      const literal = toLuaStringLiteral(troublesome);
      assert.equal(literal, `[=[${troublesome}]=]`);
      assert.equal(decodeRawString(literal), troublesome);
   });

   it("selects the smallest valid long-bracket delimiter", () => {
      assert.equal(toLuaStringLiteral('"""'), `[["""]]`);
      assert.equal(toLuaStringLiteral('""""" ]]'), `[=[""""" ]]]=]`);
      assert.equal(toLuaStringLiteral('""""""" ]] and ]=]'), `[==[""""""" ]] and ]=]]==]`);
   });

   it("preserves long-bracket payloads through parse and print", () => {
      const value = '"""\\\\payload]]tail';
      const literal = toLuaStringLiteral(value);
      const output = processLua(`local payload=${literal}\n`, printOnlyOptions);
      assert.ok(output.includes(literal), output);
   });
});
