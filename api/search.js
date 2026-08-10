// Fonction serverless (Vercel). Node 18+ : fetch est natif, aucune dépendance.
// La clé secrète France Travail vit ici, côté serveur (variables d'environnement),
// jamais dans le navigateur du téléphone.

const FT = {
  scope: "api_offresdemploiv2 o2dsoffre",
  tokenUrl:
    "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire",
  searchUrl:
    "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search",
  communeInsee: "31555", // Toulouse
};

const MJ = {
  baseUrl: "https://www.meteojob.com/jobs",
  where: "Toulouse (31)",
  pages: 3,
};

async function getFtToken() {
  const id = process.env.FT_CLIENT_ID;
  const secret = process.env.FT_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "Identifiants France Travail manquants (variables FT_CLIENT_ID / FT_CLIENT_SECRET)."
    );
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: id,
    client_secret: secret,
    scope: FT.scope,
  });
  const r = await fetch(FT.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) throw new Error("token HTTP " + r.status);
  const j = await r.json();
  if (!j.access_token) throw new Error("pas de token (identifiants ?)");
  return j.access_token;
}

async function fetchFranceTravail(keyword) {
  const token = await getFtToken();
  const params = new URLSearchParams({
    commune: FT.communeInsee,
    sort: "1",
    range: "0-49",
  });
  if (keyword) params.set("motsCles", keyword);

  const r = await fetch(`${FT.searchUrl}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status === 204) return [];
  if (r.status !== 200 && r.status !== 206) {
    throw new Error("recherche HTTP " + r.status);
  }
  const j = await r.json();
  const offres = j.resultats || [];
  return offres.map((o) => ({
    source: "France Travail",
    title: o.intitule || "(sans titre)",
    company: o.entreprise && o.entreprise.nom ? o.entreprise.nom : "",
    salary: o.salaire && o.salaire.libelle ? o.salaire.libelle : "",
    hours: o.dureeTravailLibelleConverti || o.dureeTravailLibelle || "",
    contract: o.typeContratLibelle || "",
    description: (o.description || "").replace(/\s+/g, " ").slice(0, 200),
    url:
      o.origineOffre && o.origineOffre.urlOrigine
        ? o.origineOffre.urlOrigine
        : "#",
  }));
}

// Meteojob : extraction robuste sans DOM (regex sur les ancres /jobs/ID).
// L'attribut title des ancres porte "Intitulé - Entreprise".
async function fetchMeteojobPage(keyword, page) {
  const params = new URLSearchParams({ where: MJ.where });
  if (keyword) params.set("what", keyword);
  if (page > 1) params.set("page", String(page));

  const r = await fetch(`${MJ.baseUrl}?${params.toString()}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; EmploiToulouse/1.0)" },
  });
  if (!r.ok) return [];
  const html = await r.text();

  const re =
    /<a[^>]+href="([^"]*\/jobs\/\d+)"[^>]*title="([^"]*)"/g;
  const seen = new Set();
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    let url = m[1];
    if (!url.startsWith("http")) url = "https://www.meteojob.com" + url;
    if (seen.has(url)) continue;
    seen.add(url);

    const rawTitle = decodeEntities(m[2]).trim();
    // "Intitulé - Entreprise" -> on coupe sur le dernier " - "
    let title = rawTitle;
    let company = "";
    const idx = rawTitle.lastIndexOf(" - ");
    if (idx > 0) {
      title = rawTitle.slice(0, idx).trim();
      company = rawTitle.slice(idx + 3).trim();
    }
    out.push({
      source: "Meteojob",
      title,
      company,
      salary: "",
      hours: "",
      contract: "",
      description: "",
      url,
    });
  }
  return out;
}

function decodeEntities(str) {
  return (str || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCodePoint(parseInt(h, 16))
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (whole, name) => {
      const map = {
        eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
        agrave: "à", acirc: "â", ccedil: "ç",
        ocirc: "ô", ouml: "ö", ugrave: "ù", ucirc: "û",
        icirc: "î", iuml: "ï", Eacute: "É", Agrave: "À",
      };
      return map[name] || whole;
    });
}

async function fetchMeteojob(keyword) {
  let all = [];
  for (let p = 1; p <= MJ.pages; p++) {
    const page = await fetchMeteojobPage(keyword, p);
    if (page.length === 0) break;
    all = all.concat(page);
  }
  return all;
}

function normalize(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function dedupe(offers) {
  const seen = new Set();
  const out = [];
  for (const o of offers) {
    const key = normalize(o.title) + "|" + normalize(o.company);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const keyword = (url.searchParams.get("keyword") || "").trim();
  const wantFT = url.searchParams.get("ft") !== "0";
  const wantMJ = url.searchParams.get("mj") !== "0";

  const errors = [];
  let ft = [];
  let mj = [];

  if (wantFT) {
    try {
      ft = await fetchFranceTravail(keyword);
    } catch (e) {
      errors.push("France Travail : " + e.message);
    }
  }
  if (wantMJ) {
    try {
      mj = await fetchMeteojob(keyword);
    } catch (e) {
      errors.push("Meteojob : " + e.message);
    }
  }

  const offers = dedupe([...ft, ...mj]);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).send(
    JSON.stringify({
      offers,
      counts: { ft: ft.length, mj: mj.length, total: offers.length },
      errors,
    })
  );
}
