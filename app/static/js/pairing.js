(() => {
    const block = document.getElementById("pair-block");
    if (!block) return;
    const photoId = block.dataset.id;

    // Koppla isär
    const unpairBtn = document.getElementById("unpair-btn");
    if (unpairBtn) {
        unpairBtn.addEventListener("click", async () => {
            try {
                await apiFetch(`/api/photos/${photoId}/unpair`, { method: "POST" });
                showToast("Kopplingen borttagen");
                setTimeout(() => location.reload(), 500);
            } catch (err) {
                showToast("Kunde inte koppla isär: " + err.message, true);
            }
        });
        return;  // redan parad - ingen sökmodal behövs
    }

    const pairBtn = document.getElementById("pair-btn");
    if (!pairBtn) return;
    const modal = bootstrap.Modal.getOrCreateInstance("#pair-modal");
    const search = document.getElementById("pair-search");
    const showMatched = document.getElementById("pair-show-matched");
    const list = document.getElementById("pair-candidates");
    const conflictsBox = document.getElementById("pair-conflicts");

    pairBtn.addEventListener("click", () => {
        conflictsBox.hidden = true;
        modal.show();
        loadCandidates();
    });

    async function loadCandidates() {
        const params = new URLSearchParams({
            q: search.value.trim(),
            show_matched: showMatched.checked ? "true" : "false",
        });
        try {
            const cands = await apiFetch(`/api/photos/${photoId}/pair-candidates?${params}`);
            renderCandidates(cands);
        } catch (e) {
            list.innerHTML = `<div class="text-secondary">Kunde inte hämta kandidater</div>`;
        }
    }

    function renderCandidates(cands) {
        list.innerHTML = "";
        if (!cands.length) {
            list.innerHTML = `<div class="text-secondary p-3">Inga matchande foton</div>`;
            return;
        }
        cands.forEach(c => {
            const card = document.createElement("div");
            card.className = "card photo-card";
            card.style.cursor = "pointer";
            const neg = c.is_negative ? `<span class="badge text-bg-secondary">negativ</span>` : "";
            card.innerHTML =
                `<img loading="lazy" class="card-img-top loaded" src="/thumb/${c.id}" alt="">` +
                `<div class="card-body p-2">` +
                `<div class="text-info small text-truncate">${escapeHtml(c.date) || "?"} ${neg}</div>` +
                `<div class="text-secondary small text-truncate">${escapeHtml(c.filename)}</div>` +
                `<div class="text-secondary small text-truncate"><i class="bi bi-folder"></i> ${escapeHtml(c.folder) || "(rot)"}</div>` +
                `</div>`;
            card.addEventListener("click", () => attemptPair(c.id));
            list.appendChild(card);
        });
    }

    async function attemptPair(otherId, resolutions) {
        try {
            const res = await apiFetch(`/api/photos/${photoId}/pair`, {
                method: "POST",
                body: { other_id: otherId, resolutions: resolutions || {} },
            });
            if (res.needs_resolution) {
                renderConflicts(otherId, res.conflicts);
                return;
            }
            showToast("Hopparade och sammanslagen metadata");
            setTimeout(() => location.reload(), 600);
        } catch (err) {
            showToast("Kunde inte para ihop: " + err.message, true);
        }
    }

    function renderConflicts(otherId, conflicts) {
        list.hidden = true;
        conflictsBox.hidden = false;
        conflictsBox.innerHTML =
            `<p class="text-warning">Metadatakonflikter - välj vilket värde som gäller:</p>` +
            conflicts.map(c => `
                <div class="mb-3" data-field="${c.field}">
                    <div class="fw-bold small mb-1">${escapeHtml(c.label)}</div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cf-${c.field}" value="a" checked
                               id="cf-${c.field}-a">
                        <label class="form-check-label" for="cf-${c.field}-a">Detta foto: <code>${escapeHtml(String(c.a))}</code></label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="cf-${c.field}" value="b"
                               id="cf-${c.field}-b">
                        <label class="form-check-label" for="cf-${c.field}-b">Andra fotot: <code>${escapeHtml(String(c.b))}</code></label>
                    </div>
                </div>`).join("") +
            `<button class="btn btn-primary" id="pair-confirm">Para ihop med valda värden</button>`;
        document.getElementById("pair-confirm").addEventListener("click", () => {
            const resolutions = {};
            conflicts.forEach(c => {
                const sel = conflictsBox.querySelector(`input[name="cf-${c.field}"]:checked`);
                resolutions[c.field] = sel ? sel.value : "a";
            });
            attemptPair(otherId, resolutions);
        });
    }

    let searchTimer = null;
    search.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(loadCandidates, 250);
    });
    showMatched.addEventListener("change", loadCandidates);
})();
