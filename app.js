// UI for the "Évaluation fiscale" form. All data and calculations come from the standalone
// library (../dist/dgi-valuation.js -> window.DGIValuation) and the embedded dataset
// (../dist/dgi-valuation-data.js -> window.DGIValuationData); this file only renders,
// formats (fr-DZ) and wires the dependent selectors. Classic script: works from file://.
(function () {
"use strict";

const lib = window.DGIValuation;
const parseSurface = (value) => lib.parseSurface(value);
const TX_LABEL = { sale: "Achat", rental: "Location" };
const LOCATION_TYPE_NOTE = {
    daira: "Barème publié pour la daïra entière.",
    "new-town": "Barème publié pour la ville nouvelle.",
};

const $ = (id) => document.getElementById(id);
const form = $("valuation-form");
const el = {
    status: $("dataset-status"), wilaya: $("wilaya"), commune: $("commune"), nature: $("nature"), type: $("type"),
    zone: $("zone"), surface: $("surface"), surfaceError: $("surface-error"), formError: $("form-error"),
    wilayaHint: $("wilaya-hint"), communeHint: $("commune-hint"), result: $("result"),
    submit: form.querySelector("button[type=submit]"), disclaimer: $("disclaimer"),
    transactions: [...form.querySelectorAll("input[name=transaction]")],
};
const CHAIN = ["wilaya", "commune", "nature", "type", "zone"];
const PLACEHOLDER = {
    wilaya: "Choisir la wilaya", commune: "Choisir la commune", nature: "Choisir la nature du bien",
    type: "Choisir le type", zone: "Choisir la zone",
};

// ---------- formatting (presentation only; the library returns raw numbers) ----------
const intFormat = new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 });
let moneyFormat;
try {
    moneyFormat = new Intl.NumberFormat("fr-DZ", { style: "currency", currency: "DZD", currencyDisplay: "symbol", maximumFractionDigits: 0 });
} catch {
    moneyFormat = { format: (n) => `${intFormat.format(n)} DA` };
}
const money = (n) => moneyFormat.format(n);
/** "15600000.50" -> "15 600 000,5" without going through floating point. */
function decimalText(text) {
    const [whole, fraction = ""] = String(text).split(".");
    const trimmed = fraction.replace(/0+$/, "");
    return intFormat.format(BigInt(whole)) + (trimmed ? "," + trimmed : "");
}
const perSuffix = (per) => (per === "month" ? " par mois" : "");

// ---------- state ----------
let calc = null;
const tx = () => el.transactions.find((r) => r.checked)?.value ?? "sale";

function fillSelect(select, options) {
    select.replaceChildren(new Option(PLACEHOLDER[select.id], ""), ...options.map((o) => new Option(o.label, o.value)));
    select.disabled = options.length === 0;
}

/** Reset every selector after `name` in the chain (and the result). */
function resetAfter(name) {
    const start = name ? CHAIN.indexOf(name) + 1 : 0;
    for (const key of CHAIN.slice(start)) fillSelect(el[key], []);
    if (start <= 1) setHint(el.communeHint, null);
    if (start === 0) setHint(el.wilayaHint, null);
    clearResult();
}

function setHint(node, text, warn = false) {
    node.hidden = !text;
    node.textContent = text ?? "";
    node.classList.toggle("warn", warn);
}

function clearResult() {
    el.result.hidden = true;
    el.result.replaceChildren();
    el.formError.hidden = true;
}

function populateWilayas() {
    const wilayas = calc.getWilayas(tx()).sort((a, b) => a.name.localeCompare(b.name, "fr"));
    fillSelect(el.wilaya, wilayas.map((w) => ({ value: String(w.code), label: w.name })));
}

// ---------- dependent selectors ----------
function onTransaction() {
    resetAfter(null);
    populateWilayas();
}

function onWilaya() {
    resetAfter("wilaya");
    const code = el.wilaya.value;
    if (!code) return;
    const w = calc.getWilayas(tx()).find((x) => String(x.code) === code);
    if (w?.periodStatus === "outdated") {
        setHint(el.wilayaHint, `Barème de la période ${w.period}, antérieure à la période de référence ${calc.dataset.metadata.targetPeriod}.`, true);
    } else {
        setHint(el.wilayaHint, w ? `Barème de la période ${w.period}.` : null);
    }
    fillSelect(el.commune, calc.getCommunes(tx(), code).map((l) => ({ value: l.id, label: l.label })));
}

