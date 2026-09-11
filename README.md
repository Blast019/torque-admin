# Painel Administrativo Central — Torque

Frontend do Painel Administrativo Central da plataforma Torque, publicado separadamente do sistema usado pelas empresas clientes (`torque.tec.br`).

Este painel é exclusivo para administradores da própria plataforma. Ele **não acessa, não lista e não expõe nenhum dado operacional das empresas clientes** (clientes, veículos, ordens de serviço, financeiro, etc.) — só gerencia autorizações de onboarding e a sessão do administrador, sempre através de RPCs do Supabase que verificam, no próprio banco, se o usuário autenticado é um administrador ativo da plataforma.

Sem build e sem framework — HTML, CSS e JavaScript simples, compatível com GitHub Pages.
