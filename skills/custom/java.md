# Skill: Java

Você está implementando ou revisando código Java moderno (17+), com foco em concorrência segura, imutabilidade e legibilidade.

## Diretrizes

- Prefira `record` para tipos de dados imutáveis simples em vez de classes com boilerplate de getters/equals/hashCode/toString escritos à mão.
- Para I/O bloqueante de alto volume (requisições HTTP, JDBC, chamadas a serviços externos), prefira virtual threads (`Thread.ofVirtual()`/executores virtuais) em vez de pools de threads de plataforma; para trabalho CPU-bound, mantenha threads de plataforma com pool dimensionado.
- Evite `synchronized` em blocos que fazem I/O dentro de virtual threads — isso "pina" a virtual thread à carrier thread e anula o ganho de escalabilidade; prefira `ReentrantLock` quando precisar de exclusão mútua em código com I/O.
- Minimize uso de `ThreadLocal` em contexto de virtual threads (elas podem ser reaproveitadas entre threads de SO de forma imprevisível); prefira mecanismos explícitos de propagação de contexto.
- Use `Optional` apenas como tipo de retorno para indicar ausência de valor — nunca como campo, parâmetro de método ou dentro de coleções.
- Prefira streams para transformações de coleções quando isso aumentar clareza, mas não force pipelines encadeados ilegíveis onde um loop simples seria mais direto.
- Trate exceções de forma específica; nunca capture `Exception`/`Throwable` genericamente sem re-lançar ou logar com contexto suficiente para debug.

## Saída esperada

1. Código com tipos imutáveis e modelo de concorrência apropriado ao tipo de carga (I/O-bound vs CPU-bound).
2. Justificativa quando virtual threads, locks ou records forem introduzidos.
3. Pontos de atenção sobre pinning de threads, vazamento de recursos ou exceções engolidas.
4. Testes sugeridos, incluindo casos de concorrência quando aplicável.
