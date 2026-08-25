import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, listSkills, readSkill, selectSkills } from "../lib/skills.js";

/** Monta um pacote Melinna falso com as skills pedidas, e devolve sua raiz. */
function fixtureRoot(skills) {
  const root = mkdtempSync(join(tmpdir(), "melinna-skills-"));
  for (const [path, content] of Object.entries(skills)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return root;
}

const JAVA_SKILL = `---
name: java-architect
description: Spring Boot 3.x, JPA e microserviços.
metadata:
  triggers: Spring Boot, Java, JPA
---

# Java Architect
`;

test("parseFrontmatter lê name, description e metadata.triggers", () => {
  const meta = parseFrontmatter(JAVA_SKILL);
  assert.equal(meta.name, "java-architect");
  assert.equal(meta.description, "Spring Boot 3.x, JPA e microserviços.");
  assert.equal(meta.triggers, "Spring Boot, Java, JPA");
});

test("parseFrontmatter devolve vazio sem frontmatter", () => {
  assert.deepEqual(parseFrontmatter("# Só um título\n"), {});
});

test("listSkills acha SKILL.md e .md solto", (t) => {
  const root = fixtureRoot({
    "skills/custom/refactor.md": "# Refactor\n",
    "skills/external/java-architect/SKILL.md": JAVA_SKILL,
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const ids = listSkills(root).map((s) => s.id);
  assert.ok(ids.includes("refactor"), `esperava refactor em ${ids}`);
  assert.ok(ids.includes("java-architect"), `esperava java-architect em ${ids}`);
});

test("readSkill recusa nome com travessia de caminho", (t) => {
  const root = fixtureRoot({ "skills/custom/refactor.md": "# Refactor\n" });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  for (const bad of ["../../../etc/passwd", "..\\..\\secrets", "sub/dir.md"]) {
    assert.throws(() => readSkill(root, bad), /inválido/, `deveria recusar ${bad}`);
  }
});

test("readSkill encontra por id e por nome de arquivo", (t) => {
  const root = fixtureRoot({ "skills/custom/refactor.md": "# Refactor\n" });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.match(readSkill(root, "refactor"), /# Refactor/);
  assert.match(readSkill(root, "refactor.md"), /# Refactor/);
  assert.throws(() => readSkill(root, "nao-existe"), /não encontrada/);
});

test("selectSkills prioriza a skill da stack detectada", () => {
  const skills = [
    { id: "java-architect", description: "Spring Boot", triggers: "Java, Spring", source: "x" },
    { id: "flutter", description: "Flutter apps", triggers: "Dart", source: "x" },
  ];
  const chosen = selectSkills(skills, ["java", "spring"]);
  assert.equal(chosen[0].id, "java-architect");
  assert.ok(!chosen.some((s) => s.id === "flutter"), "flutter não deveria casar com java");
});

test("selectSkills sempre inclui arquitetura e review, mesmo sem stack", () => {
  const skills = [
    { id: "software-architecture", description: "Clean Architecture", triggers: "", source: "x" },
    { id: "code-review", description: "Revisão", triggers: "", source: "x" },
    { id: "flutter", description: "Flutter apps", triggers: "Dart", source: "x" },
  ];
  const ids = selectSkills(skills, []).map((s) => s.id);
  assert.ok(ids.includes("software-architecture"), `esperava arquitetura em ${ids}`);
  assert.ok(ids.includes("code-review"), `esperava review em ${ids}`);
  assert.ok(!ids.includes("flutter"), "flutter não deveria entrar sem stack Dart");
});

test("selectSkills casa tag como palavra inteira, não substring", () => {
  // Regressão: `"javascript-pro".includes("java")` é true, então um projeto Java
  // recebia uma skill de JavaScript entre as escolhidas.
  const skills = [
    { id: "javascript-pro", description: "JS moderno", triggers: "JavaScript", source: "x" },
    { id: "java-architect", description: "Spring Boot", triggers: "Java", source: "x" },
  ];
  const ids = selectSkills(skills, ["java", "spring"]).map((s) => s.id);
  assert.ok(ids.includes("java-architect"));
  assert.ok(!ids.includes("javascript-pro"), `javascript-pro não deveria casar com java: ${ids}`);
});

test("selectSkills descarta skill amarrada a outra stack", () => {
  const skills = [
    { id: "python-architecture-review", description: "Arquitetura", triggers: "Python", source: "x" },
    { id: "architecture-designer", description: "Arquitetura", triggers: "", source: "x" },
  ];
  const ids = selectSkills(skills, ["node"]).map((s) => s.id);
  assert.ok(!ids.includes("python-architecture-review"), `python não deveria entrar: ${ids}`);
  assert.ok(ids.includes("architecture-designer"));
});

test("selectSkills reserva vaga para arquitetura e review mesmo com muitas skills da stack", () => {
  // Regressão: num projeto Fluig as 16 skills de Fluig enchiam o limite e a
  // validação arquitetural nunca chegava ao prompt.
  const skills = [
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `fluig-skill-${i}`,
      description: "Fluig",
      triggers: "fluig",
      source: "x",
    })),
    { id: "architecture-designer", description: "Arquitetura", triggers: "", source: "x" },
    { id: "code-review", description: "Revisão", triggers: "", source: "x" },
  ];
  const ids = selectSkills(skills, ["fluig"], { limit: 4 }).map((s) => s.id);
  assert.equal(ids.length, 4);
  assert.ok(ids.includes("architecture-designer"), `esperava arquitetura em ${ids}`);
  assert.ok(ids.includes("code-review"), `esperava review em ${ids}`);
  assert.ok(ids.some((id) => id.startsWith("fluig-")), `esperava ao menos uma skill Fluig em ${ids}`);
});

test("selectSkills prefere a skill genérica do papel no empate", () => {
  // Regressão: num registry grande, `codex-review` (sobre uma ferramenta) e
  // `rag-architect` (sobre um padrão de IA) empatavam com as genéricas e
  // ganhavam no desempate alfabético.
  const skills = [
    { id: "codex-review", description: "Codex CLI", triggers: "", source: "x" },
    { id: "code-review", description: "Revisão de código", triggers: "", source: "x" },
    { id: "rag-architect", description: "RAG", triggers: "", source: "x" },
    { id: "architecture-designer", description: "Arquitetura", triggers: "", source: "x" },
  ];
  const ids = selectSkills(skills, [], { limit: 2 }).map((s) => s.id);
  assert.ok(ids.includes("code-review"), `esperava code-review em ${ids}`);
  assert.ok(ids.includes("architecture-designer"), `esperava architecture-designer em ${ids}`);
});

test("selectSkills respeita o limite", () => {
  const skills = Array.from({ length: 20 }, (_, i) => ({
    id: `java-skill-${i}`,
    description: "java",
    triggers: "java",
    source: "x",
  }));
  assert.equal(selectSkills(skills, ["java"], { limit: 3 }).length, 3);
});
