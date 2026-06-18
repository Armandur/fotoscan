(() => {
    const detail = document.querySelector(".detail");
    if (!detail) return;
    const photoId = detail.dataset.id;
    const layer = document.getElementById("face-layer");
    const btn = document.getElementById("face-tag-btn");

    let drawMode = false;
    let drag = null;        // pågående ritning
    let nameOpen = false;   // pågående namninmatning

    const clamp01 = (v) => Math.max(0, Math.min(1, v));

    function setBox(box, r) {
        box._rect = r;
        box.style.left = `${r.x * 100}%`;
        box.style.top = `${r.y * 100}%`;
        box.style.width = `${r.w * 100}%`;
        box.style.height = `${r.h * 100}%`;
    }

    // Gör en ruta flyttbar (dra i kroppen) och storleksändringsbar (hörnhandtag).
    function makeEditable(box, onCommit) {
        const handle = document.createElement("div");
        handle.className = "face-handle";
        box.appendChild(handle);

        box.addEventListener("mousedown", (e) => {
            if (e.target.classList.contains("face-del")) return;
            if (e.target.closest(".face-name")) return;
            e.preventDefault();
            e.stopPropagation();
            const resizing = e.target === handle;
            const lr = layer.getBoundingClientRect();
            const r0 = { ...box._rect };
            const sx = e.clientX, sy = e.clientY;

            const onMove = (ev) => {
                const dx = (ev.clientX - sx) / lr.width;
                const dy = (ev.clientY - sy) / lr.height;
                if (resizing) {
                    const w = Math.max(0.02, Math.min(r0.w + dx, 1 - r0.x));
                    const h = Math.max(0.02, Math.min(r0.h + dy, 1 - r0.y));
                    setBox(box, { x: r0.x, y: r0.y, w, h });
                } else {
                    const x = Math.max(0, Math.min(r0.x + dx, 1 - r0.w));
                    const y = Math.max(0, Math.min(r0.y + dy, 1 - r0.h));
                    setBox(box, { x, y, w: r0.w, h: r0.h });
                }
            };
            const onUp = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
                onCommit(box._rect);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
        });
    }

    // ---- Rendera befintliga regioner ----
    function makeBox(face) {
        const box = document.createElement("div");
        box.className = "face-box";
        setBox(box, { x: face.x, y: face.y, w: face.w, h: face.h });

        const label = document.createElement("span");
        label.className = "face-label";
        label.textContent = face.person;
        label.title = "Klicka för att byta person";
        label.style.cursor = "pointer";
        // Klick på etiketten byter person; stoppa drag-starten (box-mousedown).
        label.addEventListener("mousedown", (e) => e.stopPropagation());
        label.addEventListener("click", (e) => { e.stopPropagation(); editPerson(box, face); });

        const del = document.createElement("button");
        del.type = "button";
        del.className = "face-del";
        del.title = "Ta bort";
        del.innerHTML = "&times;";
        del.addEventListener("click", async (e) => {
            e.stopPropagation();
            try {
                const res = await apiFetch(`/api/faces/${face.id}`, { method: "DELETE" });
                box.remove();
                showToast("Ansiktstagg borttagen");
                const p = res.person;
                if (p && p.orphaned && await showConfirm(
                    `"${p.name}" har inga taggningar kvar. Ta bort personen ur registret?`,
                    { okLabel: "Ta bort", okClass: "btn-danger" })) {
                    await apiFetch(`/api/persons/${p.id}`, { method: "DELETE" });
                    showToast("Personen borttagen");
                }
            } catch (err) {
                showToast("Kunde inte ta bort: " + err.message, true);
            }
        });

        box.append(label, del);
        makeEditable(box, async (r) => {
            try {
                await apiFetch(`/api/faces/${face.id}/move`, { method: "POST", body: r });
            } catch (err) {
                showToast("Kunde inte flytta: " + err.message, true);
            }
        });
        return box;
    }

    async function loadFaces() {
        layer.querySelectorAll(".face-box").forEach(b => b.remove());
        try {
            const faces = await apiFetch(`/api/photos/${photoId}/faces`);
            faces.forEach(f => layer.appendChild(makeBox(f)));
        } catch (e) {}
    }
    loadFaces();
    window.reloadFaces = loadFaces;  // anropas efter rotation

    // ---- Håll (knapp eller H) för att tillfälligt dölja ansiktsrutorna ----
    const facesHide = (on) => { layer.style.visibility = on ? "hidden" : ""; };
    const hideBtn = document.getElementById("face-hide-btn");
    if (hideBtn) {
        hideBtn.addEventListener("mousedown", () => facesHide(true));
        hideBtn.addEventListener("touchstart", (e) => { e.preventDefault(); facesHide(true); });
        ["mouseup", "mouseleave", "touchend", "touchcancel"].forEach(ev =>
            hideBtn.addEventListener(ev, () => facesHide(false)));
    }
    document.addEventListener("keydown", (e) => {
        if (e.key !== "h" && e.key !== "H") return;
        const el = document.activeElement;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        facesHide(true);
    });
    document.addEventListener("keyup", (e) => {
        if (e.key === "h" || e.key === "H") facesHide(false);
    });
    window.addEventListener("blur", () => facesHide(false));

    // ---- Ritläge ----
    function setDrawMode(on) {
        drawMode = on;
        layer.classList.toggle("drawing", on);
        btn.classList.toggle("active", on);
        btn.classList.toggle("btn-info", on);
        btn.classList.toggle("btn-outline-secondary", !on);
    }
    btn.addEventListener("click", () => setDrawMode(!drawMode));
    window.toggleFaceDraw = () => setDrawMode(!drawMode);

    function relPos(e) {
        const r = layer.getBoundingClientRect();
        return {
            x: clamp01((e.clientX - r.left) / r.width),
            y: clamp01((e.clientY - r.top) / r.height),
        };
    }

    layer.addEventListener("mousedown", (e) => {
        if (!drawMode || nameOpen) return;
        e.preventDefault();
        const p = relPos(e);
        const box = document.createElement("div");
        box.className = "face-box drawing-box";
        layer.appendChild(box);
        drag = { x0: p.x, y0: p.y, box };
    });

    window.addEventListener("mousemove", (e) => {
        if (!drag) return;
        const p = relPos(e);
        setBox(drag.box, {
            x: Math.min(drag.x0, p.x), y: Math.min(drag.y0, p.y),
            w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0),
        });
    });

    window.addEventListener("mouseup", (e) => {
        if (!drag) return;
        const box = drag.box;
        const rect = box._rect || { w: 0, h: 0 };
        drag = null;
        if (rect.w < 0.02 || rect.h < 0.02) { box.remove(); return; }
        setDrawMode(false);
        box.classList.remove("drawing-box");
        promptName(box);
    });

    // ---- Personsök med tumnaglar (delas av ny-tagg och byt-person) ----
    // onChoose(person|null): {id,name} vid val, {name} vid fritext, null vid Esc.
    function attachPersonAC(input, ac, onChoose) {
        let active = -1, items = [];
        const render = () => {
            ac.innerHTML = items.map((p, i) => {
                const thumb = p.region_id
                    ? `<img class="face-ac-thumb" src="/api/faces/${p.region_id}/thumb" alt="">`
                    : `<span class="face-ac-thumb empty"><i class="bi bi-person"></i></span>`;
                return `<div class="face-ac-item${i === active ? " active" : ""}" data-id="${p.id}" data-name="${escapeHtml(p.name)}">`
                    + thumb
                    + `<span class="face-ac-name">${escapeHtml(p.name)}</span>`
                    + `<span class="face-ac-count">${p.count}</span></div>`;
            }).join("");
            ac.classList.toggle("show", items.length > 0);
            const act = ac.querySelector(".face-ac-item.active");
            if (act) act.scrollIntoView({ block: "nearest" });
        };
        const search = async () => {
            try {
                items = await apiFetch(`/api/persons?q=${encodeURIComponent(input.value.trim())}`);
            } catch (e) { items = []; }
            active = -1;
            render();
        };
        ac.addEventListener("mousedown", (e) => {
            const item = e.target.closest(".face-ac-item");
            if (item) { e.preventDefault(); onChoose({ id: +item.dataset.id, name: item.dataset.name }); }
        });
        input.addEventListener("input", search);
        input.addEventListener("focus", search);
        input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, items.length - 1); render(); }
            else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
            else if (e.key === "Enter") {
                e.preventDefault();
                onChoose(active >= 0 ? { id: items[active].id, name: items[active].name } : { name: input.value.trim() });
            } else if (e.key === "Escape") { e.preventDefault(); onChoose(null); }
        });
    }

    // ---- Ny tagg: namnge en nyritad ruta ----
    function promptName(box) {
        nameOpen = true;
        let pending = { ...box._rect };
        makeEditable(box, (r) => { pending = r; });  // justerbar medan man namnger

        const wrap = document.createElement("div");
        wrap.className = "face-name";
        wrap.innerHTML =
            `<input type="text" class="form-control form-control-sm face-name-input" ` +
            `placeholder="Sök eller registrera person" autocomplete="off">` +
            `<div class="face-ac"></div>`;
        box.appendChild(wrap);
        const input = wrap.querySelector("input");
        const ac = wrap.querySelector(".face-ac");
        input.focus();
        const cancel = () => { nameOpen = false; box.remove(); };

        const save = async (person) => {
            try {
                const face = await apiFetch(`/api/photos/${photoId}/faces`, {
                    method: "POST",
                    body: { person: person, ...pending },
                });
                nameOpen = false;
                box.remove();
                layer.appendChild(makeBox(face));
                showToast("Ansikte taggat: " + face.person);
            } catch (err) {
                showToast("Kunde inte spara: " + err.message, true);
                cancel();
            }
        };

        attachPersonAC(input, ac, (p) => p === null ? cancel() : save(p.name));
        input.addEventListener("blur", () => {
            setTimeout(() => { if (nameOpen) save(input.value.trim()); }, 150);
        });
    }

    // ---- Byt person på en befintlig ruta ----
    function editPerson(box, face) {
        if (nameOpen || box.querySelector(".face-name")) return;
        nameOpen = true;
        const wrap = document.createElement("div");
        wrap.className = "face-name";
        wrap.innerHTML =
            `<input type="text" class="form-control form-control-sm face-name-input" ` +
            `placeholder="Byt person..." autocomplete="off"><div class="face-ac"></div>`;
        box.appendChild(wrap);
        const input = wrap.querySelector("input");
        const ac = wrap.querySelector(".face-ac");
        input.focus();
        const close = () => { nameOpen = false; wrap.remove(); };

        const apply = async (body, label) => {
            try {
                const res = await apiFetch(`/api/faces/${face.id}/person`, { method: "POST", body });
                face.person = res.person.name;
                box.querySelector(".face-label").textContent = res.person.name;
                close();
                showToast("Person ändrad: " + res.person.name);
                if (res.old && res.old.orphaned && await showConfirm(
                    `"${res.old.name}" har inga taggningar kvar. Ta bort personen ur registret?`,
                    { okLabel: "Ta bort", okClass: "btn-danger" })) {
                    await apiFetch(`/api/persons/${res.old.id}`, { method: "DELETE" });
                    showToast("Personen borttagen");
                }
            } catch (err) { showToast("Kunde inte byta person: " + err.message, true); }
        };

        attachPersonAC(input, ac, (p) => {
            if (p === null) close();
            else if (p.id) apply({ tag_id: p.id }, p.name);
            else if (p.name) apply({ name: p.name }, p.name);
            else close();
        });
        input.addEventListener("blur", () => setTimeout(() => { if (nameOpen) close(); }, 150));
    }
})();
