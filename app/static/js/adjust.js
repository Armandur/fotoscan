(() => {
    const card = document.getElementById("adjust-card");
    if (!card) return;
    const detail = document.querySelector(".detail");
    const photoId = detail.dataset.id;
    const img = document.getElementById("main-img");
    const sliders = [...card.querySelectorAll(".adj-slider")];
    const autoBtn = document.getElementById("adj-auto");
    const autoState = document.getElementById("adj-auto-state");

    let autoTone = card.dataset.auto === "1";
    let previewing = false;

    const val = (field) => parseFloat(
        card.querySelector(`.adj-slider[data-adj="${field}"]`).value
    );

    function refreshAutoLabel() {
        autoState.textContent = autoTone ? "Auto-ton: på" : "";
        autoBtn.classList.toggle("active", autoTone);
        autoBtn.classList.toggle("btn-info", autoTone);
        autoBtn.classList.toggle("btn-outline-info", !autoTone);
    }
    refreshAutoLabel();

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

    sliders.forEach(s => {
        const out = card.querySelector(`.adj-val[data-for="${s.dataset.adj}"]`);
        s.addEventListener("input", () => {
            out.textContent = parseFloat(s.value).toFixed(2);
            startPreview();
            updatePreview();
        });
    });

    autoBtn.addEventListener("click", () => {
        autoTone = !autoTone;
        refreshAutoLabel();
    });

    function resetSliders() {
        sliders.forEach(s => {
            s.value = 1.0;
            card.querySelector(`.adj-val[data-for="${s.dataset.adj}"]`).textContent = "1.00";
        });
        autoTone = false;
        refreshAutoLabel();
    }
    document.getElementById("adj-reset").addEventListener("click", () => {
        resetSliders();
        startPreview();
        updatePreview();
    });

    document.getElementById("adj-apply").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
            await apiFetch(`/api/photos/${photoId}/adjust`, {
                method: "POST",
                body: {
                    auto_tone: autoTone,
                    adj_brightness: val("adj_brightness"),
                    adj_contrast: val("adj_contrast"),
                    adj_gamma: val("adj_gamma"),
                    adj_saturation: val("adj_saturation"),
                    adj_red: val("adj_red"),
                    adj_green: val("adj_green"),
                    adj_blue: val("adj_blue"),
                },
            });
            // Visa den äkta server-renderade bilden (inkl. gamma/per-kanal).
            previewing = false;
            img.style.filter = "";
            img.src = `/image/${photoId}?t=${Date.now()}`;
            showToast("Justeringar tillämpade");
        } catch (err) {
            showToast("Kunde inte spara: " + err.message, true);
        } finally {
            btn.disabled = false;
        }
    });
})();
