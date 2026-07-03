/* SEND — Ordine magazzino */

// ===== Rilevatore errori a schermo (diagnostica) =====
// Mostra in cima alla pagina qualsiasi errore JS, così è visibile anche su mobile.
window.addEventListener("error", (e) => {
  showFatal((e.error && e.error.stack) || e.message || "Errore sconosciuto");
});
window.addEventListener("unhandledrejection", (e) => {
  showFatal("Promise: " + ((e.reason && e.reason.message) || e.reason || "?"));
});
function showFatal(msg) {
  let box = document.getElementById("fatal-box");
  if (!box) {
    box = document.createElement("div");
    box.id = "fatal-box";
    box.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:9999;background:#b00020;color:#fff;" +
      "font:12px/1.4 monospace;padding:10px;white-space:pre-wrap;word-break:break-word;max-height:50vh;overflow:auto";
    (document.body || document.documentElement).appendChild(box);
  }
  box.textContent = "SEND errore:\n" + msg;
}

// ===== Configurazione Supabase =====
// La publishable key è pensata per stare nel client (rispetta le policy RLS della tabella).
const SUPABASE_URL = "https://pwuebotkdxobjvfoepjz.supabase.co";
const SUPABASE_KEY = "sb_publishable_LEGQHUZEAH-ET0582OWRKA_r51GJpEf";
const SB_HEADERS = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

// ===== Identità del bar (dal parametro ?bar=) =====
const urlParams = new URLSearchParams(location.search);
let BAR_ID = slugify(urlParams.get("bar") || "");

