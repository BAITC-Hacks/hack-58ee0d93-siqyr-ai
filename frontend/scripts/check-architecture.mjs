import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve('src');
function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(filename) : /\.tsx?$/.test(filename) ? [filename] : [];
  });
}
const files = filesIn(root);
const graph = new Map(files.map((file) => [file, []]));
const failures = [];
const relative = (file) => path.relative(root, file).split(path.sep).join('/');

for (const file of files) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const from = relative(file);
  function check(specifier, typeOnly = false, lazy = false) {
    const target = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : undefined;
    const to = target ? relative(target) : specifier;
    let reason;
    if (from.startsWith('shared/') && target && !to.startsWith('shared/')) reason = 'shared cannot depend on application features';
    if (from.includes('/domain/') && (!target || !(to.includes('/domain/') || to.startsWith('shared/domain/')))) reason = 'domain must depend only on domain code';
    if (from.includes('/application/') && (!target || /(^app\/|\/presentation\/|\/infrastructure\/|^infrastructure\/)/.test(to))) reason = 'application cannot depend on React or concrete adapters';
    if (from.includes('/presentation/') && target && /(^app\/|^infrastructure\/|\/infrastructure\/)/.test(to)) reason = 'presentation must use injected services';
    if ((from.startsWith('infrastructure/') || from.includes('/infrastructure/')) && target && /(^app\/|\/presentation\/)/.test(to)) reason = 'adapters cannot depend on app or React presentation';
    if (reason) failures.push(`${from} -> ${specifier}: ${reason}`);
    if (target && !typeOnly && !lazy) {
      const resolved = [target, `${target}.ts`, `${target}.tsx`, path.join(target, 'index.ts'), path.join(target, 'index.tsx')].find((candidate) => graph.has(candidate));
      if (resolved) graph.get(file).push(resolved);
    }
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
      const bindings = clause?.namedBindings;
      const typeOnly = node.isTypeOnly || clause?.isTypeOnly || (!clause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly));
      check(node.moduleSpecifier.text, Boolean(typeOnly));
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) check(node.arguments[0].text, false, true);
    ts.forEachChild(node, visit);
  }
  visit(source);
}

const visited = new Set();
const active = new Set();
function walk(file, trail) {
  if (active.has(file)) { failures.push(`Runtime import cycle: ${[...trail, file].map(relative).join(' -> ')}`); return; }
  if (visited.has(file)) return;
  active.add(file);
  for (const next of graph.get(file)) walk(next, [...trail, file]);
  active.delete(file);
  visited.add(file);
}
for (const file of files) walk(file, []);
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Architecture OK: ${files.length} source files, dependency boundaries and runtime cycles checked.`);
