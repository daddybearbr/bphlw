import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";

const PORT = process.env.PORT || 3000;
const SENHA = process.env.ADMIN_SENHA || "";
const PUBLIC = path.join(import.meta.dirname, "public");
const TIPOS = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_FOTO = 8 * 1024 * 1024;

/* ------------------------------------------------------------------
   Armazenamento: Postgres quando DATABASE_URL existe (Render),
   senão arquivos locais (para testar no seu computador).
   Fotos e votos ficam no banco, porque o disco do Render gratuito
   é apagado a cada reinício.
------------------------------------------------------------------- */
function storePg(url) {
  const pool = new pg.Pool({
    connectionString: url,
    ssl: process.env.PGSSL === "1" ? { rejectUnauthorized: false } : undefined,
  });
  const q = (sql, p) => pool.query(sql, p);
  return {
    async init() {
      await q(`CREATE TABLE IF NOT EXISTS fantasias (
        id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', participante TEXT NOT NULL DEFAULT '',
        ordem DOUBLE PRECISION NOT NULL, tipo TEXT NOT NULL, imagem BYTEA NOT NULL,
        criado TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS votos (
        votante TEXT NOT NULL, fantasia TEXT NOT NULL, nota INT NOT NULL CHECK (nota BETWEEN 1 AND 10),
        atualizado TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (votante, fantasia))`);
      await q(`CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)`);
    },
    async fantasias() {
      return (await q(`SELECT id, nome, participante, ordem FROM fantasias ORDER BY ordem, criado`)).rows;
    },
    async criar({ id, nome, participante, tipo, dados }) {
      await q(`INSERT INTO fantasias (id, nome, participante, ordem, tipo, imagem)
        VALUES ($1,$2,$3,(SELECT COALESCE(MAX(ordem),0)+1 FROM fantasias),$4,$5)`, [id, nome, participante, tipo, dados]);
    },
    async editar(id, campos) {
      const sets = [], vals = [id];
      for (const k of ["nome", "participante", "ordem"]) if (k in campos) { vals.push(campos[k]); sets.push(`${k} = $${vals.length}`); }
      if (sets.length) await q(`UPDATE fantasias SET ${sets.join(", ")} WHERE id = $1`, vals);
    },
    async remover(id) {
      await q(`DELETE FROM votos WHERE fantasia = $1`, [id]);
      await q(`DELETE FROM fantasias WHERE id = $1`, [id]);
    },
    async imagem(id) {
      const r = await q(`SELECT tipo, imagem FROM fantasias WHERE id = $1`, [id]);
      return r.rows[0] ? { tipo: r.rows[0].tipo, dados: r.rows[0].imagem } : null;
    },
    async votar(v, f, n) {
      await q(`INSERT INTO votos (votante, fantasia, nota) VALUES ($1,$2,$3)
        ON CONFLICT (votante, fantasia) DO UPDATE SET nota = EXCLUDED.nota, atualizado = now()`, [v, f, n]);
    },
    async meus(v) {
      const r = await q(`SELECT fantasia, nota FROM votos WHERE votante = $1`, [v]);
      return Object.fromEntries(r.rows.map(x => [x.fantasia, x.nota]));
    },
    async todos() { return (await q(`SELECT votante, fantasia, nota FROM votos`)).rows; },
    async participantes() { return Number((await q(`SELECT COUNT(DISTINCT votante) AS n FROM votos`)).rows[0].n); },
    async getAberta() {
      const r = await q(`SELECT valor FROM config WHERE chave = 'aberta'`);
      return r.rows.length ? r.rows[0].valor === "1" : true;
    },
    async setAberta(b) {
      await q(`INSERT INTO config (chave, valor) VALUES ('aberta', $1)
        ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`, [b ? "1" : "0"]);
    },
    async getRevelados() {
      const r = await q(`SELECT valor FROM config WHERE chave = 'revelados'`);
      try { return r.rows.length ? JSON.parse(r.rows[0].valor) : []; } catch { return []; }
    },
    async setRevelados(lista) {
      await q(`INSERT INTO config (chave, valor) VALUES ('revelados', $1)
        ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`, [JSON.stringify(lista)]);
    },
    async zerar() { await q(`DELETE FROM votos`); },
  };
}

