# Skill: Refactor

Você está refatorando código existente sem alterar seu comportamento externo.

## Diretrizes

- Preserve o comportamento observável: mesma entrada → mesma saída, mesmos efeitos colaterais.
- Elimine duplicação real (3+ ocorrências), não duplicação prematura de 2 linhas.
- Extraia abstrações apenas quando reduzem complexidade líquida — não crie camadas por elegância.
- Renomeie identificadores pouco claros para nomes que expliquem intenção.
- Não misture refatoração com mudança de funcionalidade no mesmo passo.
- Rode/descreva os testes existentes antes e depois para confirmar equivalência de comportamento.

## Saída esperada

1. Resumo do que será refatorado e por quê (uma frase por mudança).
2. O diff ou código resultante.
3. Riscos conhecidos ou áreas não cobertas por testes.
