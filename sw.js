/* Resenha Trip — service worker
   Objetivo: o app abrir SEMPRE, mesmo sem internet (essencial durante a viagem).
   - Guarda o "casco" do app (index.html, config.js, ícone) no cache do aparelho
   - Guarda também as fontes e o SDK do Firebase, que vêm de fora
   - NUNCA intercepta o tráfego do Firestore: ele tem o próprio mecanismo offline
   Ao publicar uma versão nova, troque o número em VERSAO abaixo.            */

const VERSAO = "resenha-v20";
const CACHE_APP = "app-" + VERSAO;
const CACHE_EXT = "ext-" + VERSAO;

/* arquivos do próprio site */
const CASCO = ["./", "./index.html", "./config.js", "./manifest.json",
                "./icon.png", "./icon-192.png", "./icon-512.png"];

/* domínios externos que valem a pena guardar (fontes e SDK do Firebase) */
const EXTERNOS = ["fonts.googleapis.com", "fonts.gstatic.com", "www.gstatic.com"];

/* nunca tocar nesses: o Firestore cuida do próprio offline */
const NUNCA = ["firestore.googleapis.com", "firebaseinstallations.googleapis.com",
               "identitytoolkit.googleapis.com", "securetoken.googleapis.com",
               "firebaseappcheck.googleapis.com", "recaptcha.net", "www.google.com",
               "economia.awesomeapi.com.br", "api.exchangerate", "open.er-api.com"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_APP)
      .then(c => c.addAll(CASCO))
      .then(() => self.skipWaiting())
      .catch(err => console.warn("SW install:", err))
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE_APP && k !== CACHE_EXT).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Marca que existe versão nova. Usa um marcador guardado no cache porque
   um postMessage pode chegar antes de a página estar ouvindo (corrida). */
const MARCA = "./__update__";
async function avisarAtualizacao() {
  try {
    const c = await caches.open(CACHE_APP);
    await c.put(MARCA, new Response("1"));
  } catch (e) { /* segue */ }
  const cs = await self.clients.matchAll({ type: "window" });
  cs.forEach(c => c.postMessage({ type: "update-ready" }));
}

/* HTML: entrega do cache na hora (rápido e funciona offline)
   e revalida por trás; se mudou, avisa o app para oferecer atualizar */
async function casco(req) {
  const cache = await caches.open(CACHE_APP);
  const guardado = await cache.match("./index.html");

  const rede = fetch(req).then(async res => {
    if (res && res.ok) {
      const marcaAnt = guardado && (guardado.headers.get("etag") || guardado.headers.get("content-length"));
      const marcaNova = res.headers.get("etag") || res.headers.get("content-length");
      await cache.put("./index.html", res.clone());
      if (guardado && marcaAnt && marcaNova && marcaAnt !== marcaNova) avisarAtualizacao();
    }
    return res;
  }).catch(() => null);

  if (guardado) return guardado;
  const res = await rede;
  return res || new Response(
    "<h1>Sem conexão</h1><p>Abra o app uma vez com internet para ele ficar disponível offline.</p>",
    { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 }
  );
}

/* arquivos do site que não são o HTML (config.js, ícone): cache primeiro */
async function arquivoLocal(req) {
  const cache = await caches.open(CACHE_APP);
  const guardado = await cache.match(req, { ignoreSearch: true });
  if (guardado) {
    fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); }).catch(() => {});
    return guardado;
  }
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return new Response("", { status: 504 });
  }
}

/* fontes e SDK do Firebase: cache primeiro, guarda o que baixar */
async function externo(req) {
  const cache = await caches.open(CACHE_EXT);
  const guardado = await cache.match(req);
  if (guardado) return guardado;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return new Response("", { status: 504 });
  }
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  if (NUNCA.some(h => url.hostname.includes(h))) return;   // deixa passar direto

  if (req.mode === "navigate") { e.respondWith(casco(req)); return; }

  if (url.origin === self.location.origin) { e.respondWith(arquivoLocal(req)); return; }

  if (EXTERNOS.some(h => url.hostname === h || url.hostname.endsWith("." + h))) {
    e.respondWith(externo(req));
  }
});

/* o app pode pedir para o SW assumir na hora (após tocar em "Atualizar") */
self.addEventListener("message", e => {
  if (e.data && e.data.type === "skip-waiting") self.skipWaiting();
});
