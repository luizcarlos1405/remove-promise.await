const yaml = require("yaml");
const fs = require("node:fs");
const parser = require("@babel/parser");
const types = require("@babel/types");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;

const functionsFilePath = "./remove-promise-await.yaml";
const convertedFunctions = [];
const ignoredPromiseAwaits = [];

const isPromiseAwait = (path) =>
  !types.isAwaitExpression(path.parent) &&
  path.node.callee?.object?.name === "Promise" &&
  path.node.callee?.property?.name === "await";

const isParentFunctionAsync = (parentFunction) =>
  parentFunction && parentFunction.node.async;

// Get the name of the variable of it's an arrow function
// attributed to a variable
const getFunctionName = (parentFunction) => {
  const functionName = parentFunction?.node?.key?.name
    ? parentFunction.node.key.name
    : parentFunction?.parent?.id?.name;

  // Try to get the name of the property the object is attributed to
  if (
    types.isObjectMethod(parentFunction.node) &&
    types.isAssignmentExpression(parentFunction.parentPath.parent)
  ) {
    return [parentFunction.parentPath.parent.left.name, functionName].join(".");
  }

  return functionName;
};

module.exports = function (fileInfo, api, options) {
  const ast = parser.parse(fileInfo.source, { sourceType: "module" });
  let changed = false;
  api.report(`Processing file: ${fileInfo.path}`);

  traverse(ast, {
    CallExpression(path) {
      if (isPromiseAwait(path)) {
        // Get parent function
        const parentFunction = path.getFunctionParent();
        const parentFunctionName = getFunctionName(parentFunction);

        // Trully anonymous, be inside a forEach or in the toplevel of file
        // Let's ignore these for now and keep using Promise.await
        if (!parentFunctionName) {
          const promiseAwaitStart = parentFunction.node.loc.start;
          const promiseAwaitEnd = parentFunction.node.loc.end;

          ignoredPromiseAwaits.push({
            start: `${promiseAwaitStart.line}:${promiseAwaitStart.column}`,
            end: `${promiseAwaitEnd.line}:${promiseAwaitEnd.column}`,
          });
          return;
        }

        path.replaceWith(types.awaitExpression(path.node));

        // Asyncify parent function
        if (!isParentFunctionAsync(parentFunction)) {
          const parentFunctionStart = parentFunction.node.loc.start;
          const parentFunctionEnd = parentFunction.node.loc.end;

          parentFunction.node.async = true;

          convertedFunctions.push({
            name: parentFunctionName,
            type: parentFunction.node.type,
            start: `${parentFunctionStart.line}:${parentFunctionStart.column}`,
            end: `${parentFunctionEnd.line}:${parentFunctionEnd.column}`,
          });
        }

        changed = true;
      }
    },
  });

  if (!changed) {
    return fileInfo.source;
  }

  // Generate a file report where you can see which functions were converted
  // and which Promise.await were ignored
  const fileReport = [
    {
      filePath: fileInfo.path,
      ignoredPromiseAwaits,
      convertedFunctions,
    },
  ];
  fs.appendFileSync(functionsFilePath, yaml.stringify(fileReport));

  const output = generate(
    ast,
    {
      retainLines: true,
      sourceMaps: true,
      comments: true,
      retainFunctionParens: false,
      comments: true,
      // compact: true,
      // auxiliaryCommentBefore?: string | undefined;
      // auxiliaryCommentAfter?: string | undefined;
      // shouldPrintComment?(comment: string): boolean;
      // concise?: boolean | undefined;
      // decoratorsBeforeExport?: boolean | undefined;
    },
    fileInfo.source
  );

  return output.code;
};