function onCommune() {
    resetAfter("commune");
    const id = el.commune.value;
    if (!id) return setHint(el.communeHint, null);
    const loc = calc.getCommunes(tx(), el.wilaya.value).find((l) => l.id === id);
    setHint(el.communeHint, loc?.subdivisionDescription ?? LOCATION_TYPE_NOTE[loc?.type] ?? null);
    fillSelect(el.nature, calc.getCategories(tx(), id).map((c) => ({ value: c.id, label: c.label })));
}

function onNature() {
    resetAfter("nature");
    if (!el.nature.value) return;
    fillSelect(el.type, calc.getTypes(tx(), el.commune.value, el.nature.value).map((t) => ({ value: t.id, label: t.label })));
}

function onType() {
    resetAfter("type");
    if (!el.type.value) return;
    fillSelect(el.zone, calc.getZones(tx(), el.commune.value, el.nature.value, el.type.value)
        .map((z) => ({ value: z.id, label: z.label })));
}

// ---------- validation ----------
function showSurfaceError(message) {
    el.surface.setAttribute("aria-invalid", message ? "true" : "false");
    el.surfaceError.hidden = !message;
    el.surfaceError.textContent = message ?? "";
}

function validate() {
    for (const key of CHAIN) el[key].removeAttribute("aria-invalid");
    const missing = CHAIN.find((key) => !el[key].value);
    const surface = parseSurface(el.surface.value);
    showSurfaceError(surface.ok ? null : surface.message);
    if (missing) {
        const label = form.querySelector(`label[for=${missing}]`).textContent;
        el[missing].setAttribute("aria-invalid", "true");
        el.formError.textContent = el[missing].disabled
            ? `« ${label} » : complétez d'abord les champs précédents.`
            : `Veuillez choisir : ${label}.`;
        el.formError.hidden = false;
        (el[missing].disabled ? el[CHAIN[CHAIN.indexOf(missing) - 1]] : el[missing]).focus();
        return false;
    }
    el.formError.hidden = true;
    if (!surface.ok) {
        el.surface.focus();
        return false;
    }
    return true;
}

// ---------- result rendering ----------
const h = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
    return node;
};

function stepText(step, r) {
    const ops = step.operands;
    const value = `${intFormat.format(ops.value)} ${r.reference.unitLabel}`;
    const surface = `${decimalText(ops.surfaceM2)} m²`;
    const exact = `${decimalText(step.exact)} DA`;
    const name = step.bound === "min" ? "Minimum" : "Maximum";
    const rounded = decimalText(step.exact) !== intFormat.format(step.rounded) ? ` → arrondi : ${money(step.rounded)}` : "";
    if (r.formulaId === "F-HA") {
        return `${name} : ${surface} ÷ 10 000 = ${decimalText(ops.surfaceHa)} ha ; `
            + `${decimalText(ops.surfaceHa)} ha × ${value} = ${exact}${perSuffix(r.result.per)}${rounded}`;
    }
    return `${name} : ${surface} × ${value} = ${exact}${perSuffix(r.result.per)}${rounded}`;
}

