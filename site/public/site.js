for (const btn of document.querySelectorAll("[data-copy]")) {
  btn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(document.getElementById(btn.dataset.copy).textContent.trim());
    const label = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = label), 1600);
  });
}
