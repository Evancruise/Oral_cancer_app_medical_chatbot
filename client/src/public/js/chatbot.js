import { loadModal, showModal } from "./modal.js";

loadModal("modal-container");

document.addEventListener("DOMContentLoaded", () => {
  const fab = document.getElementById("chatbot-fab");
  const chatBox = document.getElementById("chatbot-box");
  const closeBtn = document.getElementById("chatbot-close");
  const sendBtn = document.getElementById("chatbot-send");
  const input = document.getElementById("chatbot-input");
  const chatBody = document.getElementById("chatbot-body");

  // 打開/關閉聊天框
  fab.addEventListener("click", () => {
    console.log("chatbot-fab triggerred!");
    chatBox.classList.toggle("hidden");
  });
  closeBtn.addEventListener("click", () => {
    chatBox.classList.add("hidden");
  });

  // Enter 送出
  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendBtn.click();
    }
  });

  // 送出訊息
  sendBtn.addEventListener("click", async () => {
    const text = input.value.trim();
    if (!text) {return;}

    // 顯示使用者訊息
    const userMsg = document.createElement("div");
    userMsg.classList.add("user-msg");
    userMsg.textContent = text;
    chatBody.appendChild(userMsg);
    input.value = "";
    chatBody.scrollTop = chatBody.scrollHeight;

    // 呼叫 Node.js 或 Flask API
    try {
      const res = await fetch("/api/auth/chatbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text })
      });
      const data = await res.json();

      const botMsg = document.createElement("div");
      botMsg.classList.add("bot-msg");
      botMsg.textContent = data.reply || "抱歉，目前無法回覆。";
      chatBody.appendChild(botMsg);
      chatBody.scrollTop = chatBody.scrollHeight;
    } catch (err) {
      const botMsg = document.createElement("div");
      botMsg.classList.add("bot-msg");
      botMsg.textContent = "⚠️ 無法連線到伺服器。";
      chatBody.appendChild(botMsg);
    }
  });
});