function slugify(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// ===== Lista di default =====
const DEFAULT_DEPARTMENTS = [
  {
    id: "birre", name: "BIRRE", units: ["cassa"],
    products: [
      { id: "heineken-33", name: "Heineken 33cl" },
      { id: "becks-33", name: "Beck's 33cl" },
      { id: "corona-33", name: "Corona 33cl" },
      { id: "ichnusa-33", name: "Ichnusa normale 33cl" },
      { id: "ichnusa-nf-33", name: "Ichnusa non filtrata 33cl" },
      { id: "ceres-33", name: "Ceres 33cl" },
    ],
  },
  {
    id: "bibite", name: "BIBITE", units: ["cassa"],
    products: [
      { id: "the-limone", name: "Thè limone lattina" },
      { id: "the-pesca", name: "Thè pesca lattina" },
      { id: "coca-zero", name: "Coca Cola Zero lattina" },
      { id: "coca", name: "Coca Cola lattina" },
      { id: "schweppes-tonica", name: "Schweppes Tonica" },
      { id: "limoncello-luisiana", name: "Limoncello Luisiana" },
      { id: "redbull", name: "Red Bull" },
      { id: "aranciata-amara", name: "Aranciata amara" },
      { id: "fanta", name: "Fanta" },
      { id: "lemonsoda", name: "Lemonsoda" },
      { id: "cedrata", name: "Cedrata" },
    ],
  },
  {
    id: "succhi", name: "SUCCHI", units: ["cassa"],
    products: [
      { id: "succo-pesca", name: "Pesca" },
      { id: "succo-albicocca", name: "Albicocca" },
      { id: "succo-ananas", name: "Ananas" },
      { id: "succo-ace", name: "ACE" },
      { id: "succo-pera", name: "Pera" },
      { id: "succo-mirtillo", name: "Mirtillo" },
    ],
  },
  {
    id: "bottiglie", name: "BOTTIGLIE", units: ["cassa", "bottiglia"],
    products: [
      { id: "campari-bitter", name: "Campari Bitter" },
      { id: "aperol", name: "Aperol" },
      { id: "gin-eco", name: "Gin (il più economico)" },
      { id: "vecchia-romagna", name: "Vecchia Romagna" },
      { id: "baileys", name: "Baileys" },
      { id: "amaro-del-capo", name: "Amaro del Capo" },
      { id: "vodka-eco", name: "Vodka (la più economica)" },
      { id: "grappa-eco", name: "Grappa (la più economica)" },
      { id: "sambuca-molinari", name: "Sambuca Molinari" },
      { id: "select", name: "Select" },
      { id: "montenegro", name: "Montenegro" },
    ],
  },
  {
    id: "aperitivo", name: "APERITIVO", units: ["cassa"],
    products: [
      { id: "crodino", name: "Crodino" },
      { id: "san-bitter", name: "San Bitter" },
      { id: "campari-soda", name: "Campari Soda" },
    ],
  },
  {
    id: "acqua", name: "ACQUA", units: ["cassa"],
    products: [
      { id: "acqua-piccola-nat", name: "Acqua piccola naturale" },
      { id: "acqua-piccola-friz", name: "Acqua piccola frizzante" },
      { id: "acqua-grande-nat", name: "Acqua grande naturale" },
      { id: "acqua-grande-friz", name: "Acqua grande frizzante" },
    ],
  },
];

// Alzare quando si aggiungono prodotti/reparti ai default: chi ha già la lista
// salvata riceve i nuovi elementi al prossimo avvio (senza perdere le sue modifiche).
const DEFAULTS_VERSION = 2;

const UNIT_LABELS = { cassa: "Casse", bottiglia: "Bottiglie" };
const LS_NAME = "send-name";
const lsInvKey = () => "send-inv-" + BAR_ID;     // cache lista per bar
const lsOrderKey = () => "send-order-" + BAR_ID; // ordine in corso per bar

// ===== Stato (popolato in init(), dopo aver scaricato dal server) =====
let state = { defaultsVersion: DEFAULTS_VERSION, departments: clone(DEFAULT_DEPARTMENTS) };
let quantities = {}; // { productId: { cassa: n, bottiglia: n } }
let userEdited = false; // true appena il bar tocca la lista: evita che il sync iniziale sovrascriva

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// Aggiunge alla lista i reparti/prodotti di default mancanti (per id).
// Non tocca rinominati né personalizzati; guidato da defaultsVersion, così
// un default eliminato a mano non torna ai prossimi avvii.
function mergeNewDefaults(inv) {
  DEFAULT_DEPARTMENTS.forEach((defDept) => {
    const dept = inv.departments.find((d) => d.id === defDept.id);
    if (!dept) {
      inv.departments.push(clone(defDept));
      return;
    }
    defDept.products.forEach((defProd) => {
      if (!dept.products.some((p) => p.id === defProd.id)) {
        dept.products.push(clone(defProd));
      }
    });
  });
  inv.defaultsVersion = DEFAULTS_VERSION;
}

// Salva la lista: cache locale + server (upsert per bar). Sempre sincronizzato.
function saveInventory() {
  userEdited = true;
  localStorage.setItem(lsInvKey(), JSON.stringify(state));
  pushToServer();
}

function saveOrder() {
  localStorage.setItem(lsOrderKey(), JSON.stringify(quantities));
}

function uid() {
  return "p-" + Math.random().toString(36).slice(2, 10);
}

// Deep clone universale (structuredClone non esiste su WebKit/Safari < 15.4)
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ===== Sync Supabase (tabella bar_inventories, una riga per bar) =====
async function pushToServer() {
  if (!BAR_ID) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/bar_inventories?on_conflict=bar_id`, {
      method: "POST",
      headers: { ...SB_HEADERS, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        bar_id: BAR_ID,
        data: { departments: state.departments, defaultsVersion: state.defaultsVersion },
        updated_at: new Date().toISOString(),
      }),
    });
  } catch {
    /* offline: la copia locale resta valida, si ripush al prossimo salvataggio */
  }
}

// Scarica la lista del bar dal server. Se la riga non esiste, la crea coi default.
// Non sovrascrive se nel frattempo l'utente ha già modificato (userEdited).
async function syncFromServer() {
  if (!BAR_ID) return;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bar_inventories?bar_id=eq.${encodeURIComponent(BAR_ID)}&select=data`,
      { headers: SB_HEADERS }
    );
    const rows = await res.json();
    if (Array.isArray(rows) && rows[0] && rows[0].data && Array.isArray(rows[0].data.departments)) {
      if (userEdited) return; // l'utente ha già toccato la lista: non calpestare le sue modifiche
      const server = { departments: rows[0].data.departments, defaultsVersion: rows[0].data.defaultsVersion || 1 };
      if (server.defaultsVersion < DEFAULTS_VERSION) {
        mergeNewDefaults(server);
      }
      state = server;
      localStorage.setItem(lsInvKey(), JSON.stringify(state));
      renderAll();
      if (server.defaultsVersion !== (rows[0].data.defaultsVersion || 1)) pushToServer();
    } else {
      // Riga assente: primo accesso di questo bar → semina lo stato corrente sul server.
      pushToServer();
    }
  } catch {
    /* offline: si continua con la cache locale già mostrata */
  }
}

