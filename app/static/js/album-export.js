(() => {
    const form = document.getElementById("package-form");
    if (!form) return;
    form.addEventListener("submit", async event => {
        event.preventDefault();
        const button = document.getElementById("package-submit");
        if (button.disabled) return;
        const status = document.getElementById("package-status");
        button.disabled = true;
        status.textContent = "Skapar paketet. Vänta tills nedladdningen börjar.";
        try {
            const response = await fetch(form.action, { method: "POST", body: new FormData(form) });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(typeof error.detail === "string" ? error.detail : "Kunde inte skapa paketet");
            }
            const url = URL.createObjectURL(await response.blob());
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "bilder-och-bildlista.zip";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            status.textContent = "Klart. ZIP-filen är redo i webbläsarens nedladdningar.";
        } catch (error) {
            status.textContent = error.message;
        } finally { button.disabled = false; }
    });
})();
