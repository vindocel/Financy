# Finanças Familiares — Ambiente (Fase 0)

Ambiente padronizado para desenvolvimento e produção, sem uso de arquivos locais em produção (Discloud é efêmero). Fonte de verdade = Postgres (Neon em prod, Postgres local em dev/test).

## Variáveis de ambiente

Veja `.env.example` para a lista completa e comentários. Principais:

- `APP_ENV`: development | production | test
- `DATABASE_URL`: dev/test usam Postgres local; prod usa Neon
- `EMAIL_DRIVER`: console | mailpit | resend
- `LOG_FORMAT`: pretty (dev) | json (prod)
- `SCRAPER_DEBUG_ARTIFACTS`: false em prod; opcional em dev
- `RESEND_API_KEY`, `SENDER_EMAIL`, `FROM_NAME`

Arquivos úteis:

- `.env.development` e `.env.test`: prontos para uso local
- `.env.example`: documenta todas as variáveis (use como base)

> Observação: `.env.production` não é versionado para evitar vazamento de segredos. Crie localmente no deploy.

## Banco de dados (Neon)

O projeto agora usa exclusivamente Postgres gerenciado (Neon) em todos os ambientes.

- Defina `DATABASE_URL` no seu `.env` com a URL do Neon (sslmode=require).
- O app executa migrações automáticas ao subir.
- Opcional (apenas dev/test): você pode semear um usuário inicial configurando `ADMIN_SEED_USERNAME` e `ADMIN_SEED_PASSWORD`. Se o usuário não existir, ele será criado no primeiro boot.

## Rodando em desenvolvimento

1) Copie `.env.example` para `.env` e ajuste `DATABASE_URL` para o Neon
2) (Opcional) defina `ADMIN_SEED_USERNAME` e `ADMIN_SEED_PASSWORD` para criar o primeiro usuário
3) Inicie o servidor:

```
npm install
npm run dev
```

O app sobe em `http://localhost:8080` (ou porta definida em `PORT`) usando o Neon.

## Identidade do usuário (Fase 1)

- Users: `username` e `email` são únicos case-insensitive; `uf` (UF do Brasil), `status` (`active|blocked`), `created_at/updated_at`.
- Login: por `username` ou `email` + senha.
- Segurança:
  - `BCRYPT_COST` configurável (10–12). Dev sugere 11; prod 12.
  - Bloqueio: `status=blocked` impede login e troca de senha.
  - Validações: formato de username/email; senha fraca rejeitada.

### Endpoints
- `POST /api/register` { username, email, password, displayName?, uf? }
  - Responde 201 com cookie `token` e dados do usuário.
- `POST /api/login` { username|email|identifier, password }
- `POST /api/me/password` { currentPassword, newPassword }

## Política de arquivos

- Produção: escrita de arquivos é desabilitada (exceto logs no stdout)
- Desenvolvimento/Testes: Postgres local. Artefatos de debug de scrapers em `./.debug` (se `SCRAPER_DEBUG_ARTIFACTS=true`)

## Teste rápido de e-mail (dev)

Endpoint de teste (apenas em dev):

```
POST /api/_dev/test-email
Body: { "to": "seu@email.com" }
```

Se `EMAIL_DRIVER=mailpit`, verifique em http://localhost:8025.
