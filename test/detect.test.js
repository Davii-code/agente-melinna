import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectStacks, summarizeStacks } from "../lib/detect.js";
import { REGISTRY, alwaysOnEntries, entriesForTags, findEntry } from "../lib/registry.js";

/** Cria um projeto falso com os arquivos dados e devolve seu caminho. */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "melinna-detect-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return dir;
}

function tagsOf(files, t) {
  const dir = fixture(files);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return detectStacks(dir).tags;
}

test("detecta Java e Spring pelo pom.xml", (t) => {
  const tags = tagsOf(
    { "pom.xml": "<project><dependency><groupId>org.springframework.boot</groupId></dependency></project>" },
    t,
  );
  assert.ok(tags.includes("java"));
  assert.ok(tags.includes("spring"));
});

test("detecta Java sem Spring quando o pom não menciona Spring", (t) => {
  const tags = tagsOf({ "pom.xml": "<project><artifactId>plain</artifactId></project>" }, t);
  assert.ok(tags.includes("java"));
  assert.ok(!tags.includes("spring"));
});

test("detecta Spring pelo build.gradle", (t) => {
  const tags = tagsOf({ "build.gradle": "plugins { id 'org.springframework.boot' }" }, t);
  assert.ok(tags.includes("java"));
  assert.ok(tags.includes("spring"));
});

test("detecta React e Next pelo package.json", (t) => {
  const tags = tagsOf(
    { "package.json": JSON.stringify({ dependencies: { react: "^19", next: "^15" } }) },
    t,
  );
  assert.ok(tags.includes("react"));
  assert.ok(tags.includes("nextjs"));
  assert.ok(tags.includes("frontend"));
  assert.ok(tags.includes("node"));
});

test("detecta Angular pelo angular.json", (t) => {
  assert.ok(tagsOf({ "angular.json": "{}" }, t).includes("angular"));
});

test("detecta NestJS pelas dependências", (t) => {
  const tags = tagsOf(
    { "package.json": JSON.stringify({ dependencies: { "@nestjs/core": "^10" } }) },
    t,
  );
  assert.ok(tags.includes("nestjs"));
});

test("detecta Flutter pelo pubspec.yaml", (t) => {
  const tags = tagsOf({ "pubspec.yaml": "name: app\ndependencies:\n  flutter:\n    sdk: flutter\n" }, t);
  assert.ok(tags.includes("dart"));
  assert.ok(tags.includes("flutter"));
});

test("detecta Dart puro sem marcar Flutter", (t) => {
  const tags = tagsOf({ "pubspec.yaml": "name: cli\ndependencies:\n  args: ^2.0.0\n" }, t);
  assert.ok(tags.includes("dart"));
  assert.ok(!tags.includes("flutter"));
});

test("detecta Fluig pelo application.info", (t) => {
  assert.ok(tagsOf({ "application.info": "" }, t).includes("fluig"));
});

test("detecta Fluig num widget um nível abaixo", (t) => {
  assert.ok(tagsOf({ "meu-widget/application.info": "" }, t).includes("fluig"));
});

test("detecta ADVPL/Protheus pelos fontes", (t) => {
  const tags = tagsOf({ "MATA010.prw": "User Function MATA010()" }, t);
  assert.ok(tags.includes("advpl"));
  assert.ok(tags.includes("protheus"));
});

test("projeto vazio não detecta stack nenhuma", (t) => {
  assert.deepEqual(tagsOf({ "leiame.txt": "oi" }, t), []);
});

test("package.json inválido não derruba a detecção", (t) => {
  assert.doesNotThrow(() => tagsOf({ "package.json": "{ isso não é json" }, t));
});

const SPRING_POM =
  "<project><dependency><groupId>org.springframework.boot</groupId></dependency></project>";

