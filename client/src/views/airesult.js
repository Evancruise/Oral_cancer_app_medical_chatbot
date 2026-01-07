const jobId = new URLSearchParams(window.location.search).get("job_id");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

async function loadResult() {
  const res = await fetch(`/api/result/${jobId}`);
  const data = await res.json();

  if (data.status !== "DONE") {
    ctx.font = "20px sans-serif";
    ctx.fillText("AI 分析中，請稍候…", 20, 40);
    setTimeout(loadResult, 3000);
    return;
  }

  // ---- load overlay image ----
  const img = new Image();
  img.src = data.overlay_png; // backend 可回 signed URL

  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
  };
}

loadResult();
