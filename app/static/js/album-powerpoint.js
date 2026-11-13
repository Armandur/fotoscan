(() => {
    const form = document.getElementById("pptx-form");
    if (!form) return;
    const button = document.getElementById("pptx-submit");
    const status = document.getElementById("pptx-status");
    const download = document.getElementById("pptx-download");
    const metadata = document.getElementById("pptx-metadata");
    const fields = document.getElementById("pptx-fields");
    const controls = [...form.querySelectorAll("select, input")];
    metadata.addEventListener("change", () => { fields.disabled = metadata.value === "none"; });
    form.addEventListener("change", () => {
        download.hidden = true;
        status.textContent = "";
    });
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (button.disabled) return;
        const body = new FormData(form);
        button.disabled = true;
        controls.forEach(control => { control.disabled = true; });
        download.hidden = true;
        status.textContent = "Skapar PowerPoint… Du kan fortsätta när filen är klar. Stanna på sidan under tiden.";
        try {
            const response = await fetch(form.action, { method: "POST", body });
            const result = await response.json();
            if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "Kontrollera exportvalen och försök igen.");
            download.href = result.download_url;
            download.hidden = false;
            const size = (result.size_bytes / 1024 / 1024).toLocaleString("sv-SE", { maximumFractionDigits: 1 });
            status.textContent = `Klart: ${result.slides} sidor, ${size} MB. Länken fungerar i en timme.`;
            if (result.overflow_count) status.textContent += ` ${result.overflow_count} sidor har längre text i talaranteckningarna.`;
            download.focus();
        } catch (error) {
            status.textContent = "Kunde inte skapa presentationen: " + error.message;
        } finally {
            button.disabled = false;
            controls.forEach(control => { control.disabled = false; });
            fields.disabled = metadata.value === "none";
        }
    });
})();
