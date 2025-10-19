document.addEventListener("DOMContentLoaded", () => {
  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightbox-img");
  const lightboxTitle = document.getElementById("lightbox-title");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const thumbnailStrip = document.getElementById("thumbnail-strip");
  const zoomableImages = document.querySelectorAll(".zoomable");

  let currentIndex = 0;

  // 初始化縮略圖列
  zoomableImages.forEach((img, index) => {
    const thumb = document.createElement("img");
    thumb.src = img.src;
    thumb.alt = img.alt;
    thumb.dataset.index = index;
    thumb.addEventListener("click", () => {
      showImage(index);
    });
    thumbnailStrip.appendChild(thumb);
  });
  const thumbs = thumbnailStrip.querySelectorAll("img");

  // 開啟 Lightbox
  zoomableImages.forEach((img, index) => {
    img.addEventListener("click", () => {
      currentIndex = index;
      showImage(currentIndex);
      lightbox.classList.add("show");
    });
  });

  // 顯示圖片
  function showImage(index) {
    if (index < 0) index = zoomableImages.length - 1;
    if (index >= zoomableImages.length) index = 0;
    currentIndex = index;

    const currentImg = zoomableImages[currentIndex];
    lightboxImg.src = currentImg.src;
    lightboxTitle.textContent = currentImg.alt || `圖片 ${currentIndex + 1}`;

    thumbs.forEach((t, i) => {
      t.classList.toggle("active", i === currentIndex);
    });

    // 自動滾動縮略圖列至當前位置
    const activeThumb = thumbs[currentIndex];
    thumbnailStrip.scrollTo({
      left: activeThumb.offsetLeft - thumbnailStrip.clientWidth / 2 + activeThumb.clientWidth / 2,
      behavior: "smooth"
    });
  }

  // 切換
  prevBtn.addEventListener("click", e => {
    e.stopPropagation();
    showImage(currentIndex - 1);
  });
  nextBtn.addEventListener("click", e => {
    e.stopPropagation();
    showImage(currentIndex + 1);
  });

  // 點擊背景關閉
  lightbox.addEventListener("click", e => {
    if (e.target === lightbox || e.target === lightboxImg) {
      lightbox.classList.remove("show");
    }
  });

  // 鍵盤操作
  document.addEventListener("keydown", e => {
    if (!lightbox.classList.contains("show")) return;
    if (e.key === "ArrowLeft") showImage(currentIndex - 1);
    if (e.key === "ArrowRight") showImage(currentIndex + 1);
    if (e.key === "Escape") lightbox.classList.remove("show");
  });
});