test("monorepo: detecta as stacks dos módulos a partir da raiz", (t) => {
  // Regressão: num monolito com backend/ e frontend/ nenhum marcador fica na
  // raiz, e rodar `melinna task` ali não detectava stack nenhuma.
  const tags = tagsOf(
    {
      "README.md": "# Monolito",
      "backend/pom.xml": SPRING_POM,
      "frontend/package.json": JSON.stringify({ dependencies: { react: "^19", next: "^15" } }),
    },
    t,
  );
  for (const expected of ["java", "spring", "node", "react", "nextjs"]) {
    assert.ok(tags.includes(expected), `esperava ${expected} em ${tags}`);
  }
});

test("monorepo: detecta módulos dentro de pastas-contêiner (apps/, packages/)", (t) => {
  const tags = tagsOf(
    {
      "apps/api/pom.xml": SPRING_POM,
      "packages/ui/package.json": JSON.stringify({ dependencies: { vue: "^3" } }),
    },
    t,
  );
  assert.ok(tags.includes("java"));
  assert.ok(tags.includes("vue"));
});

test("monorepo: evidência diz de qual módulo veio cada stack", (t) => {
  const dir = fixture({ "backend/pom.xml": SPRING_POM });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { evidence, modules } = detectStacks(dir);
  const java = evidence.find((e) => e.tag === "java");
  assert.equal(java.where, "backend");
  assert.ok(modules.some((m) => m.path === "backend"));
});

test("marcador na raiz é atribuído à raiz, não a um módulo", (t) => {
  const dir = fixture({ "pom.xml": SPRING_POM });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { evidence, modules } = detectStacks(dir);
  assert.equal(evidence.find((e) => e.tag === "java").where, ".");
  assert.equal(modules.length, 0, "projeto de stack única não deveria listar módulos");
});

test("node_modules não é varrido em busca de stacks", (t) => {
  // Sem o filtro, qualquer dependência com pom.xml faria o projeto virar Java.
  const tags = tagsOf(
    {
      "package.json": JSON.stringify({ dependencies: {} }),
      "node_modules/alguma-lib/pom.xml": SPRING_POM,
    },
    t,
  );
  assert.ok(tags.includes("node"));
  assert.ok(!tags.includes("java"), `node_modules não deveria contar: ${tags}`);
});

test("summarizeStacks agrupa as tags por módulo", (t) => {
  const dir = fixture({
    "backend/pom.xml": SPRING_POM,
    "frontend/package.json": JSON.stringify({ dependencies: { react: "^19" } }),
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const resumo = summarizeStacks(detectStacks(dir).evidence);
  assert.match(resumo, /backend\//);
  assert.match(resumo, /frontend\//);
});

test("registry: toda entrada tem os campos exigidos e nome único", () => {
  const names = new Set();
  for (const entry of REGISTRY) {
    assert.ok(entry.name, "entrada sem name");
    assert.match(entry.url, /^https:\/\/github\.com\//, `url suspeita em ${entry.name}`);
    assert.ok(entry.dir, `${entry.name} sem dir`);
    assert.ok(Array.isArray(entry.tags) && entry.tags.length > 0, `${entry.name} sem tags`);
    assert.ok(entry.description, `${entry.name} sem description`);
    assert.ok(!names.has(entry.name), `nome duplicado: ${entry.name}`);
    names.add(entry.name);
  }
});

test("registry: existem skills sempre-ativas de arquitetura e review", () => {
  const always = alwaysOnEntries();
  assert.ok(always.length >= 2, "esperava ao menos arquitetura e review sempre-ativas");
  const tags = always.flatMap((e) => e.tags);
  assert.ok(tags.includes("architecture"));
  assert.ok(tags.includes("review"));
});

test("registry: tags de stack resolvem para entradas, sem repetir as sempre-ativas", () => {
  for (const tag of ["java", "flutter", "fluig", "react", "advpl"]) {
    assert.ok(entriesForTags([tag]).length > 0, `nenhuma entrada para a tag ${tag}`);
  }
  assert.ok(entriesForTags(["java"]).every((e) => !e.always));
});

test("findEntry acha pelo nome e devolve null para desconhecido", () => {
  assert.ok(findEntry("fluig"));
  assert.equal(findEntry("nao-existe"), null);
});
