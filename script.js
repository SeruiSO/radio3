const audio = document.getElementById("audioPlayer");
const stationList = document.getElementById("stationList");
const playPauseBtn = document.querySelector(".controls .control-btn:nth-child(2)");
const currentStationInfo = document.getElementById("currentStationInfo");
let currentIndex = parseInt(localStorage.getItem("lastStation")) || 0;
let favoriteStations = JSON.parse(localStorage.getItem("favoriteStations")) || [];
let currentTab = localStorage.getItem("currentTab") || "techno";
let isPlaying = localStorage.getItem("isPlaying") === "true";
let stationLists = {};
let stationItems;

const themes = {
  dark: { bodyBg: "#121212", containerBg: "#1e1e1e", accent: "#00C4FF", text: "#fff" },
  light: { bodyBg: "#f0f0f0", containerBg: "#fff", accent: "#007BFF", text: "#000" },
  neon: { bodyBg: "#0a0a1a", containerBg: "#1a1a2e", accent: "#00ffcc", text: "#fff" },
  "light-alt": { bodyBg: "#f5f5e6", containerBg: "#fff5e1", accent: "#1e90ff", text: "#333" },
  "dark-alt": { bodyBg: "#1a1a2a", containerBg: "#2e2e3e", accent: "#00ff00", text: "#e0e0e0" }
};
let currentTheme = localStorage.getItem("selectedTheme") || "dark";

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((registration) => {
    setInterval(() => {
      registration.update();
    }, 30 * 60 * 1000);
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          if (confirm('Доступна нова версія радіо. Оновити?')) {
            window.location.reload();
          }
        }
      });
    });
  });
}

function applyTheme(theme) {
  const themeData = themes[theme];
  document.documentElement.style.setProperty('--accent-color', themeData.accent);
  document.documentElement.style.setProperty('--text-color', themeData.text);
  document.documentElement.style.setProperty('--shadow-color', `${themeData.accent}80`);
  document.body.style.background = themeData.bodyBg;
  document.querySelector(".container").style.background = themeData.containerBg;
  document.querySelector("h1").style.color = themeData.accent;
  document.querySelectorAll(".station-list, .control-btn, .theme-toggle, .current-station-info, .tab-btn").forEach(el => {
    el.style.background = themeData.containerBg;
    el.style.borderColor = themeData.accent;
    el.style.color = themeData.text;
  });
  document.querySelectorAll(".station-item").forEach(el => {
    el.style.background = themeData.containerBg;
    el.style.borderColor = themeData.text;
    el.style.color = themeData.text;
  });
  document.querySelector(".controls-container").style.background = themeData.containerBg;
  document.querySelector(".controls-container").style.borderColor = themeData.accent;
  currentTheme = theme;
  localStorage.setItem("selectedTheme", theme);
}

function toggleTheme() {
  const themesOrder = ["dark", "light", "neon", "light-alt", "dark-alt"];
  const nextTheme = themesOrder[(themesOrder.indexOf(currentTheme) + 1) % 5];
  applyTheme(nextTheme);
  updateStationList(); // Re-apply styles to station items
}

function switchTab(tab) {
  if (!["techno", "trance", "ukraine"].includes(tab)) tab = "techno";
  currentTab = tab;
  localStorage.setItem("currentTab", tab);
  currentIndex = 0;
  updateStationList();
  document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
  document.querySelector(`.tab-btn[onclick="switchTab('${tab}')"]`).classList.add("active");
  changeStation(currentIndex);
}

function updateStationList() {
  const stations = stationLists[currentTab] || [];
  if (stations.length === 0) {
    stationList.innerHTML = '<div>Немає доступних станцій</div>';
    updateCurrentStationInfo(null);
    return;
  }
  const favoriteList = favoriteStations
    .map(name => stations.find(station => station.name === name))
    .filter(station => station);
  const nonFavoriteList = stations.filter(station => !favoriteStations.includes(station.name));
  const sortedStations = [...favoriteList, ...nonFavoriteList];
  let html = '';
  sortedStations.forEach((station, index) => {
    html += `<div class="station-item ${index === currentIndex ? 'selected' : ''}" data-value="${station.value}" data-name="${station.name}" data-genre="${station.genre}" data-country="${station.country}" tabindex="0">
      ${station.emoji} ${station.name}<button class="favorite-btn${favoriteStations.includes(station.name) ? ' favorited' : ''}" aria-label="Додати або видалити з улюблених">★</button>
    </div>`;
  });
  stationList.innerHTML = html;
  stationItems = stationList.querySelectorAll(".station-item");
  stationItems.forEach((item, index) => {
    item.addEventListener("click", () => changeStation(index));
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter") changeStation(index);
    });
    item.querySelector(".favorite-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite(item.dataset.name);
    });
  });
  if (stationItems[currentIndex]) {
    updateCurrentStationInfo(stationItems[currentIndex]);
  }
}

