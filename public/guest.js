// ── Weather strip ──────────────────────────────────────────────

const WEATHER_URL =
  "https://api.open-meteo.com/v1/forecast" +
  "?latitude=41.39&longitude=2.17" +
  "&daily=temperature_2m_max,precipitation_probability_max" +
  "&timezone=Europe%2FMadrid&forecast_days=7";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function loadWeather() {
  const container = document.getElementById("weather-container");

  try {
    const res = await fetch(WEATHER_URL);
    if (!res.ok) throw new Error("Weather fetch failed");
    const data = await res.json();

    const { time, temperature_2m_max, precipitation_probability_max } = data.daily;

    const strip = document.createElement("div");
    strip.className = "weather-strip";

    time.forEach((dateStr, i) => {
      const date = new Date(dateStr + "T00:00:00"); // local midnight
      const isToday = i === 0;
      const dayName = isToday ? "Today" : DAY_NAMES[date.getDay()];
      const temp = Math.round(temperature_2m_max[i]);
      const rain = precipitation_probability_max[i] ?? 0;

      const card = document.createElement("div");
      card.className = "weather-day" + (isToday ? " today" : "");
      card.innerHTML =
        `<div class="day-label">${dayName}</div>` +
        `<div class="temp">${temp}&deg;C</div>` +
        `<div class="rain">${rain}% rain</div>`;

      strip.appendChild(card);
    });

    container.innerHTML = "";
    container.appendChild(strip);
  } catch {
    container.innerHTML = '<p class="weather-error">Weather forecast unavailable.</p>';
  }
}

loadWeather();

// ── Contact form ────────────────────────────────────────────────

const form    = document.getElementById("contact-form");
const sendBtn = document.getElementById("send-btn");
const replyArea = document.getElementById("reply-area");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name    = document.getElementById("name").value.trim();
  const email   = document.getElementById("email").value.trim();
  const message = document.getElementById("message").value.trim();

  if (!name || !email || !message) {
    showReply("Please fill in all three fields before sending.", true);
    return;
  }

  sendBtn.disabled = true;
  sendBtn.textContent = "Sending...";
  replyArea.className = "";

  try {
    const res = await fetch("/api/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, message }),
    });

    const data = await res.json();

    if (!res.ok) {
      showReply(data.error || "Something went wrong. Please try again.", true);
    } else {
      showReply(data.reply, false);
    }
  } catch {
    showReply("Could not reach the server. Please check your connection.", true);
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = "Send";
  }
});

function showReply(text, isError) {
  replyArea.textContent = text;
  replyArea.className = "visible" + (isError ? " error" : "");
}
