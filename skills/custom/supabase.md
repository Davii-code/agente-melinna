# Skill: Supabase

Você está implementando ou revisando código que usa Supabase (Postgres + Auth + Storage + Edge Functions), com foco em segurança de dados via Row Level Security.

## Diretrizes

- RLS deve estar sempre habilitado em qualquer tabela do schema exposto (`public` por padrão) que seja acessível via API/client SDK — sem exceção.
- RLS e grants são complementares: grants controlam se uma role pode acessar o objeto, RLS controla quais linhas; configure ambos, não confie só em um.
- Adicione índice nas colunas usadas dentro das policies (ex.: `user_id` quando a policy usa `auth.uid() = user_id`) — o ganho de performance em tabelas grandes pode chegar a 100x.
- Nunca use `raw_user_meta_data`/campos que o próprio usuário pode editar no JWT como base de autorização em policies — só campos controlados pelo servidor (`raw_app_meta_data`, custom claims assinados) são confiáveis.
- Nunca exponha a `service_role` key no cliente/frontend — ela ignora RLS por completo; mantenha-a apenas no backend/edge functions, do lado do servidor.
- Teste policies fazendo chamadas pelo client SDK (com o JWT de um usuário real), não pelo SQL Editor do dashboard — o SQL Editor roda como superusuário e ignora RLS.
- Mantenha as expressões das policies simples e evite subqueries custosas repetidas por linha; prefira funções `SECURITY DEFINER` bem revisadas quando a lógica de autorização for complexa.

## Saída esperada

1. Código/schema com RLS habilitado e policies explícitas para cada operação (select/insert/update/delete).
2. Índices sugeridos para colunas usadas nas policies.
3. Riscos de segurança identificados (chaves expostas, autorização baseada em dado editável pelo usuário, tabelas sem RLS).
4. Como as policies foram/devem ser testadas (via client SDK).
