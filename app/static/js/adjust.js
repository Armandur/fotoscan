(() => {
    const card = document.getElementById("adjust-card");
    if (!card) return;
    const detail = document.querySelector(".detail");
    const photoId = detail.dataset.id;
    const img = document.getElementById("main-img");
    const sliders = [...card.querySelectorAll(".adj-slider")];

    const sliderFor = (field) => card.querySelector(`.adj-slider[data-adj="${field}"]`);
    const numFor = (field) => card.querySelector(`.adj-num[data-for="${field}"]`);
    const val = (field) => parseFloat(sliderFor(field).value) || 1.0;
    const FIELDS = sliders.map(s => s.dataset.adj);

    function clampToSlider(field, v) {
        const s = sliderFor(field);
        return Math.max(parseFloat(s.min), Math.min(parseFloat(s.max), v));
    }

    // Live-preview: nedskalad server-rendering med aktuella värden (debounce:ad),
    // så alla reglage syns korrekt - även gamma och per-kanal (CSS klarar dem ej).
    let previewTimer = null;
    function schedulePreview() {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(() => {
            const p = new URLSearchParams();
            FIELDS.forEach(f => p.set(f, val(f)));
            img.src = `/api/photos/${photoId}/preview?${p}`;
        }, 200);
    }

    function setField(field, v, preview = true) {
        const c = clampToSlider(field, v);
        sliderFor(field).value = c;
        numFor(field).value = c.toFixed(2);
        if (preview) schedulePreview();
    }

    // Tvåvägs-synk slider <-> nummerfält.
    sliders.forEach(s => {
        const field = s.dataset.adj;
        s.addEventListener("input", () => {
            numFor(field).value = parseFloat(s.value).toFixed(2);
            schedulePreview();
        });
        numFor(field).addEventListener("input", () => {
            const v = parseFloat(numFor(field).value);
            if (!isNaN(v)) { sliderFor(field).value = clampToSlider(field, v); schedulePreview(); }
        });
    });

    // Auto: hämta föreslagna värden och fyll slidrarna (användaren kan finjustera).
    document.getElementById("adj-auto").addEventListener("click", async (e) => {
        e.target.disabled = true;
        try {
            const s = await apiFetch(`/api/photos/${photoId}/auto-suggest`);
            Object.entries(s).forEach(([field, v]) => setField(field, v, false));
            schedulePreview();
            showToast("Auto-förslag ifyllt - justera och klicka Tillämpa");
        } catch (err) {
            showToast("Auto misslyckades: " + err.message, true);
        } finally {
            e.target.disabled = false;
        }
    });

    document.getElementById("adj-reset").addEventListener("click", () => {
        sliders.forEach(s => setField(s.dataset.adj, 1.0, false));
        schedulePreview();
    });

    document.getElementById("adj-apply").addEventListener("click", async (e) => {
        e.target.disabled = true;
        try {
            await apiFetch(`/api/photos/${photoId}/adjust`, {
                method: "POST",
                body: {
                    auto_tone: false,
                    adj_brightness: val("adj_brightness"),
                    adj_contrast: val("adj_contrast"),
                    adj_gamma: val("adj_gamma"),
                    adj_saturation: val("adj_saturation"),
                    adj_red: val("adj_red"),
                    adj_green: val("adj_green"),
                    adj_blue: val("adj_blue"),
                },
            });
            img.src = `/image/${photoId}?t=${Date.now()}`;  // full upplösning
            showToast("Justeringar tillämpade");
        } catch (err) {
            showToast("Kunde inte spara: " + err.message, true);
        } finally {
            e.target.disabled = false;
        }
    });
})();
