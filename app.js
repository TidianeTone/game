"use strict";

function renderCards(offers) {
  const grid = document.getElementById("results");
  const empty = document.getElementById("emptyState");
  grid.innerHTML = "";

  if (offers.length === 0) {
    empty.classList.remove("hidden");
    empty.querySelector("p").textContent =
      "Aucune offre trouvée pour cette recherche.";
    return;
  }
  empty.classList.add("hidden");

  offers.forEach((o) => {
    const card = document.createElement("a");
    card.href = o.url;
    card.target = "_blank";
    card.rel = "noopener noreferrer";

    const cls =
      o.source === "Meteojob" ? "src-mj" :
      o.source === "Adzuna" ? "src-adz" : "src-ft";
    card.className = "card " + cls;

    const badgeCls =
      o.source === "Meteojob" ? "mj" :
      o.source === "Adzuna" ? "adz" : "ft";
    const badge = document.createElement("span");
    badge.className = "badge " + badgeCls;
    badge.textContent = o.source;

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = o.title;

    const meta = document.createElement("div");
    meta.className = "card-meta";
    const bits = [o.company, o.contract, o.hours].filter(Boolean).join(" · ");
    meta.append(document.createTextNode(bits));
    if (o.salary) {
      if (bits) meta.append(document.createTextNode(" · "));
      const sal = document.createElement("span");
      sal.className = "salary";
      sal.textContent = o.salary;
      meta.append(sal);
    }

    const desc = document.createElement("div");
    desc.className = "card-desc";
    desc.textContent = o.description;

    card.append(badge, title, meta);
    if (o.description) card.append(desc);
    grid.append(card);
  });
}

async function runSearch() {
  const keyword = document.getElementById("keyword").value.trim();
  const status = document.getElementById("statusLine");
  const btn = document.getElementById("searchBtn");
  const wantFT = document.getElementById("srcFT").checked ? "1" : "0";
  const wantADZ = document.getElementById("srcADZ").checked ? "1" : "0";
  const wantMJ = document.getElementById("srcMJ").checked ? "1" : "0";

  btn.disabled = true;
  status.textContent = "Recherche en cours…";

  try {
    const params = new URLSearchParams({ keyword, ft: wantFT, adz: wantADZ, mj: wantMJ });
    const res = await fetch(`/api/search?${params.toString()}`);
    if (!res.ok) throw new Error("serveur HTTP " + res.status);
    const data = await res.json();

    renderCards(data.offers || []);

    let line = `${data.counts.total} offres · ${data.counts.ft} France Travail, ${data.counts.adz} Adzuna, ${data.counts.mj} Meteojob`;
    if (data.errors && data.errors.length) {
      line += " · ⚠ " + data.errors.join(" | ");
    }
    status.textContent = line;
  } catch (e) {
    status.textContent = "Erreur : " + e.message;
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("searchBtn").addEventListener("click", runSearch);
document.getElementById("keyword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") runSearch();
});
