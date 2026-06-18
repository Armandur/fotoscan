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

    // Förhandsvisningen är nedskalad (1200px). Lås den visade storleken till
    // fullbildens, annars krymper bilden i fönstret medan preview visas (den
    // mindre naturliga bilden skalas inte upp av sig själv). Låses upp när den
    // skarpa fullbilden laddats igen.
    function lockSize() {
        if (img.style.width) return;
        img.style.width = img.clientWidth + "px";
        img.style.height = img.clientHeight + "px";
    }
    function unlockSize() {
        img.style.width = "";
        img.style.height = "";
    }

    // Live-preview: nedskalad server-rendering med aktuella värden (debounce:ad),
    // så alla reglage syns korrekt - även gamma och per-kanal (CSS klarar dem ej).
    let previewTimer = null;
    function schedulePreview() {
        lockSize();
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
    let saveTimer = null, changeSeq = 0, dirty = false;
    const status = document.getElementById("adj-status");
    function setStatus(text, isErr = false) {
        if (!status) return;
        status.textContent = text;
        status.classList.toggle("text-danger", isErr);
        status.classList.toggle("text-success", text === "Sparat");
    }

    function payload() {
        return {
            auto_tone: false,
            adj_brightness: val("adj_brightness"), adj_contrast: val("adj_contrast"),
            adj_gamma: val("adj_gamma"), adj_saturation: val("adj_saturation"),
            adj_red: val("adj_red"), adj_green: val("adj_green"), adj_blue: val("adj_blue"),
        };
    }

    async function doSave() {
        const gen = changeSeq;
        setStatus("Sparar…");
        try {
            await apiFetch(`/api/photos/${photoId}/adjust`, {
                method: "POST", body: payload(),
            });
            dirty = false;
            if (gen === changeSeq) {
                img.addEventListener("load", unlockSize, { once: true });
                img.src = `/image/${photoId}?t=${Date.now()}`;  // skarp fullbild
            }
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

    // Byter man bild innan debouncen hunnit spara: flusha den väntande
    // ändringen via sendBeacon (når servern även när sidan lämnas - täcker
    // j/k, prev/next-länkar, Galleri och stängd flik).
    window.addEventListener("pagehide", () => {
        if (!dirty) return;
        clearTimeout(saveTimer);
        const blob = new Blob([JSON.stringify(payload())], { type: "application/json" });
        navigator.sendBeacon(`/api/photos/${photoId}/adjust`, blob);
        dirty = false;
    });

    // Vid varje ändring: snabb förhandsvisning + debounce:ad sparning.
    function onChange() {
        changeSeq++;
        dirty = true;
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

    // Öppna färgpanelen (collapse) - för kortkommandona. Scrollar inte.
    const panel = document.getElementById("adjust-panel");
    function openPanel() {
        bootstrap.Collapse.getOrCreateInstance(panel).show();
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

    // Håll för att se bilden UTAN färgjustering (raw=1 = orienterad/roterad men
    // utan justeringar) - för att jämföra med originalet. Knapp + tangent O.
    const origBtn = document.getElementById("adj-original");
    const rawSrc = `/image/${photoId}?raw=1`;
    new Image().src = rawSrc;  // förladda för direkt växling
    let peekingRaw = false, peekRestore = null;
    function rawOn() {
        if (peekingRaw) return;
        peekingRaw = true;
        peekRestore = img.src;
        img.src = rawSrc;
        if (origBtn) origBtn.classList.add("active");
    }
    function rawOff() {
        if (!peekingRaw) return;
        peekingRaw = false;
        if (peekRestore) img.src = peekRestore;
        if (origBtn) origBtn.classList.remove("active");
    }
    if (origBtn) {
        origBtn.addEventListener("mousedown", (e) => { e.preventDefault(); rawOn(); });
        origBtn.addEventListener("mouseup", rawOff);
        origBtn.addEventListener("mouseleave", rawOff);
        origBtn.addEventListener("touchstart", (e) => { e.preventDefault(); rawOn(); }, { passive: false });
        origBtn.addEventListener("touchend", rawOff);
    }
    document.addEventListener("keydown", (e) => {
        if (e.key !== "o" && e.key !== "O") return;
        const el = document.activeElement;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
        if (document.body.classList.contains("modal-open")) return;
        e.preventDefault();
        rawOn();
    });
    document.addEventListener("keyup", (e) => {
        if (e.key === "o" || e.key === "O") rawOff();
    });

    // Exponera för kortkommandon i photo.js (öppnar panelen vid behov).
    window.adjToggle = () => bootstrap.Collapse.getOrCreateInstance(panel).toggle();
    window.adjAuto = () => { openPanel(); doAuto(); };
    window.adjReset = () => { openPanel(); doReset(); };
})();
