document.addEventListener("DOMContentLoaded", () => {
  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightbox-img");
  const zoomableImages = document.querySelectorAll(".zoomable");

  zoomableImages.forEach(img => {
    img.addEventListener("click", () => {
      lightboxImg.src = img.src;
      lightbox.classList.add("show");
    });
  });

  // 點擊背景關閉
  lightbox.addEventListener("click", () => {
    lightbox.classList.remove("show");
  });

  // ESC 鍵關閉
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") lightbox.classList.remove("show");
  });
});