function toggleFavorite(stationName) {
  if (favoriteStations.includes(stationName)) {
    favoriteStations = favoriteStations.filter(name => name !== stationName);
  } else {
    favoriteStations.unshift(stationName);
  }
  localStorage.setItem("favoriteStations", JSON.stringify(favoriteStations));
  updateStationList();
}

function changeStation(index) {
  if (!stationItems[index]) return;
  stationItems.forEach(item => item.classList.remove("selected"));
  stationItems[index].classList.add("selected");
  currentIndex = index;
  audio.src = stationItems[index].dataset.value;
  updateCurrentStationInfo(stationItems[index]);
  if (audio.paused) {
    document.querySelectorAll(".wave-bar").forEach(bar => bar.style.animationPlayState = "paused");
  } else {
    document.querySelectorAll(".wave-bar").forEach(bar => bar.style.animationPlayState = "running");
  }
  if (isPlaying && navigator.onLine) {
    audio.play().catch(error => {
      console.error("Помилка відтворення:", error);
      showManualPlayPrompt();
    });
  }
  localStorage.setItem("lastStation", index);
}

function updateCurrentStationInfo(item) {
  if (!item) {
    currentStationInfo.querySelector(".station-name").textContent = "Виберіть станцію";
    currentStationInfo.querySelector(".station-genre").textContent = "";
    currentStationInfo.querySelector(".station-country").textContent = "";
    return;
  }
  currentStationInfo.querySelector(".station-name").textContent = item.dataset.name;
  currentStationInfo.querySelector(".station-genre").textContent = `жанр: ${item.dataset.genre}`;
  currentStationInfo.querySelector(".station-country").textContent = `країна: ${item.dataset.country}`;
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.dataset.name,
      artist: `${item.dataset.genre} | ${item.dataset.country}`,
      album: 'Радіо Музика'
    });
  }
}

function prevStation() {
  currentIndex = (currentIndex > 0) ? currentIndex - 1 : stationItems.length - 1;
  changeStation(currentIndex);
}

function nextStation() {
  currentIndex = (currentIndex < stationItems.length - 1) ? currentIndex + 1 : 0;
  changeStation(currentIndex);
}

function togglePlayPause() {
  if (audio.paused) {
    audio.play().catch(error => {
      console.error("Помилка відтворення:", error);
      showManualPlayPrompt();
    });
    playPauseBtn.textContent = "⏸";
    document.querySelectorAll(".wave-bar").forEach(bar => bar.style.animationPlayState = "running");
    isPlaying = true;
  } else {
    audio.pause();
    playPauseBtn.textContent = "▶";
    document.querySelectorAll(".wave-bar").forEach(bar => bar.style.animationPlayState = "paused");
    isPlaying = false;
  }
  localStorage.setItem("isPlaying", isPlaying);
}

function showManualPlayPrompt() {
  if (!navigator.onLine) {
    currentStationInfo.classList.add("offline");
    currentStationInfo.querySelector(".station-name").textContent = "Немає мережі";
    setTimeout(() => {
      currentStationInfo.classList.remove("offline");
      updateCurrentStationInfo(stationItems[currentIndex]);
    }, 3000);
  } else {
    alert("Автовідтворення заблоковано. Натисніть кнопку відтворення.");
  }
}

function handleBluetoothConnection() {
  if (navigator.bluetooth) {
    navigator.bluetooth.getAvailability().then(available => {
      if (available && !audio.paused) {
        audio.play().catch(error => console.error("Помилка відтворення через Bluetooth:", error));
      }
    });
  }
}