// ===== Navigazione tab =====
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    document.getElementById("view-" + tab.dataset.view).classList.remove("hidden");
  });
});

// ===== Vista ordine =====
const openDepts = new Set();

function getQty(productId, unit) {
  return (quantities[productId] && quantities[productId][unit]) || 0;
}

function setQty(productId, unit, value) {
  const v = Math.max(0, Math.min(999, Math.floor(Number(value) || 0)));
  if (!quantities[productId]) quantities[productId] = {};
  quantities[productId][unit] = v;
  saveOrder();
}

function deptSelectedCount(dept) {
  return dept.products.filter((p) => dept.units.some((u) => getQty(p.id, u) > 0)).length;
}

function renderOrder() {
  const container = document.getElementById("order-departments");
  container.innerHTML = "";
  state.departments.forEach((dept) => {
    const card = document.createElement("div");
    card.className = "dept" + (openDepts.has(dept.id) ? " open" : "");

    const count = deptSelectedCount(dept);
    const header = document.createElement("button");
    header.className = "dept-header";
    header.innerHTML = `<span>${esc(dept.name)}<span class="dept-units">(${dept.units.map((u) => UNIT_LABELS[u].toLowerCase()).join(" + ")})</span></span>${count ? `<span class="badge">${count}</span>` : ""}<span class="chevron">›</span>`;
    header.addEventListener("click", () => {
      openDepts.has(dept.id) ? openDepts.delete(dept.id) : openDepts.add(dept.id);
      card.classList.toggle("open");
    });
    card.appendChild(header);

    const body = document.createElement("div");
    body.className = "dept-body";
    dept.products.forEach((p) => {
      const row = document.createElement("div");
      const hasQty = dept.units.some((u) => getQty(p.id, u) > 0);
      row.className = "product-row" + (hasQty ? " has-qty" : "");
      const name = document.createElement("div");
      name.className = "product-name";
      name.textContent = p.name;
      row.appendChild(name);

      const controls = document.createElement("div");
      controls.className = "qty-controls";
      dept.units.forEach((unit) => {
        const group = document.createElement("div");
        group.className = "qty-group";
        const showLabel = dept.units.length > 1;
        group.innerHTML = showLabel ? `<span class="qty-unit">${UNIT_LABELS[unit]}</span>` : "";

        const minus = btn("−");
        const input = document.createElement("input");
        input.type = "number";
        input.inputMode = "numeric";
        input.min = "0";
        input.className = "qty-input" + (getQty(p.id, unit) > 0 ? " nonzero" : "");
        input.value = getQty(p.id, unit);
        const plus = btn("+");

        minus.addEventListener("click", () => { setQty(p.id, unit, getQty(p.id, unit) - 1); refreshRow(); });
        plus.addEventListener("click", () => { setQty(p.id, unit, getQty(p.id, unit) + 1); refreshRow(); });
        input.addEventListener("change", () => { setQty(p.id, unit, input.value); refreshRow(); });

        function refreshRow() {
          input.value = getQty(p.id, unit);
          input.classList.toggle("nonzero", getQty(p.id, unit) > 0);
          row.classList.toggle("has-qty", dept.units.some((u) => getQty(p.id, u) > 0));
          const c = deptSelectedCount(dept);
          const badge = header.querySelector(".badge");
          if (c && badge) badge.textContent = c;
          else if (c && !badge) header.querySelector(".chevron").insertAdjacentHTML("beforebegin", `<span class="badge">${c}</span>`);
          else if (!c && badge) badge.remove();
          updateSummary();
        }

        group.appendChild(minus);
        group.appendChild(input);
        group.appendChild(plus);
        controls.appendChild(group);
      });
      row.appendChild(controls);
      body.appendChild(row);
    });
    card.appendChild(body);
    container.appendChild(card);
  });
  updateSummary();
}

