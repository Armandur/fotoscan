(() => {
    const detail = document.querySelector(".detail");
    const photoId = detail.dataset.id;
    const prevId = detail.dataset.prev;
    const nextId = detail.dataset.next;
    const reviewMode = detail.dataset.review === "1";
    const form = document.getElementById("meta-form");
    const img = document.getElementById("main-img");
    const field = (name) => form.querySelector(`[name="${name}"]`);

    // ---- Spara ----
    function splitList(value) {
        return value.split(",").map(s => s.trim()).filter(Boolean);
    }

    const peopleChips = document.getElementById("people-chips");
    function collect(markReviewed) {
        const tags = [
            ...[...peopleChips.querySelectorAll(".person-chip")].map(c => ({ name: c.dataset.name, kind: "person" })),
            ...splitList(field("tags").value).map(name => ({ name, kind: "tag" })),
        ];
        return {
            date_text: field("date_text").value,
            location: field("location").value,
            notes: field("notes").value,
            source: field("source").value,
            is_negative: field("is_negative").checked,
            gps_lat: field("gps_lat").value.trim() ? parseFloat(field("gps_lat").value) : null,
            gps_lon: field("gps_lon").value.trim() ? parseFloat(field("gps_lon").value) : null,
            gps_radius_m: field("gps_radius_m").value.trim() ? parseInt(field("gps_radius_m").value, 10) : null,
            tags,
            mark_reviewed: markReviewed,
        };
    }

    async function save(markReviewed) {
        try {
            await apiFetch(`/api/photos/${photoId}`, {
                method: "POST",
                body: collect(markReviewed),
            });
            if (markReviewed) {
                setReviewedBadge(true);
                showToast("Sparat och markerat granskat");
                const qs = detail.dataset.nav || "";
                if (reviewMode) {
                    // Granskningsläge: hoppa till nästa ogranskade via /review.
                    setTimeout(() => { location.href = "/review"; }, 400);
                } else if (nextId) {
                    setTimeout(() => { location.href = `/photo/${nextId}${qs}`; }, 400);
                }
            } else {
                showToast("Sparat");
            }
        } catch (err) {
            showToast("Kunde inte spara: " + err.message, true);
        }
    }

    form.addEventListener("submit", (e) => { e.preventDefault(); save(false); });
    document.getElementById("save-btn").addEventListener("click", (e) => {
        e.preventDefault(); save(false);
    });
    document.getElementById("save-reviewed-btn").addEventListener("click", () => save(true));

    // ---- Granskad-status: klickbar växel (sätt/avmarkera) ----
    const reviewedBadge = document.getElementById("reviewed-state");
    function setReviewedBadge(on) {
        reviewedBadge.dataset.reviewed = on ? "1" : "0";
        reviewedBadge.textContent = on ? "Granskad" : "Ej granskad";
        reviewedBadge.classList.toggle("text-bg-success", on);
        reviewedBadge.classList.toggle("text-bg-secondary", !on);
    }
    reviewedBadge.addEventListener("click", async () => {
        const on = reviewedBadge.dataset.reviewed !== "1";
        try {
            await apiFetch(`/api/photos/${photoId}/reviewed?reviewed=${on}`, { method: "POST" });
            setReviewedBadge(on);
            showToast(on ? "Markerad som granskad" : "Avmarkerad");
        } catch (err) { showToast("Misslyckades: " + err.message, true); }
    });

    // ---- Export (kopia med inbäddad metadata) ----
    document.getElementById("export-btn").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
            await save(false);  // spara senaste ändringar först
            const res = await apiFetch(`/api/photos/${photoId}/export`, { method: "POST" });
            const names = res.paths.map((p) => p.split("/").pop());
            showToast(
                names.length > 1
                    ? `Exporterade ${names.length} filer: ${names.join(", ")}`
                    : "Exporterad: " + names[0]
            );
        } catch (err) {
            showToast("Export misslyckades: " + err.message, true);
        } finally {
            btn.disabled = false;
        }
    });

    // ---- Ta bort foto ur katalogen ----
    document.getElementById("delete-photo-btn").addEventListener("click", async (e) => {
        const ok = await showConfirm(
            "Ta bort fotot ur katalogen? Metadata, taggar, ansiktsrutor och " +
            "album-medlemskap för fotot tas bort. Originalfilen på disk rörs " +
            "inte - ta även bort den ur fotomappen, annars läggs fotot tillbaka " +
            "vid nästa scanning. Detta går inte att ångra.",
            { okLabel: "Ta bort", okClass: "btn-danger" }
        );
        if (!ok) return;
        e.currentTarget.disabled = true;
        try {
            await apiFetch(`/api/photos/${photoId}`, { method: "DELETE" });
            showToast("Fotot togs bort ur katalogen");
            setTimeout(() => { location.href = "/" + navQs; }, 400);
        } catch (err) {
            showToast("Borttagning misslyckades: " + err.message, true);
            e.currentTarget.disabled = false;
        }
    });

    // ---- Uteslut foto från AI-detektering ----
    const aiExclude = document.getElementById("ai-exclude");
    if (aiExclude) {
        aiExclude.addEventListener("change", async () => {
            try {
                await apiFetch(`/api/faces/ai/photo/${photoId}/exclude?exclude=${aiExclude.checked}`, { method: "POST" });
                showToast(aiExclude.checked ? "Uteslutet från AI" : "Inkluderat i AI igen");
            } catch (err) {
                showToast("Misslyckades: " + err.message, true);
                aiExclude.checked = !aiExclude.checked;  // återställ vid fel
            }
        });
    }

    // ---- Rotation ----
    // Applicera CSS-transform direkt för omedelbar känsla, byt sedan till den
    // korrekt renderade bilden i bakgrunden när servern är klar.
    const faceLayer = document.getElementById("face-layer");
    let cssRot = 0;
    async function rotate(dir) {
        cssRot = (cssRot + (dir === "cw" ? 90 : -90) + 360) % 360;
        img.style.transition = "transform .15s ease";
        img.style.transform = `rotate(${cssRot}deg)`;
        if (faceLayer) faceLayer.style.opacity = "0";  // rutorna stämmer ej under transformen
        try {
            const res = await apiFetch(`/api/photos/${photoId}/rotate?dir=${dir}`, {
                method: "POST",
            });
            // Förladda den korrekt renderade bilden och byt sömlöst.
            const fresh = new Image();
            fresh.onload = () => {
                img.style.transition = "";
                img.style.transform = "";
                cssRot = 0;
                img.src = fresh.src;
                if (faceLayer) faceLayer.style.opacity = "";
                if (window.reloadFaces) window.reloadFaces();
            };
            fresh.src = `/image/${photoId}?t=${Date.now()}`;
            showToast(`Roterad till ${res.rotation}°`);
        } catch (err) {
            showToast("Rotation misslyckades", true);
        }
    }
    document.getElementById("rot-cw").addEventListener("click", () => rotate("cw"));
    document.getElementById("rot-ccw").addEventListener("click", () => rotate("ccw"));

    // ---- Lightbox (förstora) ----
    const lbBtn = document.getElementById("lightbox-btn");
    if (lbBtn) {
        lbBtn.addEventListener("click", () => {
            // Cache-busta så senaste rendering (rotation/justering) visas
            showLightbox(lbBtn.dataset.src + "?t=" + Date.now());
        });
    }

    // ---- Inbäddat EXIF-datum: fyll fälten ----
    const exifBox = document.getElementById("exif-date-box");
    if (exifBox) {
        document.getElementById("use-exif-date").addEventListener("click", () => {
            const raw = exifBox.dataset.exif;               // "YYYY:MM:DD HH:MM:SS"
            const datePart = raw.split(" ")[0];
            const pieces = datePart.split(":");
            field("date_text").value = pieces.slice(0, 3).join("-");
            showToast("Datum ifyllt från filen");
        });
    }

    // ---- Navigering ---- (bär med filterkontexten från galleriet)
    const navQs = detail.dataset.nav || "";
    function go(id) { if (id) location.href = `/photo/${id}${navQs}`; }

    // ---- Hjälp-modal ----
    const helpModal = bootstrap.Modal.getOrCreateInstance("#help-modal");
    document.getElementById("help-btn").addEventListener("click", () => helpModal.toggle());

    // ---- Autocomplete för personer/taggar ----
    let tagCache = { person: [], tag: [] };
    async function loadTags() {
        try {
            tagCache.person = (await apiFetch("/api/tags?kind=person")).map(t => t.name);
            tagCache.tag = (await apiFetch("/api/tags?kind=tag")).map(t => t.name);
        } catch (e) {}
    }
    loadTags();

    function attachAutocomplete(input, kind) {
        const box = document.createElement("div");
        box.className = "ac-box";
        box.hidden = true;
        input.parentElement.style.position = "relative";
        input.parentElement.appendChild(box);
        let active = -1;

        function currentTerm() {
            const parts = input.value.split(",");
            return parts[parts.length - 1].trim().toLowerCase();
        }
        function applyChoice(name) {
            const parts = input.value.split(",");
            parts[parts.length - 1] = " " + name;
            input.value = parts.join(",").replace(/^\s+/, "");
            box.hidden = true;
        }
        function render() {
            const term = currentTerm();
            const chosen = new Set(
                input.value.split(",").map(s => s.trim().toLowerCase())
            );
            const matches = tagCache[kind].filter(n =>
                n.toLowerCase().includes(term) && !chosen.has(n.toLowerCase())
            ).slice(0, 8);
            if (!term || matches.length === 0) { box.hidden = true; return; }
            box.innerHTML = matches.map((n, i) =>
                `<div class="ac-item${i === active ? " active" : ""}" data-name="${escapeHtml(n)}">${escapeHtml(n)}</div>`
            ).join("");
            box.hidden = false;
        }
        input.addEventListener("input", () => { active = -1; render(); });
        input.addEventListener("focus", render);
        input.addEventListener("blur", () => setTimeout(() => { box.hidden = true; }, 150));
        box.addEventListener("mousedown", (e) => {
            const item = e.target.closest(".ac-item");
            if (item) { e.preventDefault(); applyChoice(item.dataset.name); input.focus(); }
        });
        input.addEventListener("keydown", (e) => {
            if (box.hidden) return;
            const items = [...box.querySelectorAll(".ac-item")];
            if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, items.length - 1); render(); }
            else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
            else if ((e.key === "Enter" || e.key === "Tab") && active >= 0) {
                e.preventDefault(); applyChoice(items[active].dataset.name);
            }
        });
    }
    attachAutocomplete(field("tags"), "tag");

    // ---- Personer som klickbara chips + add-autocomplete (tumnaglar) ----
    function addPersonChip(name, id) {
        name = (name || "").trim();
        if (!name) return;
        if ([...peopleChips.querySelectorAll(".person-chip")]
            .some(c => c.dataset.name.toLowerCase() === name.toLowerCase())) return;
        const chip = document.createElement("span");
        chip.className = "person-chip badge text-bg-secondary d-inline-flex align-items-center gap-1";
        chip.dataset.name = name;
        const label = document.createElement(id ? "a" : "span");
        label.textContent = name;
        label.className = "text-white text-decoration-none";
        if (id) { chip.dataset.id = id; label.href = `/persons/${id}`; }
        const x = document.createElement("a");
        x.href = "#"; x.className = "chip-x text-white text-decoration-none";
        x.title = "Ta bort"; x.innerHTML = "&times;";
        chip.append(label, x);
        peopleChips.appendChild(chip);
    }
    peopleChips.addEventListener("click", (e) => {
        const x = e.target.closest(".chip-x");
        if (x) { e.preventDefault(); x.closest(".person-chip").remove(); }
    });
    // Manuellt markerade ansikten lägger sin person här direkt (faces.js anropar).
    window.addPersonChip = addPersonChip;

    const addInput = document.getElementById("people-add");
    const addAc = document.getElementById("people-ac");
    let pItems = [], pActive = -1;
    const pRender = () => {
        addAc.innerHTML = pItems.map((p, i) => {
            const thumb = p.region_id
                ? `<img class="face-ac-thumb" src="/api/faces/${p.region_id}/thumb" alt="">`
                : `<span class="face-ac-thumb empty"><i class="bi bi-person"></i></span>`;
            return `<div class="face-ac-item${i === pActive ? " active" : ""}" data-id="${p.id}" data-name="${escapeHtml(p.name)}">`
                + thumb + `<span class="face-ac-name">${escapeHtml(p.name)}</span>`
                + `<span class="face-ac-count">${p.count}</span></div>`;
        }).join("");
        addAc.classList.toggle("show", pItems.length > 0);
    };
    const pSearch = async () => {
        try { pItems = await apiFetch(`/api/persons?q=${encodeURIComponent(addInput.value.trim())}`); }
        catch (e) { pItems = []; }
        pActive = -1; pRender();
    };
    const pPick = (item) => { addPersonChip(item.name, item.id); addInput.value = ""; pItems = []; pRender(); };
    addAc.addEventListener("mousedown", (e) => {
        const it = e.target.closest(".face-ac-item");
        if (it) { e.preventDefault(); pPick({ id: +it.dataset.id, name: it.dataset.name }); }
    });
    addInput.addEventListener("input", pSearch);
    addInput.addEventListener("focus", pSearch);
    addInput.addEventListener("blur", () => setTimeout(() => addAc.classList.remove("show"), 150));
    addInput.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); pActive = Math.min(pActive + 1, pItems.length - 1); pRender(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); pActive = Math.max(pActive - 1, 0); pRender(); }
        else if (e.key === "Enter") {
            e.preventDefault();
            if (pActive >= 0) pPick(pItems[pActive]);
            else if (addInput.value.trim()) { addPersonChip(addInput.value.trim(), null); addInput.value = ""; addAc.classList.remove("show"); }
        } else if (e.key === "Escape") { addAc.classList.remove("show"); }
    });

    // Enkelvärdes-autocomplete för Plats mot redan registrerade platser.
    function attachPlaceAutocomplete(input) {
        const box = document.createElement("div");
        box.className = "ac-box";
        box.hidden = true;
        input.parentElement.style.position = "relative";
        input.parentElement.appendChild(box);
        let active = -1, items = [];
        async function search() {
            try { items = await apiFetch(`/api/places?q=${encodeURIComponent(input.value.trim())}`); }
            catch (e) { items = []; }
            active = -1; render();
        }
        function render() {
            const cur = input.value.trim().toLowerCase();
            const matches = items.filter(p => p.name.toLowerCase() !== cur).slice(0, 8);
            if (!matches.length) { box.hidden = true; return; }
            box.innerHTML = matches.map((p, i) =>
                `<div class="ac-item${i === active ? " active" : ""}" data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>`
            ).join("");
            box.hidden = false;
        }
        input.addEventListener("input", search);
        input.addEventListener("focus", search);
        input.addEventListener("blur", () => setTimeout(() => { box.hidden = true; }, 150));
        box.addEventListener("mousedown", (e) => {
            const item = e.target.closest(".ac-item");
            if (item) { e.preventDefault(); input.value = item.dataset.name; box.hidden = true; }
        });
        input.addEventListener("keydown", (e) => {
            if (box.hidden) return;
            const els = [...box.querySelectorAll(".ac-item")];
            if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, els.length - 1); render(); }
            else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
            else if ((e.key === "Enter" || e.key === "Tab") && active >= 0) {
                e.preventDefault(); input.value = els[active].dataset.name; box.hidden = true;
            }
        });
    }
    attachPlaceAutocomplete(field("location"));

    // ---- Globala kortkommandon ----
    const fieldKeys = {
        d: "date_text", l: "location", p: "people-add",
        t: "tags", n: "notes",
    };
    document.addEventListener("keydown", (e) => {
        const el = document.activeElement;
        const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");

        // Spara fungerar även när man skriver.
        if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(false); return; }
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); save(true); return; }

        if (e.key === "Escape" && typing) { el.blur(); return; }
        if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
        if (document.body.classList.contains("modal-open")) return;

        if (e.key === "?" ) { e.preventDefault(); helpModal.toggle(); return; }
        if (e.key === "j" || e.key === "ArrowRight") { e.preventDefault(); go(nextId); return; }
        if (e.key === "k" || e.key === "ArrowLeft") { e.preventDefault(); go(prevId); return; }
        if (e.key === "r") { e.preventDefault(); rotate("cw"); return; }
        if (e.key === "R") { e.preventDefault(); rotate("ccw"); return; }
        if (e.key === "f") { e.preventDefault(); window.toggleFaceDraw && window.toggleFaceDraw(); return; }
        if (e.key === "m") { e.preventDefault(); window.openPairModal && window.openPairModal(); return; }
        if (e.key === "g") { e.preventDefault(); location.href = "/" + navQs; return; }
        // Färgjustering
        if (e.key === "c") { e.preventDefault(); window.adjToggle && window.adjToggle(); return; }
        if (e.key === "a") { e.preventDefault(); window.adjAuto && window.adjAuto(); return; }
        if (e.key === "x") { e.preventDefault(); window.adjReset && window.adjReset(); return; }

        const lower = e.key.toLowerCase();
        if (fieldKeys[lower]) {
            e.preventDefault();
            const target = field(fieldKeys[lower]);
            target.focus();
            if (target.setSelectionRange) {
                const v = target.value.length;
                target.setSelectionRange(v, v);
            }
        }
    });
})();
