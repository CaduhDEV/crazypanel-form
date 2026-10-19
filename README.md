# crazypanel-form

Formulário público de entrada na **comunidade DataCrazy** no WhatsApp. Confirma a identidade da pessoa em etapas antes de o pedido chegar ao [CrazyPanel](https://github.com/CaduhDEV/crazypanel-v2):

1. **Nome**
2. **E-mail**: código de 6 dígitos enviado pelo Supabase Auth do painel
3. **WhatsApp**: código de 6 dígitos enviado pelo WhatsApp (uazapi)

Com os dois confirmados, o painel procura a empresa pelo e-mail (Gleap e CRM DataCrazy), grava o telefone `+55DDDNUMERO` nas sessões do Gleap daquele e-mail e cria a solicitação de entrada, marcada como verificada, para um admin aceitar ou recusar.

## Como funciona

O navegador só conversa com este site. A rota `app/api/step/[...path]` repassa cada etapa para `PANEL_API_URL/api/verify/*` com o header `x-form-key`. Nenhuma chave do Supabase, da uazapi, do Gleap ou do CRM fica aqui: tudo isso vive no painel.

Limites (definidos no painel): espera de 60 s entre reenvios, até 5 envios por hora, 5 erros por código e bloqueio de 30 min depois de 10 erros.

## Rodando

```bash
cp .env.example .env.local   # PANEL_API_URL e FORM_API_KEY (a mesma do painel)
npm install
npm run dev                  # http://localhost:3001
```

Para testar de fora (celular), exponha o painel e o formulário com `cloudflared tunnel --url http://localhost:3000` e `--url http://localhost:3001`, e coloque a URL do túnel do painel em `PANEL_API_URL`.
