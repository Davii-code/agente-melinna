import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SLASH_COMMANDS,
  commandsDir,
  installSlashCommands,
  removeSlashCommands,
  listInstalled,
} from "../lib/slash.js";

function tempProject(t) {
  const dir = mkdtempSync(join(tmpdir(), "melinna-slash-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("os comandos declaram frontmatter válido", () => {
  for (const command of SLASH_COMMANDS) {
    assert.match(command.body, /^---\ndescription: .+\n/, `${command.name}: frontmatter inválido`);
    assert.ok(command.body.includes("\n---\n"), `${command.name}: frontmatter não fechado`);
    assert.ok(command.summary, `${command.name}: sem resumo para a listagem`);
  }
});

test("cada comando manda o modelo chamar a ferramenta MCP certa", () => {
  // O prompt precisa nomear a ferramenta: é o modelo que tem o contexto da
  // conversa, e é ele quem deve chamar.
  const esperado = {
    "melinna-salvar": "melinna_vault_save",
    "melinna-diario": "melinna_journal_add",
    "melinna-contexto": "melinna_vault_read",
  };
  for (const command of SLASH_COMMANDS) {
    assert.match(command.body, new RegExp(esperado[command.name]), `${command.name}: ferramenta errada`);
  }
});

test("/melinna-salvar cobre todos os campos da nota", () => {
  const salvar = SLASH_COMMANDS.find((c) => c.name === "melinna-salvar");
  for (const campo of ["resumo", "arquitetura", "decisoes", "regras", "atencao"]) {
    assert.match(salvar.body, new RegExp(`\`${campo}\``), `faltou instruir o campo ${campo}`);
  }
  assert.match(salvar.body, /uma linha/i, "o resumo precisa ser pedido em uma linha só");
});

test("commandsDir separa HOME de projeto", (t) => {
  const dir = tempProject(t);
  assert.equal(commandsDir({ project: dir }), join(dir, ".claude", "commands"));
  assert.ok(!commandsDir().includes(dir), "sem --project deveria usar o HOME");
});

test("install escreve os comandos e list os enxerga", (t) => {
  const dir = tempProject(t);
  const { written, skipped } = installSlashCommands({ project: dir });

  assert.equal(written.length, SLASH_COMMANDS.length);
  assert.equal(skipped.length, 0);
  for (const command of SLASH_COMMANDS) {
    assert.ok(existsSync(join(dir, ".claude", "commands", `${command.name}.md`)), `${command.name} não escrito`);
  }
  assert.deepEqual(listInstalled({ project: dir }).sort(), SLASH_COMMANDS.map((c) => c.name).sort());
});

test("install não sobrescreve um comando escrito pelo usuário", (t) => {
  const dir = tempProject(t);
  const commands = join(dir, ".claude", "commands");
  mkdirSync(commands, { recursive: true });
  const meu = join(commands, "melinna-diario.md");
  writeFileSync(meu, "---\ndescription: meu\n---\nnao me apague\n", "utf-8");

  const { written, skipped } = installSlashCommands({ project: dir });
  assert.deepEqual(skipped, ["melinna-diario"]);
  assert.ok(!written.includes("melinna-diario"));
  assert.match(readFileSync(meu, "utf-8"), /nao me apague/, "o arquivo do usuário foi sobrescrito");
});

test("--force sobrescreve o arquivo do usuário", (t) => {
  const dir = tempProject(t);
  const commands = join(dir, ".claude", "commands");
  mkdirSync(commands, { recursive: true });
  const meu = join(commands, "melinna-diario.md");
  writeFileSync(meu, "nao me apague\n", "utf-8");

  const { written, skipped } = installSlashCommands({ project: dir, force: true });
  assert.deepEqual(skipped, []);
  assert.ok(written.includes("melinna-diario"));
  assert.ok(!readFileSync(meu, "utf-8").includes("nao me apague"));
});

test("reinstalar não gera pendências", (t) => {
  const dir = tempProject(t);
  installSlashCommands({ project: dir });
  const segunda = installSlashCommands({ project: dir });
  assert.equal(segunda.skipped.length, 0, "o próprio arquivo da Melinna não deveria ser pulado");
  assert.equal(segunda.written.length, SLASH_COMMANDS.length);
});

test("remove apaga só os arquivos da Melinna", (t) => {
  const dir = tempProject(t);
  const commands = join(dir, ".claude", "commands");
  installSlashCommands({ project: dir });

  const alheio = join(commands, "outro-comando.md");
  writeFileSync(alheio, "meu comando\n", "utf-8");
  const meuDiario = join(commands, "melinna-diario.md");
  writeFileSync(meuDiario, "versao minha\n", "utf-8");

  const { removed } = removeSlashCommands({ project: dir });
  assert.ok(removed.includes("melinna-salvar"));
  assert.ok(!removed.includes("melinna-diario"), "arquivo do usuário não deveria ser removido");
  assert.ok(existsSync(alheio), "comando alheio foi apagado");
  assert.ok(existsSync(meuDiario), "arquivo do usuário foi apagado");
});

test("remove em diretório inexistente não estoura", (t) => {
  const dir = tempProject(t);
  assert.doesNotThrow(() => removeSlashCommands({ project: dir }));
  assert.deepEqual(listInstalled({ project: dir }), []);
});