function retryPlayback() {
  if (!navigator.onLine) return;
  audio.play().catch(() => {
    setTimeout(retryPlayback, 5000);
  });
}

let touchStartX = 0;
let touchEndX = 0;
stationList.addEventListener("touchstart", (e) => {
  touchStartX = e.changedTouches[0].screenX;
});
stationList.addEventListener("touchend", (e) => {
  touchEndX = e.changedTouches[0].screenX;
  if (touchStartX - touchEndX > 50) nextStation();
  if (touchEndX - touchStartX > 50) prevStation();
});

let volumeStartY = 0;
let volumeEndY = 0;
audio.addEventListener("touchstart", (e) => {
  volumeStartY = e.changedTouches[0].screenY;
});
audio.addEventListener("touchmove", (e) => {
  volumeEndY = e.changedTouches[0].screenY;
  const deltaY = volumeStartY - volumeEndY;
  let newVolume = audio.volume + (deltaY / 500);
  newVolume = Math.max(0, Math.min(1, newVolume));
  audio.volume = newVolume;
  volumeStartY = volumeEndY;
});

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") prevStation();
  if (e.key === "ArrowRight") nextStation();
  if (e.key === " ") {
    e.preventDefault();
    togglePlayPause();
  }
});

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler("previoustrack", () => prevStation());
  navigator.mediaSession.setActionHandler("nexttrack", () => nextStation());
  navigator.mediaSession.setActionHandler("play", () => togglePlayPause());
  navigator.mediaSession.setActionHandler("pause", () => togglePlayPause());
  navigator.mediaSession.setActionHandler("seekforward", () => nextStation());
  navigator.mediaSession.setActionHandler("seekbackward", () => prevStation());
}

window.addEventListener("online", () => {
  currentStationInfo.classList.remove("offline");
  if (isPlaying) retryPlayback();
});
window.addEventListener("offline", () => {
  currentStationInfo.classList.add("offline");
  currentStationInfo.querySelector(".station-name").textContent = "Немає мережі";
});

if (navigator.bluetooth) {
  navigator.bluetooth.addEventListener('availabilitychanged', () => {
    handleBluetoothConnection();
  });
}

applyTheme(currentTheme);
window.addEventListener("blur", () => {
  if (document.hidden) localStorage.setItem("lastStation", currentIndex);
});
window.addEventListener("visibilitychange", () => {
  if (!document.hidden) handleBluetoothConnection();
});

audio.addEventListener("playing", () => {
  playPauseBtn.textContent = "⏸";
  document.querySelectorAll(".wave-bar").forEach(bar => bar.style.animationPlayState = "running");
  isPlaying = true;
  localStorage.setItem("isPlaying", isPlaying);
});
audio.addEventListener("pause", () => {
  playPauseBtn.textContent = "▶";
  document.querySelectorAll(".wave-bar").forEach(bar => bar.style.animationPlayState = "paused");
  isPlaying = false;
  localStorage.setItem("isPlaying", isPlaying);
});
audio.addEventListener("error", () => {
  console.error("Помилка трансляції");
  setTimeout(retryPlayback, 5000);
});
audio.volume = 0.5;

fetch('stations.json')
  .then(response => response.json())
  .then(data => {
    stationLists = data;
    localStorage.setItem("cachedStations", JSON.stringify(data));
    switchTab(currentTab);
    if (isPlaying && navigator.onLine) {
      audio.play().catch(error => {
        console.error("Помилка автовідтворення:", error);
        showManualPlayPrompt();
      });
    }
  })
  .catch(error => {
    console.error("Помилка завантаження станцій:", error);
    const cachedStations = localStorage.getItem("cachedStations");
    if (cachedStations) {
      stationLists = JSON.parse(cachedStations);
      switchTab(currentTab);
    } else {
      updateCurrentStationInfo(null);
    }
  });

document.addEventListener("DOMContentLoaded", () => {
  applyTheme(currentTheme);
  const cachedStations = localStorage.getItem("cachedStations");
  if (cachedStations) {
    stationLists = JSON.parse(cachedStations);
    switchTab(currentTab);
    if (isPlaying && navigator.onLine) {
      audio.play().catch(error => {
        console.error("Помилка автовідтворення:", error);
        showManualPlayPrompt();
      });
    }
  } else {
    updateCurrentStationInfo(null);
  }
});