import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { select } from "@inquirer/prompts";
import { isOnPath, runInherit } from "../tools.js";

/**
 * Integrações aceitas pelo `specify init --integration`.
 *
 * `gemini` saiu: o Gemini CLI foi descontinuado e o sucessor é o Antigravity
 * (`agy`), o mesmo racional documentado em lib/agents.js.
 */
const INTEGRATION_CHOICES = ["claude", "copilot", "cursor_agent", "codex", "agy"];

/**
 * `melinna speckit <feature-name>`: chama a CLI real do spec-kit (`specify init --here`)
 * para gerar a estrutura completa (.specify/ + slash commands /speckit.* do agente
 * escolhido) no diretório atual, em vez do template manual usado por `start-feature`.
 * O ciclo specify → plan → tasks → implement roda dentro do agente de IA (fora da
 * Melinna, que não mantém um loop de agente próprio) — este comando prepara o terreno
 * e imprime os próximos passos.
 */
export async function speckit(cwd, featureName, options) {
  const hasSpecify = await isOnPath("specify");
  if (!hasSpecify) {
    console.log(chalk.red("Binário `specify` não encontrado no PATH."));
    console.log(chalk.dim("Instale com: uv tool install specify-cli"));
    process.exitCode = 1;
    return;
  }

  let integration = options.integration;
  if (integration) {
    // Validado contra a lista porque o valor vem da linha de comando e vira
    // argumento de um processo filho — nunca repassar entrada livre para lá.
    if (!INTEGRATION_CHOICES.includes(integration)) {
      console.log(chalk.red(`Integração "${integration}" não é suportada.`));
      console.log(chalk.dim(`Use uma de: ${INTEGRATION_CHOICES.join(", ")}`));
      process.exitCode = 1;
      return;
    }
  } else {
    integration = await select({
      message: "Agente de IA para integrar (gera os slash commands /speckit.*):",
      choices: INTEGRATION_CHOICES.map((a) => ({ name: a, value: a })),
    });
  }

  const specifyDir = join(cwd, ".specify");
  if (existsSync(specifyDir)) {
    console.log(chalk.yellow(".specify/ já existe neste diretório — pulando `specify init`."));
    return;
  }

  // Sem `--force`: o guard acima já garante que .specify/ não existe, e deixar a
  // flag ligada faria o specify sobrescrever outros arquivos do diretório sem aviso.
  console.log(chalk.cyan(`Rodando \`specify init --here --integration ${integration}\`...`));
  const code = await runInherit("specify", ["init", "--here", "--integration", integration], { cwd });
  if (code !== 0) {
    console.log(chalk.red(`\`specify init\` saiu com código ${code}.`));
    process.exitCode = code;
    return;
  }

  // `specify init` já imprime seu próprio painel "Next Steps" com os comandos/skills
  // corretos para a integração escolhida (o nome e o local variam por agente e versão
  // do spec-kit, por isso não duplicamos essa lista aqui).
  console.log("");
  console.log(chalk.green(`✔ Spec-kit inicializado para a feature "${featureName}".`));
  console.log(chalk.dim("Siga os próximos passos impressos acima pelo `specify init`, começando por:"));
  console.log(`  ${chalk.bold(`/speckit.specify ${featureName}`)}`);
}
