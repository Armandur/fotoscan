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

    // Auto-spar (debounce:at) - inget Tillämpa-knapptryck behövs. changeSeq
    // används för att bara byta till skarp fullupplösning om inget nytt hänt
    // medan sparningen pågick.
    let saveTimer = null, changeSeq = 0;
    const status = document.getElementById("adj-status");
    function setStatus(text, isErr = false) {
        if (!status) return;
        status.textContent = text;
        status.classList.toggle("text-danger", isErr);
        status.classList.toggle("text-success", text === "Sparat");
    }

    async function doSave() {
        const gen = changeSeq;
        setStatus("Sparar…");
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
            if (gen === changeSeq) img.src = `/image/${photoId}?t=${Date.now()}`;
            setStatus("Sparat");
        } catch (err) {
            setStatus("Kunde inte spara", true);
            showToast("Kunde inte spara justering: " + err.message, true);
        }
    }
    function scheduleSave() {
        clearTimeout(saveTimer);
        setStatus("Ändrat…");
        saveTimer = setTimeout(doSave, 700);
    }

    // Vid varje ändring: snabb förhandsvisning + debounce:ad sparning.
    function onChange() {
        changeSeq++;
        schedulePreview();
        scheduleSave();
    }

    // Tvåvägs-synk slider <-> nummerfält.
    sliders.forEach(s => {
        const field = s.dataset.adj;
        s.addEventListener("input", () => {
            numFor(field).value = parseFloat(s.value).toFixed(2);
            onChange();
        });
        numFor(field).addEventListener("input", () => {
            const v = parseFloat(numFor(field).value);
            if (!isNaN(v)) { sliderFor(field).value = clampToSlider(field, v); onChange(); }
        });
    });

    // Öppna färgpanelen (collapse) och scrolla in den - för kortkommandona.
    const panel = document.getElementById("adjust-panel");
    function openPanel() {
        bootstrap.Collapse.getOrCreateInstance(panel).show();
        card.scrollIntoView({ block: "nearest" });
    }

    // Auto: hämta föreslagna värden, fyll slidrarna och spara.
    const autoBtn = document.getElementById("adj-auto");
    async function doAuto() {
        autoBtn.disabled = true;
        try {
            const s = await apiFetch(`/api/photos/${photoId}/auto-suggest`);
            Object.entries(s).forEach(([field, v]) => setField(field, v, false));
            onChange();
            showToast("Auto-förslag ifyllt");
        } catch (err) {
            showToast("Auto misslyckades: " + err.message, true);
        } finally {
            autoBtn.disabled = false;
        }
    }

    function doReset() {
        sliders.forEach(s => setField(s.dataset.adj, 1.0, false));
        onChange();
    }

    autoBtn.addEventListener("click", doAuto);
    document.getElementById("adj-reset").addEventListener("click", doReset);

    // Exponera för kortkommandon i photo.js (öppnar panelen vid behov).
    window.adjToggle = () => bootstrap.Collapse.getOrCreateInstance(panel).toggle();
    window.adjAuto = () => { openPanel(); doAuto(); };
    window.adjReset = () => { openPanel(); doReset(); };
})();