function storeLocal() {
  const dir = path.join(import.meta.dirname, "dados-local");
  const fotos = path.join(dir, "fotos");
  const arq = path.join(dir, "dados.json");
  fs.mkdirSync(fotos, { recursive: true });
  let d = { fantasias: [], votos: {}, aberta: true };
  try { d = JSON.parse(fs.readFileSync(arq, "utf8")); } catch {}
  const salvar = () => fs.writeFileSync(arq, JSON.stringify(d));
  return {
    async init() {},
    async fantasias() { return [...d.fantasias].sort((a, b) => a.ordem - b.ordem).map(({ tipo, ...f }) => f); },
    async criar({ id, nome, participante, tipo, dados }) {
      fs.writeFileSync(path.join(fotos, id), dados);
      d.fantasias.push({ id, nome, participante, tipo, ordem: Math.max(0, ...d.fantasias.map(f => f.ordem)) + 1 });
      salvar();
    },
    async editar(id, campos) {
      const f = d.fantasias.find(x => x.id === id); if (!f) return;
      for (const k of ["nome", "participante", "ordem"]) if (k in campos) f[k] = campos[k];
      salvar();
    },
    async remover(id) {
      d.fantasias = d.fantasias.filter(f => f.id !== id);
      for (const v of Object.values(d.votos)) delete v[id];
      try { fs.unlinkSync(path.join(fotos, id)); } catch {}
      salvar();
    },
    async imagem(id) {
      const f = d.fantasias.find(x => x.id === id); if (!f) return null;
      return { tipo: f.tipo, dados: fs.readFileSync(path.join(fotos, id)) };
    },
    async votar(v, f, n) { (d.votos[v] ||= {})[f] = n; salvar(); },
    async meus(v) { return d.votos[v] || {}; },
    async todos() {
      return Object.entries(d.votos).flatMap(([votante, ns]) =>
        Object.entries(ns).map(([fantasia, nota]) => ({ votante, fantasia, nota })));
    },
    async participantes() { return Object.values(d.votos).filter(v => Object.keys(v).length).length; },
    async getAberta() { return d.aberta !== false; },
    async setAberta(b) { d.aberta = !!b; salvar(); },
    async getRevelados() { return d.revelados || []; },
    async setRevelados(lista) { d.revelados = lista; salvar(); },
    async zerar() { d.votos = {}; salvar(); },
  };
}
const store = process.env.DATABASE_URL ? storePg(process.env.DATABASE_URL) : storeLocal();

const comUrl = f => ({ id: f.id, nome: f.nome, participante: f.participante, ordem: f.ordem, url: "/fotos/" + f.id });
const POSICOES = [1, 2, 3, 4];

/* Ranking: maior média; empate decide quem recebeu mais votos. */
async function calcular() {
  const fantasias = (await store.fantasias()).map(comUrl);
  const linhas = await store.todos();
  const ids = new Set(fantasias.map(f => f.id));
  const validas = linhas.filter(l => ids.has(l.fantasia));
  const ranking = fantasias.map(f => {
    const ns = validas.filter(l => l.fantasia === f.id).map(l => l.nota);
    const soma = ns.reduce((a, b) => a + b, 0);
    const hist = Array(10).fill(0); ns.forEach(n => hist[n - 1]++);
    return { ...f, votos: ns.length, soma, media: ns.length ? soma / ns.length : 0, hist };
  }).sort((a, b) => (b.media - a.media) || (b.votos - a.votos) || (a.ordem - b.ordem));
  return {
    fantasias, ranking,
    participantes: new Set(validas.map(l => l.votante)).size,
    notas: validas.length,
  };
}

/* Estado público: o que o celular dos convidados vê. Guardado por 2 s
   para aguentar muita gente consultando ao mesmo tempo. */
