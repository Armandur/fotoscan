async function apiFetch(url, options = {}) {
    const opts = { headers: {}, ...options };
    if (opts.body && typeof opts.body !== "string") {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
        let msg = res.statusText;
        try { msg = (await res.json()).detail || msg; } catch (e) {}
        throw new Error(msg);
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res.text();
}

function showToast(message, isError = false) {
    const el = document.getElementById("toast");
    if (!el) return;
    document.getElementById("toast-body").textContent = message;
    el.classList.remove("text-bg-danger", "text-bg-success");
    el.classList.add(isError ? "text-bg-danger" : "text-bg-success");
    bootstrap.Toast.getOrCreateInstance(el, { delay: 3000 }).show();
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}

// Bekräftelsedialog via Bootstrap-modal. Returnerar Promise<boolean>.
// Använd denna i stället för window.confirm().
function showConfirm(message, { okLabel = "OK", okClass = "btn-primary" } = {}) {
    return new Promise((resolve) => {
        const el = document.getElementById("confirm-modal");
        if (!el) { resolve(false); return; }
        document.getElementById("confirm-modal-body").textContent = message;
        const okBtn = document.getElementById("confirm-ok");
        okBtn.className = "btn " + okClass;
        okBtn.textContent = okLabel;
        const modal = bootstrap.Modal.getOrCreateInstance(el);
        let confirmed = false;
        const onOk = () => { confirmed = true; modal.hide(); };
        const onHide = () => {
            okBtn.removeEventListener("click", onOk);
            el.removeEventListener("hidden.bs.modal", onHide);
            resolve(confirmed);
        };
        okBtn.addEventListener("click", onOk);
        el.addEventListener("hidden.bs.modal", onHide);
        modal.show();
    });
}

// Lightbox med zoom (mushjul), panorering (dra) och översiktskarta.
// Esc/stäng-knapp/klick på bakgrunden stänger. Dubbelklick växlar zoom.
const _lb = {
    scale: 1, tx: 0, ty: 0,
    dragging: false, sx: 0, sy: 0, stx: 0, sty: 0, moved: false,
};
const _LB_MAX = 8;

function _lbEls() {
    return {
        box: document.getElementById("lightbox"),
        stage: document.getElementById("lightbox-stage"),
        img: document.getElementById("lightbox-img"),
        mm: document.getElementById("lightbox-minimap"),
        mmImg: document.getElementById("lightbox-minimap-img"),
        mmView: document.getElementById("lightbox-minimap-view"),
    };
}

function _lbApply() {
    const { stage, img, mm } = _lbEls();
    if (_lb.scale <= 1) { _lb.scale = 1; _lb.tx = 0; _lb.ty = 0; }
    // Begränsa panorering så bilden inte kan dras helt utanför vyn.
    const maxX = Math.max(0, (img.clientWidth * _lb.scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (img.clientHeight * _lb.scale - stage.clientHeight) / 2);
    _lb.tx = Math.min(maxX, Math.max(-maxX, _lb.tx));
    _lb.ty = Math.min(maxY, Math.max(-maxY, _lb.ty));
    img.style.transform = `translate(${_lb.tx}px, ${_lb.ty}px) scale(${_lb.scale})`;
    img.style.cursor = _lb.scale > 1 ? (_lb.dragging ? "grabbing" : "grab") : "zoom-out";

    const zoomed = _lb.scale > 1.001;
    mm.hidden = !zoomed;
    if (zoomed) _lbMinimap();
}

function _lbMinimap() {
    const { stage, img, mm, mmView } = _lbEls();
    const w = img.clientWidth * _lb.scale, h = img.clientHeight * _lb.scale;
    const left = stage.clientWidth / 2 + _lb.tx - w / 2;
    const top = stage.clientHeight / 2 + _lb.ty - h / 2;
    const clamp = (n) => Math.max(0, Math.min(1, n));
    const u0 = clamp(-left / w), u1 = clamp((stage.clientWidth - left) / w);
    const v0 = clamp(-top / h), v1 = clamp((stage.clientHeight - top) / h);
    const mmW = mm.clientWidth, mmH = mm.clientHeight;
    mmView.style.left = (u0 * mmW) + "px";
    mmView.style.top = (v0 * mmH) + "px";
    mmView.style.width = ((u1 - u0) * mmW) + "px";
    mmView.style.height = ((v1 - v0) * mmH) + "px";
}

function _lbZoomAt(clientX, clientY, newScale) {
    const { stage } = _lbEls();
    const rect = stage.getBoundingClientRect();
    const cx = clientX - rect.left - rect.width / 2;
    const cy = clientY - rect.top - rect.height / 2;
    newScale = Math.min(_LB_MAX, Math.max(1, newScale));
    if (newScale === _lb.scale) return;
    _lb.tx = cx - (cx - _lb.tx) * (newScale / _lb.scale);
    _lb.ty = cy - (cy - _lb.ty) * (newScale / _lb.scale);
    _lb.scale = newScale;
    _lbApply();
}

function showLightbox(src) {
    const { box, img, mmImg } = _lbEls();
    if (!box) return;
    _lb.scale = 1; _lb.tx = 0; _lb.ty = 0; _lb.dragging = false; _lb.moved = false;
    img.src = src;
    if (mmImg) mmImg.src = src;
    box.hidden = false;
    if (img.complete && img.naturalWidth) _lbApply();
    else img.addEventListener("load", _lbApply, { once: true });
}

function _closeLightbox() {
    const { box, img, mmImg } = _lbEls();
    if (!box || box.hidden) return;
    box.hidden = true;
    img.src = "";
    if (mmImg) mmImg.src = "";
}

document.addEventListener("DOMContentLoaded", () => {
    const { box, stage, img, mm } = _lbEls();
    if (!box) return;

    stage.addEventListener("wheel", (e) => {
        e.preventDefault();
        _lbZoomAt(e.clientX, e.clientY, _lb.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
    }, { passive: false });

    img.addEventListener("mousedown", (e) => {
        if (_lb.scale <= 1) return;
        _lb.dragging = true; _lb.moved = false;
        _lb.sx = e.clientX; _lb.sy = e.clientY; _lb.stx = _lb.tx; _lb.sty = _lb.ty;
        e.preventDefault();
        _lbApply();
    });
    window.addEventListener("mousemove", (e) => {
        if (!_lb.dragging) return;
        _lb.tx = _lb.stx + (e.clientX - _lb.sx);
        _lb.ty = _lb.sty + (e.clientY - _lb.sy);
        if (Math.abs(e.clientX - _lb.sx) > 3 || Math.abs(e.clientY - _lb.sy) > 3) _lb.moved = true;
        _lbApply();
    });
    window.addEventListener("mouseup", () => {
        if (_lb.dragging) { _lb.dragging = false; _lbApply(); }
    });

    stage.addEventListener("dblclick", (e) => {
        if (_lb.scale > 1) { _lb.scale = 1; _lb.tx = 0; _lb.ty = 0; _lbApply(); }
        else _lbZoomAt(e.clientX, e.clientY, 2.5);
    });

    // Klick på bakgrunden (eller på bilden i ozoomat läge) stänger; en panorering
    // räknas inte som klick.
    stage.addEventListener("click", (e) => {
        if (_lb.moved) { _lb.moved = false; return; }
        if (e.target === img && _lb.scale > 1) return;
        _closeLightbox();
    });

    document.getElementById("lightbox-close").addEventListener("click", _closeLightbox);

    // Klick i översiktskartan centrerar vyn där.
    mm.addEventListener("mousedown", (e) => {
        const rect = mm.getBoundingClientRect();
        const u = (e.clientX - rect.left) / rect.width;
        const v = (e.clientY - rect.top) / rect.height;
        _lb.tx = -(u - 0.5) * img.clientWidth * _lb.scale;
        _lb.ty = -(v - 0.5) * img.clientHeight * _lb.scale;
        e.stopPropagation();
        _lbApply();
    });
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") _closeLightbox();
});

// Kortstorlek: sätter --card-min på gallery-grid, sparas i localStorage så
// valet gäller i alla vyer (galleri, person/tagg/plats/tidslinje/dubbletter).
function applyCardSize(px) {
    document.documentElement.style.setProperty("--card-min", px + "px");
    document.querySelectorAll("#card-size button").forEach((b) =>
        b.classList.toggle("active", b.dataset.size === String(px)));
}
// Körs direkt (utils.js laddas sist i body -> #card-size finns redan).
(() => {
    applyCardSize(localStorage.getItem("cardSize") || "150");
    const group = document.getElementById("card-size");
    if (group) {
        group.addEventListener("click", (e) => {
            const b = e.target.closest("button[data-size]");
            if (!b) return;
            localStorage.setItem("cardSize", b.dataset.size);
            applyCardSize(b.dataset.size);
        });
    }
})();

// Markera thumbnails som laddade så skeleton-shimmern stängs av.
function initSkeletons() {
    document.querySelectorAll("img.card-img-top").forEach((img) => {
        if (img.complete && img.naturalWidth) { img.classList.add("loaded"); return; }
        const done = () => img.classList.add("loaded");
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
    });
}
document.addEventListener("DOMContentLoaded", initSkeletons);