function btn(label) {
  const b = document.createElement("button");
  b.className = "qty-btn";
  b.textContent = label;
  return b;
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function totalSelected() {
  let n = 0;
  state.departments.forEach((d) => (n += deptSelectedCount(d)));
  return n;
}

function updateSummary() {
  const n = totalSelected();
  document.getElementById("order-summary").textContent =
    n === 0 ? "Nessun prodotto selezionato" : n === 1 ? "1 prodotto selezionato" : `${n} prodotti selezionati`;
}

// Nome compilatore
const nameInput = document.getElementById("compiler-name");
nameInput.value = localStorage.getItem(LS_NAME) || "";
nameInput.addEventListener("input", () => localStorage.setItem(LS_NAME, nameInput.value));

// Azzera ordine
document.getElementById("btn-clear-order").addEventListener("click", () => {
  if (totalSelected() === 0) return;
  if (!confirm("Azzerare tutte le quantità?")) return;
  quantities = {};
  saveOrder();
  renderOrder();
});

// ===== PDF =====
document.getElementById("btn-generate-pdf").addEventListener("click", generatePDF);

async function generatePDF() {
  const compiler = nameInput.value.trim();
  if (!compiler) {
    toast("Scrivi il tuo nome prima di generare il PDF");
    nameInput.focus();
    return;
  }
  if (totalSelected() === 0) {
    toast("Nessuna quantità inserita");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const today = new Date();
  const dateStr = today.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });

  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.text("ORDINE SEND", 14, 20);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(`Data: ${dateStr}`, 14, 29);
  doc.text(`Compilato da: ${compiler}`, 14, 35);

  let y = 44;
  state.departments.forEach((dept) => {
    const rows = [];
    dept.products.forEach((p) => {
      dept.units.forEach((unit) => {
        const q = getQty(p.id, unit);
        if (q > 0) rows.push([p.name, String(q), UNIT_LABELS[unit].toLowerCase()]);
      });
    });
    if (rows.length === 0) return;

    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text(dept.name, 14, y);
    doc.autoTable({
      startY: y + 3,
      head: [["Prodotto", "Quantità", "Unità"]],
      body: rows,
      theme: "grid",
      headStyles: { fillColor: [230, 57, 70], fontSize: 10 },
      styles: { fontSize: 10, cellPadding: 2.5 },
      columnStyles: { 1: { halign: "center", cellWidth: 28 }, 2: { cellWidth: 30 } },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 12;
  });

  const iso = today.toISOString().slice(0, 10);
  const filename = `ordine-send-${iso}.pdf`;

  // Su mobile prova la condivisione diretta (WhatsApp ecc.), altrimenti download
  const blob = doc.output("blob");
  const file = new File([blob], filename, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Ordine SEND" });
      return;
    } catch (e) {
      if (e.name === "AbortError") return; // utente ha annullato
    }
  }
  doc.save(filename);
}

// ===== Vista lista (modifica) =====
function renderEdit() {
  const container = document.getElementById("edit-departments");
  container.innerHTML = "";
  state.departments.forEach((dept, di) => {
    const card = document.createElement("div");
    card.className = "edit-dept";

    const header = document.createElement("div");
    header.className = "edit-dept-header";
    const title = document.createElement("span");
    title.className = "dept-title";
    title.textContent = `${dept.name} (${dept.units.map((u) => UNIT_LABELS[u].toLowerCase()).join(" + ")})`;
    header.appendChild(title);
    header.appendChild(iconBtn("✏️", "Rinomina reparto", () => {
      const name = prompt("Nuovo nome del reparto:", dept.name);
      if (name && name.trim()) { dept.name = name.trim().toUpperCase(); saveInventory(); renderAll(); }
    }));
    header.appendChild(iconBtn("🗑", "Elimina reparto", () => {
      if (!confirm(`Eliminare il reparto ${dept.name} e tutti i suoi prodotti?`)) return;
      state.departments.splice(di, 1);
      saveInventory();
      renderAll();
    }));
    card.appendChild(header);

    dept.products.forEach((p, pi) => {
      const row = document.createElement("div");
      row.className = "edit-product-row";
      const span = document.createElement("span");
      span.textContent = p.name;
      row.appendChild(span);
      row.appendChild(iconBtn("✏️", "Rinomina prodotto", () => {
        const name = prompt("Nuovo nome del prodotto:", p.name);
        if (name && name.trim()) { p.name = name.trim(); saveInventory(); renderAll(); }
      }));
      row.appendChild(iconBtn("🗑", "Elimina prodotto", () => {
        if (!confirm(`Eliminare "${p.name}"?`)) return;
        dept.products.splice(pi, 1);
        delete quantities[p.id];
        saveOrder();
        saveInventory();
        renderAll();
      }));
      card.appendChild(row);
    });

    const addBtn = document.createElement("button");
    addBtn.className = "edit-add-product";
    addBtn.textContent = "+ Aggiungi prodotto";
    addBtn.addEventListener("click", () => {
      const name = prompt(`Nome del nuovo prodotto in ${dept.name}:`);
      if (name && name.trim()) {
        dept.products.push({ id: uid(), name: name.trim() });
        saveInventory();
        renderAll();
      }
    });
    card.appendChild(addBtn);
    container.appendChild(card);
  });
}

function iconBtn(icon, label, onClick) {
  const b = document.createElement("button");
  b.className = "icon-btn";
  b.textContent = icon;
  b.title = label;
  b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

document.getElementById("btn-add-department").addEventListener("click", () => {
  const name = prompt("Nome del nuovo reparto:");
  if (!name || !name.trim()) return;
  const dual = confirm("Deve avere due unità di misura (casse E bottiglie)?\nOK = casse + bottiglie · Annulla = solo casse");
  state.departments.push({
    id: uid(),
    name: name.trim().toUpperCase(),
    units: dual ? ["cassa", "bottiglia"] : ["cassa"],
    products: [],
  });
  saveInventory();
  renderAll();
});

// ===== Impostazioni =====
document.getElementById("btn-copy-link").addEventListener("click", async () => {
  const link = `${location.origin}${location.pathname}?bar=${encodeURIComponent(BAR_ID)}`;
  try {
    await navigator.clipboard.writeText(link);
    toast("Link copiato");
  } catch {
    prompt("Copia il tuo link:", link);
  }
});

document.getElementById("btn-reset").addEventListener("click", () => {
  if (!confirm("Ripristinare la lista di default? Le modifiche e le quantità in corso andranno perse.")) return;
  state = { defaultsVersion: DEFAULTS_VERSION, departments: clone(DEFAULT_DEPARTMENTS) };
  quantities = {};
  saveOrder();
  saveInventory();
  renderAll();
  toast("Lista ripristinata");
});

// ===== Toast =====
let toastTimer;
function toast(msg) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2800);
}

