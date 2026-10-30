// Funções compartilhadas pelo painel.
window.CF = (() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt = n => n.toLocaleString("pt-BR", {minimumFractionDigits:2, maximumFractionDigits:2});
  async function api(url, opts){
    const r = await fetch(url, {credentials:"same-origin", headers:{"Content-Type":"application/json"}, ...opts});
    const j = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error(j.erro || "Falha de conexão");
    return j;
  }
  const linkVotacao = () => location.origin + "/votar";
  function qrSvg(texto){
    if(typeof window.qrcode !== "function") return "";
    const q = window.qrcode(0, "M"); q.addData(texto); q.make();
    return q.createSvgTag({cellSize:4, margin:0, scalable:true});
  }
  // Pódio: ordem visual 2º, 1º, 3º.
  function podioHTML(top, revelados){
    return `<div class="podio">${[1,0,2].map(k => {
      const r = top[k]; if(!r) return `<div></div>`;
      const visivel = revelados === undefined || (top.length - k) <= revelados;
      return `<div class="degrau ${visivel ? "" : "oculto"}" data-p="${k+1}">
        <div class="pos">${k+1}º lugar</div>
        <div class="foto"><img src="${esc(r.url)}" alt="Foto da fantasia ${esc(r.nome)}"></div>
        <h3>${esc(r.nome)}</h3>
        <div class="media"><b>${fmt(r.media)}</b> de média · ${r.votos} ${r.votos===1?"voto":"votos"}${r.participante ? " · " + esc(r.participante) : ""}</div>
      </div>`;
    }).join("")}</div>`;
  }
  return {esc, fmt, api, linkVotacao, qrSvg, podioHTML};
})();
