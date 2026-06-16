(() => {
    const detail = document.querySelector(".detail");
    if (!detail) return;
    const photoId = detail.dataset.id;
    const layer = document.getElementById("face-layer");
    const btn = document.getElementById("face-tag-btn");

    let drawMode = false;
    let drag = null;        // pågående ritning
    let nameOpen = false;   // pågående namninmatning

    // ---- Rendera befintliga regioner ----
    function makeBox(face) {
        const box = document.createElement("div");
        box.className = "face-box";
        box.style.left = `${face.x * 100}%`;
        box.style.top = `${face.y * 100}%`;
        box.style.width = `${face.w * 100}%`;
        box.style.height = `${face.h * 100}%`;

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
                await apiFetch(`/api/faces/${face.id}`, { method: "DELETE" });
                box.remove();
                showToast("Ansiktstagg borttagen");
            } catch (err) {
                showToast("Kunde inte ta bort: " + err.message, true);
            }
        });

        box.append(label, del);
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
    window.toggleFaceDraw = () => setDrawMode(!drawMode);  // för kortkommando

    function relPos(e) {
        const r = layer.getBoundingClientRect();
        return {
            x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
            y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
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
        const x = Math.min(drag.x0, p.x), y = Math.min(drag.y0, p.y);
        const w = Math.abs(p.x - drag.x0), h = Math.abs(p.y - drag.y0);
        Object.assign(drag.box.style, {
            left: `${x * 100}%`, top: `${y * 100}%`,
            width: `${w * 100}%`, height: `${h * 100}%`,
        });
    });

    window.addEventListener("mouseup", (e) => {
        if (!drag) return;
        const p = relPos(e);
        const rect = {
            x: Math.min(drag.x0, p.x), y: Math.min(drag.y0, p.y),
            w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0),
        };
        const box = drag.box;
        drag = null;
        if (rect.w < 0.02 || rect.h < 0.02) { box.remove(); return; }
        setDrawMode(false);       // markeringen klar - lämna ritläget
        promptName(box, rect);
    });

    // ---- Namninmatning med personsök (thumbnails) ----
    function promptName(box, rect) {
        nameOpen = true;
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
                    body: { person: person, ...rect },
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
                // Vald rad -> den personen; annars fritext (tomt -> Okänd-N i backend)
                save(active >= 0 ? items[active].name : input.value.trim());
            } else if (e.key === "Escape") {
                e.preventDefault(); cancel();
            }
        });
        // Klick utanför sparar (tomt namn blir Okänd-N)
        input.addEventListener("blur", () => {
            setTimeout(() => { if (nameOpen) save(input.value.trim()); }, 150);
        });
    }
})();