let cacheEstado = null;
async function estadoPublico() {
  if (cacheEstado && Date.now() - cacheEstado.t < 2000) return cacheEstado.v;
  const [aberta, revelados, c] = await Promise.all([store.getAberta(), store.getRevelados(), calcular()]);
  const comVoto = c.ranking.filter(r => r.votos > 0);
  const resultado = revelados.filter(p => comVoto[p - 1]).sort((a, b) => b - a).map(p => {
    const r = comVoto[p - 1];
    return { posicao: p, nome: r.nome, participante: r.participante, url: r.url, media: r.media, votos: r.votos };
  });
  const v = { aberta, participantes: c.participantes, revelados, resultado };
  cacheEstado = { t: Date.now(), v };
  return v;
}
const limparCache = () => { cacheEstado = null; };
const texto = (s, max = 80) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/* ------------------------------------------------------------------ */
const app = express();
app.set("trust proxy", 1);

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map(c => {
    const i = c.indexOf("="); return i < 0 ? [] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }).filter(x => x.length));
}
function votanteId(req, res) {
  let id = cookies(req).vid;
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) {
    id = crypto.randomUUID();
    res.setHeader("Set-Cookie", `vid=${id}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${req.secure ? "; Secure" : ""}`);
  }
  return id;
}
function admin(req, res, next) {
  if (!SENHA) return res.status(503).send("Defina a variável de ambiente ADMIN_SENHA para liberar o painel.");
  const [tipo, valor] = (req.headers.authorization || "").split(" ");
  if (tipo === "Basic" && valor) {
    const senha = Buffer.from(valor, "base64").toString().split(":").slice(1).join(":");
    const a = crypto.createHash("sha256").update(senha).digest();
    const b = crypto.createHash("sha256").update(SENHA).digest();
    if (crypto.timingSafeEqual(a, b)) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Concurso de Fantasias", charset="UTF-8"').status(401)
    .send("Senha necessária. Use qualquer usuário e a senha do organizador.");
}
const pagina = nome => (req, res) => { res.set("Cache-Control", "no-store"); res.sendFile(path.join(PUBLIC, nome)); };
const erro = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ erro: "Erro no servidor. Tente de novo." }); });
const json = express.json({ limit: "10kb" });

/* Páginas */
app.get("/", (req, res) => res.redirect("/votar"));
app.get("/votar", (req, res) => { votanteId(req, res); pagina("votar.html")(req, res); });
app.get("/painel", admin, pagina("painel.html"));
app.use("/estatico", express.static(path.join(PUBLIC, "estatico"), { maxAge: "10m" }));

/* Fotos (cada id é imutável, então o cache pode ser longo) */
app.use("/fotos", erro(async (req, res) => {
  const id = req.path.replace(/^\//, "");
  if (!/^[a-f0-9-]{36}$/.test(id)) return res.status(404).send("Foto não encontrada");
  const img = await store.imagem(id);
  if (!img) return res.status(404).send("Foto não encontrada");
  res.set("Content-Type", img.tipo);
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.end(img.dados);
}));

/* API pública */
app.get("/api/fantasias", erro(async (req, res) => res.json((await store.fantasias()).map(comUrl))));
app.get("/api/estado", erro(async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(await estadoPublico());
}));
app.get("/api/meus-votos", erro(async (req, res) => res.json({ notas: await store.meus(votanteId(req, res)) })));
app.post("/api/votar", json, erro(async (req, res) => {
  const v = votanteId(req, res);
  const { fantasia, nota } = req.body || {};
  if (!(await store.getAberta())) return res.status(403).json({ erro: "A votação foi encerrada." });
  if (!Number.isInteger(nota) || nota < 1 || nota > 10) return res.status(400).json({ erro: "A nota precisa ser de 1 a 10." });
  if (!(await store.fantasias()).some(f => f.id === fantasia)) return res.status(404).json({ erro: "Fantasia não encontrada." });
  await store.votar(v, fantasia, nota);
  res.json({ ok: true, participantes: await store.participantes() });
  if (cacheEstado) cacheEstado.t = 0;
}));

