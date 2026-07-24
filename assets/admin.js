"use strict";

document.addEventListener("click", async (event) => {
  const button = event.target.closest(".copy-link");
  if (!button) return;

  const feedback = document.querySelector("#copy-feedback");
  button.disabled = true;

  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard API unavailable");
    }

    await navigator.clipboard.writeText(button.dataset.link);
    feedback.textContent = `已复制 “${button.dataset.name}” 的公开链接`;
  } catch {
    feedback.textContent = "复制失败，请手动选择并复制公开链接";
  } finally {
    button.disabled = false;
  }
});
