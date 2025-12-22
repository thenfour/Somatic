// Simple Webpack loader for JSON with comments (.jsonc)
// Delegates parsing to the shared jsonc-utils helper.

const { parseJSONWithComments } = require('./jsonc-utils');

module.exports = function jsoncLoader(source) {
  const obj = parseJSONWithComments(source.toString());
  return 'module.exports = ' + JSON.stringify(obj, null, 2) + ';';
};