/* API do organizador */
app.get("/api/admin/resultados", admin, erro(async (req, res) => {
  const [aberta, revelados, c] = await Promise.all([store.getAberta(), store.getRevelados(), calcular()]);
  res.json({ aberta, revelados, ...c });
}));
app.post("/api/admin/fantasias", admin, express.raw({ type: () => true, limit: MAX_FOTO }), erro(async (req, res) => {
  const tipo = String(req.headers["content-type"] || "").split(";")[0].trim();
  if (!TIPOS.has(tipo)) return res.status(415).json({ erro: "Formato não suportado. Use JPG, PNG ou WEBP." });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ erro: "Arquivo vazio." });
  const id = crypto.randomUUID();
  const nome = texto(decodeURIComponent(String(req.headers["x-nome"] || ""))) || "Fantasia sem nome";
  await store.criar({ id, nome, participante: "", tipo, dados: req.body });
  limparCache();
  res.json({ ok: true, id });
}));
app.post("/api/admin/fantasias/editar", admin, json, erro(async (req, res) => {
  const { id, nome, participante } = req.body || {};
  const campos = {};
  if (nome !== undefined) campos.nome = texto(nome) || "Fantasia sem nome";
  if (participante !== undefined) campos.participante = texto(participante);
  await store.editar(String(id), campos);
  limparCache();
  res.json({ ok: true });
}));
app.post("/api/admin/fantasias/mover", admin, json, erro(async (req, res) => {
  const { id, direcao } = req.body || {};
  const lista = await store.fantasias();
  const i = lista.findIndex(f => f.id === id), j = i + (direcao < 0 ? -1 : 1);
  if (i < 0 || !lista[j]) return res.json({ ok: true });
  await store.editar(lista[i].id, { ordem: lista[j].ordem });
  await store.editar(lista[j].id, { ordem: lista[i].ordem });
  res.json({ ok: true });
}));
app.post("/api/admin/fantasias/remover", admin, json, erro(async (req, res) => {
  await store.remover(String((req.body || {}).id));
  limparCache();
  res.json({ ok: true });
}));
app.post("/api/admin/estado", admin, json, erro(async (req, res) => {
  await store.setAberta(!!(req.body && req.body.aberta));
  limparCache();
  res.json({ aberta: await store.getAberta() });
}));
app.post("/api/admin/zerar", admin, json, erro(async (req, res) => {
  if (!req.body || req.body.confirmar !== "ZERAR") return res.status(400).json({ erro: "Confirmação inválida." });
  await store.zerar();
  await store.setRevelados([]);
  limparCache();
  res.json({ ok: true });
}));
/* Revelar ou esconder um colocado no celular de todos.
   Revelar qualquer posição encerra a votação, para o ranking não mudar no meio do anúncio. */
app.post("/api/admin/revelar", admin, json, erro(async (req, res) => {
  const { posicao, revelar, limpar } = req.body || {};
  let lista = await store.getRevelados();
  if (limpar) lista = [];
  else {
    if (!POSICOES.includes(posicao)) return res.status(400).json({ erro: "Posição inválida." });
    lista = lista.filter(p => p !== posicao);
    if (revelar) {
      const comVoto = (await calcular()).ranking.filter(r => r.votos > 0);
      if (!comVoto[posicao - 1]) return res.status(400).json({ erro: `Não há fantasia com votos no ${posicao}º lugar.` });
      lista.push(posicao);
      await store.setAberta(false);
    }
  }
  await store.setRevelados(lista.sort((a, b) => b - a));
  limparCache();
  res.json({ ok: true, revelados: lista, aberta: await store.getAberta() });
}));

await store.init();
app.listen(PORT, () => {
  console.log(`Concurso de Fantasias rodando na porta ${PORT}`);
  console.log(`Banco: ${process.env.DATABASE_URL ? "Postgres" : "arquivos locais (pasta dados-local)"}`);
  if (!SENHA) console.warn("ATENÇÃO: defina ADMIN_SENHA para liberar o /painel.");
});
