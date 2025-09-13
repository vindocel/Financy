
import axios from "axios";
import * as cheerio from "cheerio";
import iconv from "iconv-lite";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";
import fs from "fs";
import path from "path";

function parseNumberBR(txt) {
  if (!txt) return null;
  const cleaned = String(txt).replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

function toIsoFromBRDateHora(txt) {
  if (!txt) return new Date().toISOString();
  const m = txt.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return new Date().toISOString();
  const [_, dd, mm, yyyy, HH, MM, SS] = m;
  const d = new Date(Number(yyyy), Number(mm)-1, Number(dd), Number(HH), Number(MM), Number(SS||"0"));
  return d.toISOString();
}

function extractChaveFromQrUrl(qr) {
  if (!qr) return null;
  const m1 = qr.match(/[?&]chNFe=(\d{44})/);
  if (m1) return m1[1];
  const m2 = qr.match(/[?&]p=(\d{44})/);
  if (m2) return m2[1];
  const m3 = qr.match(/(\d{44})/);
  if (m3) return m3[1];
  return null;
}

function parseDanfeHtml(html) {
  const $ = cheerio.load(html);

  const estab = $("#u20 .txtTopo").first().text().trim() || $("#u20").first().text().trim() || $("#conteudo .txtTopo").first().text().trim();
  // Emissão
  let emiss = $("li").filter((i,el) => $(el).text().toLowerCase().includes("emiss")).first().text().trim();
  if (!emiss) emiss = $("#conteudo :contains('Emissão')").first().text().trim();
  const emissIso = toIsoFromBRDateHora(emiss);

  // Itens - SEFAZ-ES (#tabResult tr)
  const itens = [];
  $("#tabResult tr").each((i, tr) => {
    const $tr = $(tr);
    const name = $tr.find("td:first .txtTit").first().text().trim();
    const qtdTxt = $tr.find(".Rqtd").first().text().trim(); // "Qtde.:2,764"
    const valTxt = $tr.find(".valor").first().text().trim(); // "88,39"
    const qty = parseNumberBR(qtdTxt);
    const val = parseNumberBR(valTxt);
    if (name && qty !== null && val !== null) {
      itens.push({ nome: name, quantidade: qty, valor: val });
      return;
    }
    // fallback
    const tds = $tr.find("td");
    if (tds.length >= 2) {
      const guessName = name || $(tds.get(0)).text().split("Qtde.")[0].trim();
      const guessVal = val ?? parseNumberBR($(tds.get(1)).text());
      const guessQty = qty ?? parseNumberBR($tr.text().match(/Qtde\.:?\s*([\d\.,]+)/i)?.[1]);
      if (guessName && guessQty !== null && guessVal !== null) {
        itens.push({ nome: guessName, quantidade: guessQty, valor: guessVal });
      }
    }
  });

  
  // Totais: extrai "Descontos R$" e (opcional) "Valor total R$"
  let desconto = 0;
  let totalBruto = null;
  $("#totalNota #linhaTotal").each((i, el) => {
    const label = $(el).find("label").text().trim();
    const valTxt = $(el).find(".totalNumb").text().trim();
    const val = parseNumberBR(valTxt);
    if (/Descontos/i.test(label)) desconto = val ?? 0;
    if (/Valor total/i.test(label)) totalBruto = val ?? totalBruto;
  });
  const somaItens = itens.reduce((s, it)=> s + (it.valor || 0), 0);
  const totalCalc = Number((somaItens - (desconto || 0)).toFixed(2));

  return {
    estabelecimento: estab || "Desconhecido",
    emissao: emissIso,
    itens,
    desconto: Number((desconto || 0).toFixed(2)),
    total_nota: totalCalc
  };

}

export async function importFromParsedJson(nfceJson) {
  if (!nfceJson) throw new Error("JSON NFC-e vazio");

  const estabelecimento = nfceJson.estabelecimento || "Desconhecido";
  const emissao = nfceJson.emissao || new Date().toISOString();

  const items = Array.isArray(nfceJson.itens) ? nfceJson.itens.map(it => ({
    name: it.nome ?? "Item",
    qty: Number(it.quantidade ?? 1),
    total: Number(it.valor ?? 0)
  })) : [];

  const discount = Number(nfceJson.desconto ?? nfceJson.discount ?? 0);
  const sumItems = items.reduce((s,it)=> s + (Number(it.total)||0), 0);
  const total = Number((sumItems - discount).toFixed(2));

  return { estabelecimento, emissao, items, discount, total };
}

export async function fetchFromQrCode(qrUrl, opts={ debug:false, saveDebugDir:null }) {
  if (!qrUrl) throw new Error("QR vazio");
  const jar = new CookieJar();
  const client = wrapper(axios.create({
    jar, withCredentials: true, responseType: "arraybuffer",
    validateStatus: s => s >= 200 && s < 400
  }));

  let html1 = null;
  const dbgDir = opts.saveDebugDir;

  try {
    const res1 = await client.get(qrUrl, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }});
    const enc = (res1.headers["content-type"]||"").toLowerCase().includes("iso-8859-1") ? "latin1" : "utf8";
    html1 = iconv.decode(res1.data, enc);
  } catch {}

  let html2 = null;
  if (!html1 || !/txtTit|totalNota/i.test(html1)) {
    const pMatch = qrUrl.match(/[?&]p=([^&]+)/);
    let url2 = null;
    if (pMatch) {
      const base = qrUrl.split("?")[0];
      url2 = base.replace(/consulta.*$/i, "ConsultaDANFE_NFCe.aspx") + "?p=" + pMatch[1];
    }
    try {
      if (url2) {
        const res2 = await client.get(url2, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }});
        const enc2 = (res2.headers["content-type"]||"").toLowerCase().includes("iso-8859-1") ? "latin1" : "utf8";
        html2 = iconv.decode(res2.data, enc2);
      }
    } catch {}
  }

  const htmlUse = html2 || html1;
  if (opts.debug && dbgDir && html1) {
    try { fs.mkdirSync(dbgDir, {recursive:true}); fs.writeFileSync(path.join(dbgDir, 'last-1.html'), html1, 'utf-8'); } catch {}
  }
  if (opts.debug && dbgDir && html2) {
    try { fs.mkdirSync(dbgDir, {recursive:true}); fs.writeFileSync(path.join(dbgDir, 'last-2.html'), html2, 'utf-8'); } catch {}
  }

  if (!htmlUse) throw new Error("Não foi possível obter a página da NFC-e.");

  const parsed = parseDanfeHtml(htmlUse);
  const chave = extractChaveFromQrUrl(qrUrl);
  return { ...parsed, chave };
}
