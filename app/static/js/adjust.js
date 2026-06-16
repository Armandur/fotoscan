(() => {
    const card = document.getElementById("adjust-card");
    if (!card) return;
    const detail = document.querySelector(".detail");
    const photoId = detail.dataset.id;
    const img = document.getElementById("main-img");
    const sliders = [...card.querySelectorAll(".adj-slider")];
    let previewing = false;

    const sliderFor = (field) => card.querySelector(`.adj-slider[data-adj="${field}"]`);
    const numFor = (field) => card.querySelector(`.adj-num[data-for="${field}"]`);
    const val = (field) => parseFloat(sliderFor(field).value) || 1.0;

    function clampToSlider(field, v) {
        const s = sliderFor(field);
        return Math.max(parseFloat(s.min), Math.min(parseFloat(s.max), v));
    }
    function setField(field, v, preview = true) {
        const c = clampToSlider(field, v);
        sliderFor(field).value = c;
        numFor(field).value = c.toFixed(2);
        if (preview) { startPreview(); updatePreview(); }
    }

    // Live-preview via CSS-filter på en rå (ojusterad) bild. Gamma och
    // per-kanal kan inte previewas i CSS - de syns efter "Tillämpa".
    function startPreview() {
        if (previewing) return;
        previewing = true;
        img.src = `/image/${photoId}?raw=1&t=${Date.now()}`;
    }
    function updatePreview() {
        img.style.filter =
            `brightness(${val("adj_brightness")}) ` +
            `contrast(${val("adj_contrast")}) ` +
            `saturate(${val("adj_saturation")})`;
    }

    // Tvåvägs-synk slider <-> nummerfält.
    sliders.forEach(s => {
        const field = s.dataset.adj;
        s.addEventListener("input", () => {
            numFor(field).value = parseFloat(s.value).toFixed(2);
            startPreview(); updatePreview();
        });
        numFor(field).addEventListener("input", () => {
            const v = parseFloat(numFor(field).value);
            if (!isNaN(v)) { sliderFor(field).value = clampToSlider(field, v); startPreview(); updatePreview(); }
        });
    });

    // Auto: hämta föreslagna värden och fyll slidrarna (användaren kan finjustera).
    document.getElementById("adj-auto").addEventListener("click", async (e) => {
        e.target.disabled = true;
        try {
            const s = await apiFetch(`/api/photos/${photoId}/auto-suggest`);
            Object.entries(s).forEach(([field, v]) => setField(field, v, false));
            startPreview(); updatePreview();
            showToast("Auto-förslag ifyllt - justera och klicka Tillämpa");
        } catch (err) {
            showToast("Auto misslyckades: " + err.message, true);
        } finally {
            e.target.disabled = false;
        }
    });

    document.getElementById("adj-reset").addEventListener("click", () => {
        sliders.forEach(s => setField(s.dataset.adj, 1.0, false));
        startPreview(); updatePreview();
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
            previewing = false;
            img.style.filter = "";
            img.src = `/image/${photoId}?t=${Date.now()}`;
            showToast("Justeringar tillämpade");
        } catch (err) {
            showToast("Kunde inte spara: " + err.message, true);
        } finally {
            e.target.disabled = false;
        }
    });
})();
