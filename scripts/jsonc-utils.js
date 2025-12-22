
function stripJsonComments(text) {
  // Remove /* block comments */
  let result = text.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove // line comments (assumes no // inside string literals or line continuations)
  result = result.replace(/(^|[^:\\])\/\/.*$/gm, "$1");
  return result;
}

function parseJSONWithComments(text) {
  const stripped = stripJsonComments(String(text));
  return JSON.parse(stripped);
}

module.exports = {
  stripJsonComments,
  parseJSONWithComments,
};