// ===== Schermata setup (nessun ?bar= nell'URL) =====
// Funzione globale: richiamata sia dall'onclick inline nell'HTML sia dal listener,
// così il pulsante funziona a prescindere dall'ordine di caricamento / dal browser.
function createBarSpace() {
  const input = document.getElementById("setup-name");
  const slug = slugify(input ? input.value : "");
  if (!slug) {
    toast("Scrivi un nome valido (lettere o numeri)");
    if (input) input.focus();
    return;
  }
  const url = location.origin + location.pathname + "?bar=" + encodeURIComponent(slug);
  location.assign(url);
}
window.createBarSpace = createBarSpace;

function showSetup() {
  const screen = document.getElementById("setup-screen");
  const input = document.getElementById("setup-name");
  screen.classList.remove("hidden");
  const btn = document.getElementById("setup-go");
  if (btn) btn.addEventListener("click", createBarSpace);
  if (input) {
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") createBarSpace(); });
    input.focus();
  }
}

function renderAll() {
  renderOrder();
  renderEdit();
}

// ===== Avvio =====
async function init() {
  if (!BAR_ID) {
    showSetup();
    return;
  }
  // Mostra il codice del bar nell'intestazione e nelle impostazioni
  document.getElementById("topbar-bar").textContent = BAR_ID;
  document.getElementById("bar-code-label").textContent = BAR_ID;

  // Carica subito la cache locale (se c'è) per non partire vuoti, poi allinea col server
  const cached = loadJSON(lsInvKey(), null);
  if (cached && Array.isArray(cached.departments)) {
    state = { departments: cached.departments, defaultsVersion: cached.defaultsVersion || 1 };
    if (state.defaultsVersion < DEFAULTS_VERSION) mergeNewDefaults(state);
  }
  quantities = loadJSON(lsOrderKey(), {});
  renderAll();

  await syncFromServer();
}

init();
