(() => {
    const block = document.getElementById("pair-block");
    if (!block) return;
    const photoId = block.dataset.id;

    // Koppla isär + "håll för att jämföra" (visa det hopparade fotot)
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

        // Håll-för-att-jämföra: visa hopparade fotot medan knapp/tangent hålls in.
        const img = document.getElementById("main-img");
        const peekBtn = document.getElementById("peek-btn");
        const pairedId = block.dataset.pairedId;
        const pairedV = block.dataset.pairedV || "0";
        if (img && peekBtn && pairedId) {
            const ownSrc = img.src;
            const pairedSrc = `/image/${pairedId}?v=${pairedV}`;
            new Image().src = pairedSrc;  // förladda för direkt växling
            let peeking = false;
            const peekOn = () => { if (!peeking) { peeking = true; img.src = pairedSrc; peekBtn.classList.add("active"); } };
            const peekOff = () => { if (peeking) { peeking = false; img.src = ownSrc; peekBtn.classList.remove("active"); } };

            peekBtn.addEventListener("mousedown", (e) => { e.preventDefault(); peekOn(); });
            peekBtn.addEventListener("mouseup", peekOff);
            peekBtn.addEventListener("mouseleave", peekOff);
            peekBtn.addEventListener("touchstart", (e) => { e.preventDefault(); peekOn(); }, { passive: false });
            peekBtn.addEventListener("touchend", peekOff);

            document.addEventListener("keydown", (e) => {
                if (e.key !== "v" && e.key !== "V") return;
                const el = document.activeElement;
                if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
                if (document.body.classList.contains("modal-open")) return;
                e.preventDefault();
                peekOn();
            });
            document.addEventListener("keyup", (e) => {
                if (e.key === "v" || e.key === "V") peekOff();
            });
        }
        return;  // redan parad - ingen sökmodal behövs
    }

    const pairBtn = document.getElementById("pair-btn");
    if (!pairBtn) return;
    const modal = bootstrap.Modal.getOrCreateInstance("#pair-modal");
    const search = document.getElementById("pair-search");
    const showMatched = document.getElementById("pair-show-matched");
    const allTypes = document.getElementById("pair-all-types");
    const list = document.getElementById("pair-candidates");
    const conflictsBox = document.getElementById("pair-conflicts");

    const loadingEl = document.getElementById("pair-loading");
    const sourceImg = document.getElementById("pair-source-img");
    const sourceLabel = document.getElementById("pair-source-label");
    const ownSrc = sourceImg ? sourceImg.dataset.own : null;
    const ownLabel = sourceLabel ? sourceLabel.textContent.trim() : "";
    const LIMIT = 60;
    let offset = 0, loading = false, done = false;
    let conflictPeekOn = null, conflictPeekOff = null;  // sätts i konfliktvyn (håll för att jämföra)
    let conflictPeeking = false;

    function resetSourceImg() {
        if (sourceImg && ownSrc) { sourceImg.src = ownSrc; sourceLabel.textContent = ownLabel; }
        conflictPeekOn = conflictPeekOff = null;
        conflictPeeking = false;
    }

    function openPairModal() {
        conflictsBox.hidden = true;
        list.hidden = false;
        resetSourceImg();
        modal.show();
        resetAndLoad();
    }
    pairBtn.addEventListener("click", openPairModal);
    window.openPairModal = openPairModal;  // för kortkommando M

    function makeCandidateCard(c) {
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
        card.addEventListener("click", () => attemptPair(c));
        return card;
    }

    async function loadMore() {
        if (loading || done) return;
        loading = true;
        loadingEl.hidden = false;
        const params = new URLSearchParams({
            q: search.value.trim(),
            show_matched: showMatched.checked ? "true" : "false",
            all_types: allTypes.checked ? "true" : "false",
            offset: offset, limit: LIMIT,
        });
        try {
            const cands = await apiFetch(`/api/photos/${photoId}/pair-candidates?${params}`);
            if (offset === 0 && !cands.length) {
                list.innerHTML = `<div class="text-secondary p-3">Inga matchande foton</div>`;
                done = true;
                return;
            }
            cands.forEach(c => list.appendChild(makeCandidateCard(c)));
            offset += cands.length;
            if (cands.length < LIMIT) done = true;
        } catch (e) {
            if (offset === 0) list.innerHTML = `<div class="text-secondary p-3">Kunde inte hämta kandidater</div>`;
        } finally {
            loading = false;
            loadingEl.hidden = true;
        }
    }

    function resetAndLoad() {
        offset = 0; done = false; list.innerHTML = "";
        conflictsBox.hidden = true;
        list.hidden = false;
        resetSourceImg();
        loadMore();
    }

    list.addEventListener("scroll", () => {
        if (list.scrollTop + list.clientHeight >= list.scrollHeight - 250) loadMore();
    });

    async function attemptPair(cand, resolutions) {
        try {
            const res = await apiFetch(`/api/photos/${photoId}/pair`, {
                method: "POST",
                body: { other_id: cand.id, resolutions: resolutions || {} },
            });
            if (res.needs_resolution) {
                renderConflicts(cand, res.conflicts);
                return;
            }
            showToast("Hopparade och sammanslagen metadata");
            setTimeout(() => location.reload(), 600);
        } catch (err) {
            showToast("Kunde inte para ihop: " + err.message, true);
        }
    }

    function renderConflicts(cand, conflicts) {
        list.hidden = true;
        conflictsBox.hidden = false;

        // Håll för att visa det valda fotot i vänsterkolumnen (släpp = utgång).
        const candSrc = `/image/${cand.id}?t=${Date.now()}`;
        new Image().src = candSrc;
        conflictPeekOn = () => {
            if (conflictPeeking) return;
            conflictPeeking = true;
            sourceImg.src = candSrc; sourceLabel.textContent = cand.filename;
        };
        conflictPeekOff = () => {
            if (!conflictPeeking) return;
            conflictPeeking = false;
            sourceImg.src = ownSrc; sourceLabel.textContent = ownLabel;
        };

        conflictsBox.innerHTML =
            `<button type="button" class="btn btn-sm btn-outline-info mb-3" id="pair-peek-btn">` +
            `<i class="bi bi-eye"></i> Håll för att visa valda fotot <kbd class="kbd-hint">V</kbd></button>` +
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
        const peekBtn = document.getElementById("pair-peek-btn");
        peekBtn.addEventListener("mousedown", (e) => { e.preventDefault(); conflictPeekOn(); });
        peekBtn.addEventListener("mouseup", () => conflictPeekOff());
        peekBtn.addEventListener("mouseleave", () => conflictPeekOff());
        peekBtn.addEventListener("touchstart", (e) => { e.preventDefault(); conflictPeekOn(); }, { passive: false });
        peekBtn.addEventListener("touchend", () => conflictPeekOff());

        document.getElementById("pair-confirm").addEventListener("click", () => {
            const resolutions = {};
            conflicts.forEach(c => {
                const sel = conflictsBox.querySelector(`input[name="cf-${c.field}"]:checked`);
                resolutions[c.field] = sel ? sel.value : "a";
            });
            attemptPair(cand, resolutions);
        });
    }

    // Tangent V (håll) visar valda fotot i konfliktvyn.
    document.addEventListener("keydown", (e) => {
        if ((e.key === "v" || e.key === "V") && !conflictsBox.hidden && conflictPeekOn) {
            const el = document.activeElement;
            if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
            e.preventDefault();
            conflictPeekOn();
        }
    });
    document.addEventListener("keyup", (e) => {
        if ((e.key === "v" || e.key === "V") && conflictPeekOff) conflictPeekOff();
    });

    let searchTimer = null;
    search.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(resetAndLoad, 250);
    });
    showMatched.addEventListener("change", resetAndLoad);
    allTypes.addEventListener("change", resetAndLoad);
})();
