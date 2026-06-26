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

    // ---- Auto-vitbalans (grey-world) ----
    const autoWbBtn = document.getElementById("adj-autowb");
    if (autoWbBtn) autoWbBtn.addEventListener("click", async () => {
        autoWbBtn.disabled = true;
        try {
            const s = await apiFetch(`/api/photos/${photoId}/auto-wb`);
            Object.entries(s).forEach(([f, v]) => setField(f, v, false));
            onChange();
            showToast("Auto-vitbalans ifylld");
        } catch (err) { showToast("Auto-VB misslyckades: " + err.message, true); }
        finally { autoWbBtn.disabled = false; }
    });

    // ---- Vitbalans-pipett: klicka på neutralt grått/vitt i bilden ----
    const pipetteBtn = document.getElementById("adj-pipette");
    let sampling = false;
    function setSampling(on) {
        sampling = on;
        img.style.cursor = on ? "crosshair" : "";
        if (pipetteBtn) pipetteBtn.classList.toggle("active", on);
    }
    if (pipetteBtn) pipetteBtn.addEventListener("click", () => setSampling(!sampling));
    img.addEventListener("click", async (e) => {
        if (!sampling) return;
        e.preventDefault(); e.stopPropagation();
        const r = img.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
        setSampling(false);
        try {
            const s = await apiFetch(`/api/photos/${photoId}/white-balance?x=${x.toFixed(4)}&y=${y.toFixed(4)}`);
            Object.entries(s).forEach(([f, v]) => setField(f, v, false));
            onChange();
            showToast("Vitbalans satt från punkt");
        } catch (err) { showToast("Pipett misslyckades: " + err.message, true); }
    }, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sampling) setSampling(false); });

    // ---- Histogram: ritas live från den visade bilden (preview/fullbild) ----
    const histCanvas = document.getElementById("adj-histogram");
    const histScratch = document.createElement("canvas");
    function drawHistogram() {
        if (!histCanvas || !img.naturalWidth) return;
        const SW = 256, SH = Math.max(1, Math.round(256 * img.naturalHeight / img.naturalWidth));
        histScratch.width = SW; histScratch.height = SH;
        const sctx = histScratch.getContext("2d");
        let data;
        try {
            sctx.drawImage(img, 0, 0, SW, SH);
            data = sctx.getImageData(0, 0, SW, SH).data;
        } catch (e) { return; }  // ev. tainted -> hoppa över
        const R = new Float32Array(256), G = new Float32Array(256), B = new Float32Array(256);
        for (let i = 0; i < data.length; i += 4) { R[data[i]]++; G[data[i + 1]]++; B[data[i + 2]]++; }
        let mx = 1;
        for (let i = 0; i < 256; i++) mx = Math.max(mx, R[i], G[i], B[i]);
        const w = histCanvas.width = histCanvas.clientWidth || 256;
        const h = histCanvas.height;
        const ctx = histCanvas.getContext("2d");
        ctx.clearRect(0, 0, w, h);
        ctx.globalCompositeOperation = "lighter";
        const chans = [[R, "rgba(255,80,80,.8)"], [G, "rgba(80,255,80,.7)"], [B, "rgba(90,140,255,.8)"]];
        for (const [arr, color] of chans) {
            ctx.fillStyle = color;
            for (let i = 0; i < 256; i++) {
                const bh = (arr[i] / mx) * h;
                ctx.fillRect((i / 256) * w, h - bh, w / 256 + 1, bh);
            }
        }
        ctx.globalCompositeOperation = "source-over";
    }
    img.addEventListener("load", drawHistogram);
    if (img.complete) drawHistogram();

    // Exponera för kortkommandon i photo.js (öppnar panelen vid behov).
    window.adjToggle = () => bootstrap.Collapse.getOrCreateInstance(panel).toggle();
    window.adjAuto = () => { openPanel(); doAuto(); };
    window.adjReset = () => { openPanel(); doReset(); };
})();
