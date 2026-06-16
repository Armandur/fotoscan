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
                if (p && p.orphaned &&
                    confirm(`"${p.name}" har inga taggningar kvar. Ta bort personen ur registret?`)) {
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

    // ---- Namninmatning med personsök (thumbnails) ----
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
        let active = -1, items = [];

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

        const render = () => {
            ac.innerHTML = items.map((p, i) => {
                const thumb = p.region_id
                    ? `<img class="face-ac-thumb" src="/api/faces/${p.region_id}/thumb" alt="">`
                    : `<span class="face-ac-thumb empty"><i class="bi bi-person"></i></span>`;
                return `<div class="face-ac-item${i === active ? " active" : ""}" data-name="${escapeHtml(p.name)}">`
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
            if (item) { e.preventDefault(); save(item.dataset.name); }
        });
        input.addEventListener("input", search);
        input.addEventListener("focus", search);
        input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, items.length - 1); render(); }
            else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
            else if (e.key === "Enter") {
                e.preventDefault();
                save(active >= 0 ? items[active].name : input.value.trim());
            } else if (e.key === "Escape") {
                e.preventDefault(); cancel();
            }
        });
        input.addEventListener("blur", () => {
            setTimeout(() => { if (nameOpen) save(input.value.trim()); }, 150);
        });
    }
})();