function renderSuccess(r) {
    const { minRounded, maxRounded, per } = r.result;
    let headline;
    if (minRounded !== null && maxRounded !== null) headline = `${money(minRounded)} – ${money(maxRounded)}${perSuffix(per)}`;
    else if (maxRounded !== null) headline = `Maximum : ${money(maxRounded)}${perSuffix(per)} (minimum non publié)`;
    else headline = `Minimum : ${money(minRounded)}${perSuffix(per)} (maximum non publié)`;

    const ref = r.reference;
    const refText = [ref.min, ref.max].every((v) => v !== null)
        ? `${intFormat.format(ref.min)} – ${intFormat.format(ref.max)} ${ref.unitLabel}`
        : `${ref.min !== null ? "min. " + intFormat.format(ref.min) : "max. " + intFormat.format(ref.max)} ${ref.unitLabel}`;
    const loc = r.selection.location;
    const period = r.periodStatus === "outdated" ? `${r.referencePeriod} (barème antérieur à ${calc.dataset.metadata.targetPeriod})` : r.referencePeriod;
    const rows = [
        ["Transaction", TX_LABEL[r.transactionType]],
        ["Wilaya", r.selection.wilaya.name],
        ["Commune", loc.label + (loc.subdivisionDescription ? ` (${loc.subdivisionDescription})` : "")],
        ["Nature du bien", r.selection.category.label],
        ["Type", r.selection.type.label],
        ["Zone", r.selection.zone.label],
        ["Surface saisie", `${decimalText(r.inputs.surfaceM2)} m²`],
        ["Valeur de référence", refText],
        ["Période du barème", period],
        ["Source", `${r.source.file.split("/").pop()}, page ${r.source.page}`],
    ];
    el.result.classList.remove("error-result");
    el.result.replaceChildren(...[
        h("h2", { textContent: "Valeur de référence DGI (estimation indicative)" }),
        h("p", { className: "range", textContent: headline }),
        h("p", { className: "range-label", textContent: "Fourchette calculée à partir du barème : minimum – maximum." }),
        h("dl", {}, ...rows.flatMap(([k, v]) => [h("dt", { textContent: k }), h("dd", { textContent: v })])),
        h("h3", { textContent: "Calcul" }),
        h("ol", { className: "breakdown" }, ...r.steps.map((s) => h("li", { textContent: stepText(s, r) }))),
        h("p", { className: "hint", textContent: "Montants arrondis au dinar le plus proche ; aucun arrondi intermédiaire." }),
        r.warnings.length ? h("h3", { textContent: "Avertissements" }) : null,
        r.warnings.length ? h("ul", { className: "notes warnings" }, ...r.warnings.map((w) => h("li", { textContent: w.message }))) : null,
        h("h3", { textContent: "Limites du calcul" }),
        h("ul", { className: "notes" }, ...r.assumptions.map((a) => h("li", { textContent: a.message })),
            h("li", { textContent: "Ce résultat n'est ni une valeur vénale, ni une base imposable, ni un montant d'impôt, de droits ou de frais." })),
    ].filter(Boolean));
}

function renderError(r) {
    el.result.classList.add("error-result");
    const children = [h("h2", { textContent: "Calcul impossible" }), h("p", { className: "message", textContent: r.message })];
    if (r.errors?.length) children.push(h("ul", { className: "notes warnings" }, ...r.errors.map((e) => h("li", { textContent: e.message }))));
    if (r.source) children.push(h("p", { className: "hint", textContent: `Source : ${r.source.file.split("/").pop()}, page ${r.source.page} (${r.source.period}).` }));
    el.result.replaceChildren(...children);
}

function onSubmit(event) {
    event.preventDefault();
    if (!calc) return;
    clearResult();
    if (!validate()) return;
    const result = calc.calculateReference({
        transactionType: tx(), locationId: el.commune.value, categoryId: el.nature.value,
        typeId: el.type.value, zoneId: el.zone.value, surface: el.surface.value,
    });
    if (result.status === "success") renderSuccess(result);
    else if (result.field === "surface") return showSurfaceError(result.message);
    else renderError(result);
    el.result.hidden = false;
    el.result.focus();
}

// ---------- start ----------
function start() {
    if (!lib || !window.DGIValuationData) {
        el.status.classList.add("error");
        el.status.textContent = "Fichiers du calculateur introuvables : dgi-valuation-data.js et dgi-valuation.js "
            + "doivent être chargés avant app.js (dossier dist/).";
        return;
    }
    try {
        calc = lib.createCalculator(window.DGIValuationData);
    } catch (error) {
        el.status.classList.add("error");
        el.status.textContent = `Les barèmes n'ont pas pu être chargés (${error.code ?? error.name}).`;
        return;
    }
    if (!calc.productionReady) {
        el.status.classList.add("notice");
        el.status.textContent = "Données en cours de validation : certains barèmes sont anciens, incomplets ou écartés.";
    } else {
        el.status.hidden = true;
    }
    el.disclaimer.textContent = calc.disclaimer;
    const available = calc.getTransactionTypes();
    for (const radio of el.transactions) radio.disabled = !available.includes(radio.value);
    el.submit.disabled = false;
    populateWilayas();

    for (const r of el.transactions) r.addEventListener("change", onTransaction);
    el.wilaya.addEventListener("change", onWilaya);
    el.commune.addEventListener("change", onCommune);
    el.nature.addEventListener("change", onNature);
    el.type.addEventListener("change", onType);
    el.zone.addEventListener("change", clearResult);
    el.surface.addEventListener("input", () => { showSurfaceError(null); clearResult(); });
    form.addEventListener("submit", onSubmit);
}

start();
})();
