import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {processLua, OptimizationRuleOptions} from "../src/audio/lua_processor";

const baseOpts: OptimizationRuleOptions = {
   stripComments: false,
   stripDebugBlocks: false,
   maxIndentLevel: 50,
   renameLocalVariables: false,
   aliasRepeatedExpressions: false,
   aliasLiterals: false,
   simplifyExpressions: false,
   packLocalDeclarations: false,
};

function runLua(code: string, opts: Partial<OptimizationRuleOptions>): string {
   return processLua(code, {...baseOpts, ...opts});
}

describe("Lua Optimizer", () => {
   describe("Literal Aliasing", () => {
      it("should hoist repeated string literals into a local alias when cost-effective", () => {
         const input = `
local a="hello world"
local b="hello world"
`;
         const output = runLua(input, {aliasLiterals: true});
         const expected = `local La="hello world"
local a=La
local b=La
`;
         assert.equal(output, expected);
      });

      it("should not alias literals when the cost savings are negative", () => {
         const input = `
local a=1
local b=2
`;
         const output = runLua(input, {aliasLiterals: true});
         const expected = `local a=1
local b=2
`;
         // Short literals shouldn't be aliased (1 char < "local L=1" overhead)
         assert.equal(output, expected);
      });

      it("should alias short strings when used enough times to justify overhead", () => {
         const input = `
local a="test"
local b="test"
local c="test"
local d="test"
`;
         const output = runLua(input, {aliasLiterals: true});
         const expected = `local La="test"
local a=La
local b=La
local c=La
local d=La
`;
         assert.equal(output, expected);
      });
   });

   describe("Expression Aliasing", () => {
      it("should hoist repeated safe global member expressions when cost-effective", () => {
         const input = `
local a=math.cos(1)+math.cos(2)+math.cos(3)
`;
         const output = runLua(input, {aliasRepeatedExpressions: true});
         const expected = `local _a=math.cos
local a=_a(1)+_a(2)+_a(3)
`;
         assert.equal(output, expected);
      });

      it("should hoist repeated TIC-80 global functions when cost-effective", () => {
         const input = `
local s=memcpy(0,1,2)+memcpy(3,4,5)+memcpy(6,7,8)+memcpy(9,10,11)+memcpy(12,13,14)+memcpy(15,16,17)
`;
         const output = runLua(input, {aliasRepeatedExpressions: true});
         const expected = `local _a=memcpy
local s=_a(0,1,2)+_a(3,4,5)+_a(6,7,8)+_a(9,10,11)+_a(12,13,14)+_a(15,16,17)
`;
         assert.equal(output, expected);
      });

      it("should only alias expressions from safe global bases", () => {
         const input = `
local t={}
local a=t.foo()+t.foo()+t.foo()
`;
         const output = runLua(input, {aliasRepeatedExpressions: true});
         const expected = `local t={}
local a=t.foo()+t.foo()+t.foo()
`;
         // Local table members should NOT be aliased (safety filter)
         assert.equal(output, expected);
      });

      it("should not alias when cost savings are negative", () => {
         const input = `
local a=peek(0)+peek(1)
`;
         const output = runLua(input, {aliasRepeatedExpressions: true});
         const expected = `local a=peek(0)+peek(1)
`;
         // Only 2 uses of a 4-char function: not worth the alias overhead
         assert.equal(output, expected);
      });
   });

   describe("Expression Simplification", () => {
      it("should fold constant arithmetic expressions", () => {
         const input = `
local a=1+2+3
`;
         const output = runLua(input, {simplifyExpressions: true});
         const expected = `local a=6
`;
         assert.equal(output, expected);
      });

      it("should propagate local constant values within their scope", () => {
         const input = `
local x=5
local y=x+10
`;
         const output = runLua(input, {simplifyExpressions: true});
         const expected = `local x=5
local y=15
`;
         assert.equal(output, expected);
      });

      it("should clear propagation environment after reassignment", () => {
         const input = `
local x=5
x=10
local y=x
`;
         const output = runLua(input, {simplifyExpressions: true});
         // After reassignment, the new value (10) gets propagated
         const expected = `local x=5
x=10
local y=10
`;
         assert.equal(output, expected);
      });

      it("should not propagate globals to avoid unsafe aliasing", () => {
         const input = `
g=5
local y=g+10
`;
         const output = runLua(input, {simplifyExpressions: true});
         const expected = `g=5
local y=g+10
`;
         // Globals should not be propagated
         assert.equal(output, expected);
      });
   });

   describe("Local Declaration Packing", () => {
      it("should pack consecutive local declarations with literal initializers", () => {
         const input = `
local a=1
local b=2
`;
         const output = runLua(input, {packLocalDeclarations: true});
         const expected = `local a,b=1,2
`;
         assert.equal(output, expected);
      });

      it("should not pack when there are dependencies between variables", () => {
         const input = `
local a=1
local b=a+1
`;
         const output = runLua(input, {packLocalDeclarations: true});
         const expected = `local a=1
local b=a+1
`;
         // Cannot pack when b depends on a
         assert.equal(output, expected);
      });
   });
});
