# Concurso de Fantasias

Votação de fantasias de Halloween com dois links:

| Link | Quem usa | Senha |
|---|---|---|
| `/votar` | Convidados. Carrossel com as fotos e nota de 1 a 10. Mostra quantas pessoas já votaram e, na hora do anúncio, os colocados que você revelar. | Não |
| `/painel` | Organizador. Envio das fotos, nomes, ordem, ranking ao vivo, botões para revelar do 4º ao 1º lugar no celular de todos, encerrar/reabrir votação, link e QR code, zerar votos. | Sim |

No painel o navegador pede usuário e senha: o usuário pode ser qualquer um, a senha é a `ADMIN_SENHA`.

As fotos e os votos ficam no banco Postgres. O disco do plano gratuito do Render é apagado a cada reinício, por isso nada é guardado em pasta.

## 1. Suba para o GitHub

```bash
git init
git add .
git commit -m "Concurso de fantasias"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/concurso-fantasias.git
git push -u origin main
```

## 2. Publique no Render

1. No Render, clique em **New → Blueprint** e escolha o repositório.
2. O Render lê o `render.yaml` e cria o site e o banco Postgres.
3. Ele pede o valor de **ADMIN_SENHA**: escolha a senha do painel.
4. Clique em **Apply**. Em alguns minutos o site fica no ar, algo como `https://concurso-fantasias.onrender.com`.

## 3. Envie as fotos

Abra `https://SEU-SITE.onrender.com/painel`, entre com a senha e arraste as fotos na seção **Fotos das fantasias**. Depois dê nome a cada fantasia e ajuste a ordem com as setas. O carrossel dos convidados atualiza na hora.

Links finais:
- Votação (para os convidados): `https://SEU-SITE.onrender.com/votar`
- Painel: `https://SEU-SITE.onrender.com/painel`

## Antes da festa

- **O plano gratuito do Render dorme** após 15 minutos sem acesso e leva cerca de 1 minuto para acordar. Abra o painel uns minutos antes de liberar a votação e deixe-o aberto durante a festa: ele consulta o site a cada 5 segundos e o mantém acordado.
- **O banco gratuito do Render expira em 30 dias.** Para uma festa é suficiente; anote o resultado no dia.
- Faça um voto de teste e depois use **Zerar votos** no painel.
- Cada celular dá uma nota por fantasia (pode trocar a nota). O controle é pelo cookie do navegador: quem abrir em aba anônima consegue votar de novo. Para festa entre conhecidos funciona bem.
- Remover uma fantasia apaga também os votos dela.

## Na hora do anúncio

No painel, seção **Revelar no celular de todos**, clique na ordem que quiser: 4º, 3º, 2º e 1º. Cada colocado aparece no celular dos convidados em até 5 segundos, com foto, nome e média. O primeiro clique encerra a votação para o ranking não mudar durante o anúncio. **Esconder resultado de todos** volta a tela dos convidados ao normal.

## Rodar no seu computador

```bash
npm install
ADMIN_SENHA=teste npm start
```

Abra `http://localhost:3000/painel` (senha `teste`). Sem `DATABASE_URL`, fotos e votos ficam na pasta `dados-local/`.
