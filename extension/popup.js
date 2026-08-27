const soruInput = document.getElementById("soru");
const cevapDiv = document.getElementById("cevap");
const sorBtn = document.getElementById("sorBtn");
const apiKeyInput = document.getElementById("apiKey");

const MODEL = "inclusionai/ling-3.0-flash-fin:free";
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_PAGE_CHARS = 15000;

document.addEventListener("DOMContentLoaded", async () => {
  const data = await chrome.storage.local.get(["openRouterApiKey"]);
  if (data.openRouterApiKey) {
    apiKeyInput.value = data.openRouterApiKey;
  }
});

apiKeyInput.addEventListener("change", async () => {
  await chrome.storage.local.set({
    openRouterApiKey: apiKeyInput.value.trim()
  });
});

soruInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sorBtn.click();
  }
});

sorBtn.addEventListener("click", askPage);

async function askPage() {
  const soru = soruInput.value.trim();
  const apiKey = apiKeyInput.value.trim();

  cevapDiv.classList.remove("error");

  if (!soru) {
    showError("Lütfen bir soru yaz.");
    soruInput.focus();
    return;
  }

  if (!apiKey) {
    showError("Önce OpenRouter API anahtarını gir.");
    apiKeyInput.focus();
    return;
  }

  await chrome.storage.local.set({ openRouterApiKey: apiKey });

  setLoading(true);
  cevapDiv.textContent = "Sayfa taranıyor...";

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab?.id) {
      throw new Error("Aktif sekme bulunamadı.");
    }

    if (!tab.url || /^(chrome|edge|about|brave|opera):/i.test(tab.url)) {
      throw new Error("Bu tür tarayıcı sistem sayfalarında içerik okunamaz.");
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const text = document.body?.innerText || document.documentElement?.innerText || "";
        return text.replace(/\s+/g, " ").trim();
      }
    });

    const pageText = results?.[0]?.result;

    if (!pageText) {
      throw new Error("Sayfada okunabilir metin bulunamadı.");
    }

    cevapDiv.textContent = "Yapay zekaya soruluyor...";

    await askOpenRouter(pageText.slice(0, MAX_PAGE_CHARS), soru, apiKey);
  } catch (error) {
    showError(error?.message || "Bilinmeyen bir hata oluştu.");
  } finally {
    setLoading(false);
  }
}

async function askOpenRouter(pageText, question, apiKey) {
  const systemPrompt =
    "You are a web page analysis assistant. " +
    "Rely only on the provided page content. " +
    "If the information is not on the page, state that clearly. " +
    "Respond in Turkish, clearly and without unnecessary elaboration.";

  const userPrompt =
    `SAYFA İÇERİĞİ:\n${pageText}\n\n` +
    `KULLANICI SORUSU:\n${question}`;

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "chrome-extension://sayfa-asistani-ai",
      "X-Title": "Sayfa Asistani AI"
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.2
    })
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`OpenRouter geçersiz bir yanıt döndürdü. HTTP ${response.status}`);
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error?.code ||
      `HTTP ${response.status}`;
    throw new Error(`OpenRouter hatası: ${message}`);
  }

  const answer = data?.choices?.[0]?.message?.content;

  if (!answer) {
    throw new Error("API yanıtında kullanılabilir bir cevap bulunamadı.");
  }

  cevapDiv.textContent = answer;
}

function setLoading(loading) {
  sorBtn.disabled = loading;
  sorBtn.textContent = loading ? "Çalışıyor..." : "Yapay Zekaya Sor";
}

function showError(message) {
  cevapDiv.textContent = message;
  cevapDiv.classList.add("error");
}
