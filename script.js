let currentTab = localStorage.getItem("currentTab") || "techno";
let currentIndex = 0;
let favoriteStations = JSON.parse(localStorage.getItem("favoriteStations")) || [];
let isPlaying = localStorage.getItem("isPlaying") === "true" || false;
let intendedPlaying = localStorage.getItem("intendedPlaying") === "true" || false;
let stationLists = JSON.parse(localStorage.getItem("stationLists")) || {};
let userAddedStations = JSON.parse(localStorage.getItem("userAddedStations")) || {};
let stationItems = [];
let abortController = new AbortController();
let errorCount = 0;
const ERROR_LIMIT = 15;
let pastSearches = JSON.parse(localStorage.getItem("pastSearches")) || [];
let deletedStations = JSON.parse(localStorage.getItem("deletedStations")) || [];
let customTabs = JSON.parse(localStorage.getItem("customTabs")) || [];
let isAutoPlayPending = false;
let lastSuccessfulPlayTime = 0;
let streamAbortController = null;
let errorTimeout = null;
let autoPlayRequestId = 0;
let metadataCheckInterval = null;
let currentTrack = "";
let dragEnabled = false;
let dragStartIndex = null;
let longPressTimer = null;
let pullToRefreshStartY = 0;
let pullToRefreshThreshold = 100;
let isPulling = false;
let viewTransitionSupported = document.startViewTransition ? true : false;
let searchDebounceTimer = null;
let lazyLoadObserver = null;
let metadataReaderController = null;
let metadataRetryTimeout = null;

// Список станцій, які не підтримують метадані
const noMetadataStations = [
  'online.hitfm.ua',
  'online.radiorecord.com.ua',
  'cast.brg.ua',
  'icecast.luxnet.ua'
];

customTabs = Array.isArray(customTabs) ? customTabs.filter(tab => typeof tab === "string" && tab.trim()) : [];

document.addEventListener("DOMContentLoaded", () => {
  const audio = document.getElementById("audioPlayer");
  const stationList = document.getElementById("stationList");
  const playPauseBtn = document.querySelector(".controls .control-btn:nth-child(2)");
  const currentStationInfo = document.getElementById("currentStationInfo");
  const themeToggle = document.querySelector(".theme-toggle");
  const shareButton = document.querySelector(".share-button");
  const exportButton = document.querySelector(".export-button");
  const importButton = document.querySelector(".import-button");
  const importFileInput = document.getElementById("importFileInput");
  const searchInput = document.getElementById("searchInput");
  const searchQuery = document.getElementById("searchQuery");
  const searchCountry = document.getElementById("searchCountry");
  const searchGenre = document.getElementById("searchGenre");
  const searchBtn = document.querySelector(".search-btn");
  const pastSearchesList = document.getElementById("pastSearches");
  const tabsContainer = document.getElementById("tabs");
  const currentTrackElement = document.getElementById("currentTrack");
  const loadingIndicator = document.getElementById("loadingIndicator");
  const toastContainer = document.getElementById("toastContainer");
  const pullIndicator = document.getElementById("pullIndicator");
  const waveVisualizer = document.querySelector('.wave-visualizer');

  if (!audio || !stationList || !playPauseBtn || !currentStationInfo || !themeToggle || !shareButton || !exportButton || !importButton || !importFileInput || !searchInput || !searchQuery || !searchCountry || !searchGenre || !searchBtn || !pastSearchesList || !tabsContainer) {
    console.error("One of required DOM elements not found");
    setTimeout(initializeApp, 100);
    return;
  }

  initializeApp();

  function initializeApp() {
    audio.preload = "auto";
    audio.volume = parseFloat(localStorage.getItem("volume")) || 0.9;

    updatePastSearches();
    populateSearchSuggestions();
    renderTabs();
    setupPullToRefresh();
    setupLazyLoading();
    
    // Завантажуємо станції одразу
    loadStations().then(() => {
      // Після завантаження перемикаємося на поточний таб
      switchTab(currentTab);
    });

    shareButton.addEventListener("click", () => {
      const stationName = currentStationInfo.querySelector(".station-name").textContent || "Radio S O";
      const shareData = {
        title: "Radio S O",
        text: `Слухаю ${stationName} на Radio S O! Приєднуйся до моїх улюблених радіостанцій!`,
        url: window.location.href
      };
      if (navigator.share) {
        navigator.share(shareData)
          .then(() => showToast("Поділилися успішно!", "success"))
          .catch(error => {
            console.error("Error sharing:", error);
            showToast("Помилка поширення", "error");
          });
      } else {
        navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`)
          .then(() => showToast("Посилання скопійовано в буфер обміну!", "success"))
          .catch(() => alert(`Функція поширення не підтримується. Скопіюйте: ${shareData.text} ${shareData.url}`));
      }
    });

    exportButton.addEventListener("click", exportSettings);
    importButton.addEventListener("click", () => importFileInput.click());
    importFileInput.addEventListener("change", importSettings);

    document.querySelector(".controls .control-btn:nth-child(1)").addEventListener("click", () => {
      prevStation();
      provideHapticFeedback();
    });
    document.querySelector(".controls .control-btn:nth-child(2)").addEventListener("click", () => {
      togglePlayPause();
      provideHapticFeedback();
    });
    document.querySelector(".controls .control-btn:nth-child(3)").addEventListener("click", () => {
      nextStation();
      provideHapticFeedback();
    });

    // Debounced search
    searchBtn.addEventListener("click", () => {
      const query = searchQuery.value.trim();
      const country = normalizeCountry(searchCountry.value.trim());
      const genre = searchGenre.value.trim().toLowerCase();
      
      if (query || country || genre) {
        if (query && !pastSearches.includes(query)) {
          pastSearches.unshift(query);
          if (pastSearches.length > 5) pastSearches.pop();
          localStorage.setItem("pastSearches", JSON.stringify(pastSearches));
          updatePastSearches();
        }
        
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          searchStations(query, country, genre);
        }, 300);
      } else {
        stationList.innerHTML = "<div class='station-item empty'>Введіть назву станції, країну або жанр</div>";
      }
    });

    searchQuery.addEventListener("keypress", (e) => {
      if (e.key === "Enter") searchBtn.click();
    });

    searchCountry.addEventListener("keypress", (e) => {
      if (e.key === "Enter") searchBtn.click();
    });

    searchGenre.addEventListener("keypress", (e) => {
      if (e.key === "Enter") searchBtn.click();
    });

    function showToast(message, type = "info", duration = 3000) {
      if (!toastContainer) return;
      
      toastContainer.textContent = message;
      toastContainer.classList.add("show");
      toastContainer.setAttribute("aria-label", message);
      
      if (type === "error") {
        toastContainer.style.backgroundColor = "#ff4444";
      } else if (type === "success") {
        toastContainer.style.backgroundColor = "#00C851";
      } else {
        toastContainer.style.backgroundColor = "var(--toast-bg)";
      }
      
      setTimeout(() => {
        toastContainer.classList.remove("show");
        toastContainer.textContent = "";
      }, duration);
    }

    function provideHapticFeedback() {
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }

    function setupPullToRefresh() {
      let touchStartY = 0;
      
      stationList.addEventListener("touchstart", (e) => {
        if (stationList.scrollTop === 0) {
          touchStartY = e.touches[0].clientY;
          pullIndicator.style.display = "flex";
        }
      }, { passive: true });

      stationList.addEventListener("touchmove", (e) => {
        if (touchStartY && stationList.scrollTop === 0) {
          const currentY = e.touches[0].clientY;
          const pullDistance = currentY - touchStartY;
          
          if (pullDistance > 0 && pullDistance < pullToRefreshThreshold) {
            isPulling = true;
            pullIndicator.style.transform = `translateY(${pullDistance}px)`;
            pullIndicator.classList.add("pulling");
          } else if (pullDistance >= pullToRefreshThreshold) {
            isPulling = true;
            pullIndicator.style.transform = `translateY(${pullToRefreshThreshold}px)`;
            pullIndicator.classList.add("pulling");
          }
        }
      }, { passive: true });

      stationList.addEventListener("touchend", (e) => {
        if (touchStartY && stationList.scrollTop === 0) {
          const endY = e.changedTouches[0].clientY;
          const pullDistance = endY - touchStartY;
          
          if (pullDistance >= pullToRefreshThreshold) {
            showLoading();
            loadStations().finally(() => {
              hideLoading();
              showToast("Станції оновлено!", "success");
            });
          }
          
          touchStartY = 0;
          isPulling = false;
          pullIndicator.classList.remove("pulling");
          pullIndicator.style.transform = "";
          setTimeout(() => {
            pullIndicator.style.display = "none";
          }, 300);
        }
      }, { passive: true });
    }

    function setupLazyLoading() {
      lazyLoadObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            const src = img.dataset.src;
            if (src) {
              // Перевіряємо протокол для HTTPS
              const secureSrc = src.replace('http://', 'https://');
              img.src = secureSrc;
              img.classList.add('loaded');
              lazyLoadObserver.unobserve(img);
            }
          }
        });
      }, {
        rootMargin: '50px'
      });
    }

    function updateWaveVisualizer(playing) {
      if (!waveVisualizer) return;
      
      if (playing) {
        waveVisualizer.classList.add('playing');
      } else {
        waveVisualizer.classList.remove('playing');
      }
    }

    function showLoading() {
      if (loadingIndicator) {
        loadingIndicator.classList.add("show");
      }
    }

    function hideLoading() {
      if (loadingIndicator) {
        loadingIndicator.classList.remove("show");
      }
    }

    function exportSettings() {
      const settings = {
        selectedTheme: localStorage.getItem("selectedTheme") || "shadow-pulse",
        customTabs: JSON.parse(localStorage.getItem("customTabs")) || [],
        userAddedStations: JSON.parse(localStorage.getItem("userAddedStations")) || {},
        favoriteStations: JSON.parse(localStorage.getItem("favoriteStations")) || [],
        pastSearches: JSON.parse(localStorage.getItem("pastSearches")) || [],
        deletedStations: JSON.parse(localStorage.getItem("deletedStations")) || [],
        currentTab: localStorage.getItem("currentTab") || "techno"
      };
      const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "radio_settings.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("Налаштування успішно експортовано!", "success");
    }

    function importSettings(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const settings = JSON.parse(e.target.result);
          if (!settings || typeof settings !== "object") {
            showToast("Невірний файл налаштувань!", "error");
            return;
          }
          const validThemes = [
            "shadow-pulse", "dark-abyss", "emerald-glow", "retro-wave",
            "neon-pulse", "lime-surge", "flamingo-flash", "aqua-glow",
            "aurora-haze", "starlit-amethyst", "lunar-frost"
          ];
          if (settings.selectedTheme && validThemes.includes(settings.selectedTheme)) {
            localStorage.setItem("selectedTheme", settings.selectedTheme);
            applyTheme(settings.selectedTheme);
          }
          if (Array.isArray(settings.customTabs)) {
            const validTabs = settings.customTabs.filter(tab => 
              typeof tab === "string" && 
              tab.trim() && 
              tab.length <= 10 && 
              /^[a-z0-9_-]+$/.test(tab) && 
              !["best", "techno", "trance", "ukraine", "pop", "search"].includes(tab) &&
              !customTabs.includes(tab)
            );
            if (validTabs.length + customTabs.length <= 7) {
              customTabs = validTabs;
              localStorage.setItem("customTabs", JSON.stringify(customTabs));
            } else {
              console.warn("Imported custom tabs exceed limit of 7, skipping");
            }
          }
          if (settings.userAddedStations && typeof settings.userAddedStations === "object") {
            const validStations = {};
            Object.keys(settings.userAddedStations).forEach(tab => {
              if (["techno", "trance", "ukraine", "pop", ...customTabs].includes(tab)) {
                const stations = Array.isArray(settings.userAddedStations[tab]) 
                  ? settings.userAddedStations[tab].filter(s => 
                      s && typeof s === "object" && 
                      s.name && typeof s.name === "string" && 
                      s.value && isValidUrl(s.value) && 
                      s.genre && typeof s.genre === "string" && 
                      s.country && typeof s.country === "string"
                    )
                  : [];
                validStations[tab] = stations;
              }
            });
            userAddedStations = validStations;
            localStorage.setItem("userAddedStations", JSON.stringify(userAddedStations));
          }
          if (Array.isArray(settings.favoriteStations)) {
            favoriteStations = settings.favoriteStations.filter(name => typeof name === "string");
            localStorage.setItem("favoriteStations", JSON.stringify(favoriteStations));
          }
          if (Array.isArray(settings.pastSearches)) {
            pastSearches = settings.pastSearches.filter(search => typeof search === "string").slice(0, 5);
            localStorage.setItem("pastSearches", JSON.stringify(pastSearches));
            updatePastSearches();
          }
          if (Array.isArray(settings.deletedStations)) {
            deletedStations = settings.deletedStations.filter(name => typeof name === "string");
            localStorage.setItem("deletedStations", JSON.stringify(deletedStations));
          }
          if (settings.currentTab && typeof settings.currentTab === "string") {
            const validTabs = ["best", "techno", "trance", "ukraine", "pop", "search", ...customTabs];
            if (validTabs.includes(settings.currentTab)) {
              currentTab = settings.currentTab;
              localStorage.setItem("currentTab", currentTab);
            }
          }
          loadStations();
          switchTab(currentTab);
          showToast("Налаштування успішно імпортовано!", "success");
        } catch (error) {
          console.error("Error importing settings:", error);
          showToast("Помилка імпорту налаштувань. Перевірте формат файлу.", "error");
        }
        importFileInput.value = "";
      };
      reader.readAsText(file);
    }

    function populateSearchSuggestions() {
      const suggestedCountries = [
        "Germany", "France", "United Kingdom", "Italy", "Spain", "Netherlands",
        "Switzerland", "Belgium", "Sweden", "Norway", "Denmark", "Austria",
        "Poland", "Ukraine", "Canada", "United States", "Australia", "Japan",
        "South Korea", "New Zealand"
      ];
      const suggestedGenres = [
        "Pop", "Rock", "Dance", "Electronic", "Techno", "Trance", "House",
        "EDM", "Hip-Hop", "Rap", "Jazz", "Classical", "Country", "Reggae",
        "Blues", "Folk", "Metal", "R&B", "Soul", "Ambient"
      ];

      const countryDatalist = document.getElementById("suggestedCountries");
      const genreDatalist = document.getElementById("suggestedGenres");

      if (countryDatalist) {
        countryDatalist.innerHTML = suggestedCountries.map(country => `<option value="${country}">`).join("");
      }
      if (genreDatalist) {
        genreDatalist.innerHTML = suggestedGenres.map(genre => `<option value="${genre}">`).join("");
      }
    }

    function updatePastSearches() {
      pastSearchesList.innerHTML = "";
      pastSearches.forEach(search => {
        const option = document.createElement("option");
        option.value = search;
        pastSearchesList.appendChild(option);
      });
    }

    function normalizeCountry(country) {
      if (!country) return "";
      const countryMap = {
        "ukraine": "Ukraine", "italy": "Italy", "german": "Germany",
        "germany": "Germany", "france": "France", "spain": "Spain",
        "usa": "United States", "united states": "United States",
        "uk": "United Kingdom", "united kingdom": "United Kingdom",
        "netherlands": "Netherlands", "canada": "Canada", "australia": "Australia",
        "switzerland": "Switzerland", "belgium": "Belgium", "poland": "Poland",
        "austria": "Austria", "sweden": "Sweden", "norway": "Norway",
        "denmark": "Denmark", "japan": "Japan", "south korea": "South Korea",
        "new zealand": "New Zealand"
      };
      const normalized = country.toLowerCase();
      return countryMap[normalized] || country.charAt(0).toUpperCase() + country.slice(1).toLowerCase();
    }

    function isValidUrl(url) {
      if (!url) return false;
      try {
        new URL(url);
        return url.startsWith('http://') || url.startsWith('https://');
      } catch {
        return false;
      }
    }

    function normalizeUrl(url) {
      if (!url) return "";
      try {
        const urlObj = new URL(url);
        return urlObj.origin + urlObj.pathname;
      } catch {
        return url;
      }
    }

    function resetStationInfo() {
      const stationNameElement = currentStationInfo.querySelector(".station-name");
      const stationGenreElement = currentStationInfo.querySelector(".station-genre");
      const stationCountryElement = currentStationInfo.querySelector(".station-country");
      const stationIconElement = currentStationInfo.querySelector(".station-icon");
      const currentTrackElement = document.getElementById("currentTrack");
      if (stationNameElement) stationNameElement.textContent = "Виберіть станцію";
      if (stationGenreElement) stationGenreElement.textContent = "жанр: -";
      if (stationCountryElement) stationCountryElement.textContent = "країна: -";
      if (stationIconElement) {
        stationIconElement.innerHTML = "🎵";
        stationIconElement.style.backgroundImage = "none";
      }
      if (currentTrackElement) {
        currentTrackElement.textContent = "🎵 Трек: невідомо";
      }
    }

    // Функція для перевірки, чи підтримує станція метадані
    function supportsMetadata(stationUrl) {
      try {
        const url = new URL(stationUrl);
        return !noMetadataStations.some(domain => url.hostname.includes(domain));
      } catch {
        return true;
      }
    }

    // --- ПОКРАЩЕНА ФУНКЦІЯ ДЛЯ ОТРИМАННЯ МЕТАДАНИХ ТРЕКУ ---
    async function fetchTrackMetadata(stationUrl, stationName) {
      // Зупиняємо попереднє читання потоку
      stopMetadataStreaming();
      
      if (!stationUrl || !isPlaying) {
        updateTrackDisplay("unknown");
        return;
      }

      updateTrackDisplay("loading...");

      // Перевіряємо, чи підтримує станція метадані
      if (!supportsMetadata(stationUrl)) {
        console.log("Station doesn't support metadata, showing station name as track");
        updateTrackDisplay(stationName);
        return;
      }

      // Спочатку пробуємо отримати метадані через API радіобраузера за URL
      try {
        const encodedUrl = encodeURIComponent(stationUrl);
        const searchUrl = `https://de1.api.radio-browser.info/json/stations/byurl/${encodedUrl}?limit=1&hidebroken=true`;
        
        const response = await fetch(searchUrl, {
          signal: AbortSignal.timeout(3000),
          headers: { 'User-Agent': 'RadioMusicSO/1.0' }
        });

        if (response.ok) {
          const stations = await response.json();
          if (stations.length > 0 && stations[0].current_track) {
            updateTrackDisplay(stations[0].current_track);
            
            // Запускаємо періодичну перевірку через API
            startPeriodicApiCheck(stations[0].id);
            return;
          }
        }
      } catch (error) {
        console.log("API by URL failed:", error.message);
      }

      // Якщо не вдалося за URL, пробуємо знайти станцію за назвою
      try {
        const searchParams = new URLSearchParams({
          name: stationName,
          limit: 10,
          order: "clickcount",
          reverse: "true",
          hidebroken: "true"
        });
        
        const searchUrl = `https://de1.api.radio-browser.info/json/stations/search?${searchParams.toString()}`;
        const response = await fetch(searchUrl, {
          signal: AbortSignal.timeout(3000),
          headers: { 'User-Agent': 'RadioMusicSO/1.0' }
        });

        if (response.ok) {
          const stations = await response.json();
          
          // Шукаємо станцію з найближчим URL
          for (const station of stations) {
            if (station.url_resolved && normalizeUrl(station.url_resolved) === normalizeUrl(stationUrl)) {
              if (station.current_track) {
                updateTrackDisplay(station.current_track);
                startPeriodicApiCheck(station.id);
                return;
              }
              break;
            }
          }
          
          // Якщо точної не знайшли, беремо першу з високим рейтингом
          if (stations.length > 0 && stations[0].current_track) {
            updateTrackDisplay(stations[0].current_track);
            startPeriodicApiCheck(stations[0].id);
            return;
          }
        }
      } catch (error) {
        console.log("API by name failed:", error.message);
      }

      // Якщо API не дало результату, показуємо назву станції
      updateTrackDisplay(stationName);
    }

    // Періодична перевірка через API
    function startPeriodicApiCheck(stationId) {
      if (metadataCheckInterval) {
        clearInterval(metadataCheckInterval);
      }

      metadataCheckInterval = setInterval(async () => {
        if (!isPlaying) return;

        try {
          const response = await fetch(`https://de1.api.radio-browser.info/json/stations/byuuid/${stationId}`, {
            signal: AbortSignal.timeout(3000),
            headers: { 'User-Agent': 'RadioMusicSO/1.0' }
          });

          if (response.ok) {
            const stations = await response.json();
            if (stations.length > 0 && stations[0].current_track) {
              const newTrack = stations[0].current_track;
              if (newTrack !== currentTrack) {
                updateTrackDisplay(newTrack);
              }
            }
          }
        } catch (error) {
          console.log("Periodic API check failed:", error.message);
        }
      }, 15000); // Кожні 15 секунд
    }

    function updateTrackDisplay(track) {
      const currentTrackElement = document.getElementById("currentTrack");
      if (!currentTrackElement) return;

      currentTrackElement.classList.remove('loading', 'marquee');

      if (track && track !== "unknown" && track !== "loading..." && track !== 'null' && track !== 'undefined') {
        let cleanTrack = track.replace(/^StreamTitle='|';$|'$/g, '').trim();
        
        // Видаляємо зайві символи
        cleanTrack = cleanTrack.replace(/[^\x20-\x7E\u0400-\u04FF]/g, '');
        
        // Якщо трек виявився пустим, показуємо назву станції
        if (!cleanTrack || cleanTrack.length === 0) {
          const stationName = stationItems?.[currentIndex]?.dataset?.name || "unknown";
          cleanTrack = stationName;
        }
        
        // Розділяємо на виконавця і трек якщо є " - "
        if (cleanTrack.includes(' - ')) {
          const parts = cleanTrack.split(' - ');
          if (parts.length >= 2) {
            cleanTrack = `${parts[0]} - ${parts[1]}`;
          }
        }
        
        if (cleanTrack.length > 50) {
          currentTrackElement.classList.add('marquee');
          currentTrackElement.textContent = `🎵 ${cleanTrack}`;
        } else {
          currentTrackElement.textContent = `🎵 ${cleanTrack}`;
        }
        
        currentTrackElement.title = cleanTrack;
        currentTrack = cleanTrack;
      } else if (track === "loading...") {
        currentTrackElement.textContent = "🎵 Завантаження треку...";
        currentTrackElement.classList.add("loading");
        currentTrack = "";
      } else {
        // Якщо трек не визначено, показуємо назву станції
        const stationName = stationItems?.[currentIndex]?.dataset?.name || "unknown";
        currentTrackElement.textContent = `🎵 ${stationName}`;
        currentTrack = stationName;
      }
    }

    function stopMetadataStreaming() {
      if (metadataCheckInterval) {
        clearInterval(metadataCheckInterval);
        metadataCheckInterval = null;
      }
      if (metadataRetryTimeout) {
        clearTimeout(metadataRetryTimeout);
        metadataRetryTimeout = null;
      }
    }
    // --- КІНЕЦЬ ПОКРАЩЕНОЇ ФУНКЦІЇ ---

    // Покращений пошук станцій
    async function searchStations(query, country, genre) {
      showLoading();
      stationList.innerHTML = "<div class='station-item empty'>Пошук...</div>";
      
      try {
        abortController.abort();
        abortController = new AbortController();
        
        const params = new URLSearchParams();
        if (query) params.append("name", query);
        if (country) params.append("country", country);
        if (genre) params.append("tag", genre);
        
        params.append("order", "clickcount");
        params.append("reverse", "true");
        params.append("limit", "500");
        params.append("hidebroken", "true");
        
        const url = `https://de1.api.radio-browser.info/json/stations/search?${params.toString()}`;
        console.log("Search URL:", url);
        
        const response = await fetch(url, {
          signal: abortController.signal,
          headers: { 'User-Agent': 'RadioMusicSO/1.0' }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        let stations = await response.json();
        
        // М'якша фільтрація - перевіряємо наявність URL
        stations = stations.filter(station => {
          const url = station.url || station.url_resolved;
          return url && (url.startsWith('http://') || url.startsWith('https://'));
        });
        
        // Конвертуємо HTTP в HTTPS для безпеки
        stations = stations.map(station => {
          if (station.url && station.url.startsWith('http://')) {
            station.url = station.url.replace('http://', 'https://');
          }
          if (station.url_resolved && station.url_resolved.startsWith('http://')) {
            station.url_resolved = station.url_resolved.replace('http://', 'https://');
          }
          return station;
        });
        
        console.log(`Знайдено ${stations.length} станцій`);
        renderSearchResults(stations);
        showToast(`Знайдено ${stations.length} станцій`, "success");
        
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error("Error searching stations:", error);
          stationList.innerHTML = "<div class='station-item empty'>Не вдалося знайти станції</div>";
          showToast("Помилка пошуку", "error");
        }
      } finally {
        hideLoading();
      }
    }

    function renderSearchResults(stations) {
      if (!stations.length) {
        stationList.innerHTML = "<div class='station-item empty'>Нічого не знайдено</div>";
        stationItems = [];
        return;
      }
      
      const fragment = document.createDocumentFragment();
      stations.forEach((station, index) => {
        const item = document.createElement("div");
        item.className = `station-item ${index === currentIndex ? "selected" : ""}`;
        const stationUrl = station.url || station.url_resolved;
        item.dataset.value = stationUrl;
        item.dataset.name = station.name || "Unknown";
        item.dataset.genre = shortenGenre(station.tags || "Unknown");
        item.dataset.country = station.country || "Unknown";
        item.dataset.favicon = station.favicon && isValidUrl(station.favicon) ? station.favicon.replace('http://', 'https://') : "";
        item.dataset.index = index;
        item.style.setProperty('--item-index', index);
        
        const iconHtml = item.dataset.favicon 
          ? `<img data-src="${item.dataset.favicon}" alt="${station.name} icon" style="width: 32px; height: 32px; object-fit: contain; margin-right: 10px;" onerror="this.outerHTML='🎵 '">` 
          : "🎵 ";
        
        item.innerHTML = `
          ${iconHtml}
          <span class="station-name">${station.name}</span>
          <div class="buttons-container">
            <button class="add-btn" aria-label="Додати станцію">ADD</button>
          </div>`;
        
        fragment.appendChild(item);
      });
      
      stationList.innerHTML = "";
      stationList.appendChild(fragment);
      stationItems = document.querySelectorAll(".station-item");
      
      // Налаштовуємо lazy loading для зображень
      stationItems.forEach(item => {
        const img = item.querySelector('img');
        if (img) {
          lazyLoadObserver.observe(img);
        }
      });
      
      stationList.onclick = e => {
        const item = e.target.closest(".station-item");
        const addBtn = e.target.closest(".add-btn");
        if (item && !item.classList.contains("empty")) {
          e.preventDefault();
          currentIndex = Array.from(stationItems).indexOf(item);
          changeStation(currentIndex);
          provideHapticFeedback();
        }
        if (addBtn) {
          e.stopPropagation();
          e.preventDefault();
          showTabModal(item);
        }
      };
    }

    function shortenGenre(tags) {
      const genres = tags.split(",").map(g => g.trim()).filter(g => g);
      return genres.length > 4 ? genres.slice(0, 4).join(", ") + "..." : genres.join(", ");
    }

    function showTabModal(item) {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      const modal = document.createElement("div");
      modal.className = "modal";
      modal.innerHTML = `
        <h2>Виберіть вкладку</h2>
        <div class="modal-tabs">
          <button class="modal-tab-btn" data-tab="techno">TECHNO</button>
          <button class="modal-tab-btn" data-tab="trance">TRANCE</button>
          <button class="modal-tab-btn" data-tab="ukraine">UA</button>
          <button class="modal-tab-btn" data-tab="pop">POP</button>
          ${customTabs.map(tab => `<button class="modal-tab-btn" data-tab="${tab}">${tab.toUpperCase()}</button>`).join('')}
          <button class="modal-cancel-btn">Скасувати</button>
        </div>
      `;
      document.body.appendChild(overlay);
      document.body.appendChild(modal);
      const closeModal = () => {
        overlay.remove();
        modal.remove();
      };
      overlay.addEventListener("click", closeModal);
      modal.querySelectorAll(".modal-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const targetTab = btn.dataset.tab;
          saveStation(item, targetTab);
          closeModal();
          provideHapticFeedback();
        });
      });
      modal.querySelector(".modal-cancel-btn").addEventListener("click", closeModal);
    }

    function saveStation(item, targetTab) {
      const stationName = item.dataset.name;
      if (!stationLists[targetTab]) stationLists[targetTab] = [];
      if (!userAddedStations[targetTab]) userAddedStations[targetTab] = [];
      if (!stationLists[targetTab].some(s => s.name === stationName)) {
        const newStation = {
          value: item.dataset.value,
          name: item.dataset.name,
          genre: item.dataset.genre,
          country: item.dataset.country,
          favicon: item.dataset.favicon || "",
          isFromSearch: currentTab === "search"
        };
        stationLists[targetTab].unshift(newStation);
        userAddedStations[targetTab].unshift(newStation);
        localStorage.setItem("stationLists", JSON.stringify(stationLists));
        localStorage.setItem("userAddedStations", JSON.stringify(userAddedStations));
        if (currentTab !== "search") {
          updateStationList();
        }
        showToast(`Станцію додано до ${targetTab}`, "success");
      } else {
        showToast("Станція вже існує в цій вкладці!", "error");
      }
    }

    function renderTabs() {
      const fixedTabs = ["best", "techno", "trance", "ukraine", "pop"];
      const searchTab = "search";
      
      tabsContainer.innerHTML = "";
      
      // Спочатку фіксовані таби
      fixedTabs.forEach(tab => {
        const btn = document.createElement("button");
        btn.className = `tab-btn ${currentTab === tab ? "active" : ""}`;
        btn.dataset.tab = tab;
        btn.textContent = tab === "best" ? "Best" : tab === "ukraine" ? "UA" : tab.charAt(0).toUpperCase() + tab.slice(1);
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", currentTab === tab ? "true" : "false");
        btn.setAttribute("aria-label", `${tab} tab`);
        tabsContainer.appendChild(btn);
      });
      
      // Потім кастомні таби
      customTabs.forEach(tab => {
        if (typeof tab !== "string" || !tab.trim()) return;
        const btn = document.createElement("button");
        btn.className = `tab-btn ${currentTab === tab ? "active" : ""}`;
        btn.dataset.tab = tab;
        btn.textContent = tab.toUpperCase();
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", currentTab === tab ? "true" : "false");
        btn.setAttribute("aria-label", `${tab} tab`);
        tabsContainer.appendChild(btn);
      });
      
      // Search tab завжди останній
      const searchBtn = document.createElement("button");
      searchBtn.className = `tab-btn ${currentTab === "search" ? "active" : ""}`;
      searchBtn.dataset.tab = "search";
      searchBtn.textContent = "SEARCH";
      searchBtn.setAttribute("role", "tab");
      searchBtn.setAttribute("aria-selected", currentTab === "search" ? "true" : "false");
      searchBtn.setAttribute("aria-label", "Search tab");
      tabsContainer.appendChild(searchBtn);
      
      // Кнопка додавання табу
      const addBtn = document.createElement("button");
      addBtn.className = "add-tab-btn";
      addBtn.textContent = "+";
      addBtn.setAttribute("aria-label", "Додати нову вкладку");
      tabsContainer.appendChild(addBtn);

      tabsContainer.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          switchTab(btn.dataset.tab);
          provideHapticFeedback();
        });
        if (customTabs.includes(btn.dataset.tab)) {
          let longPressTimer;
          btn.addEventListener("pointerdown", () => {
            longPressTimer = setTimeout(() => {
              showEditTabModal(btn.dataset.tab);
              provideHapticFeedback([100]);
            }, 500);
          });
          btn.addEventListener("pointerup", () => clearTimeout(longPressTimer));
          btn.addEventListener("pointerleave", () => clearTimeout(longPressTimer));
        }
      });

      addBtn.addEventListener("click", showNewTabModal);
    }

    function showNewTabModal() {
      const overlay = document.querySelector(".new-tab-modal");
      const modal = overlay.querySelector(".modal");
      const input = document.getElementById("newTabName");
      const createBtn = document.getElementById("createTabBtn");
      const cancelBtn = modal.querySelector(".modal-cancel-btn");

      overlay.style.display = "block";
      input.value = "";
      input.focus();

      const closeModal = () => {
        overlay.style.display = "none";
        createBtn.removeEventListener("click", createTabHandler);
        cancelBtn.removeEventListener("click", closeModal);
        overlay.removeEventListener("click", closeModal);
        input.removeEventListener("keypress", keypressHandler);
      };

      const createTabHandler = () => {
        const tabName = input.value.trim().toLowerCase();
        if (!tabName) {
          showToast("Введіть назву вкладки!", "error");
          return;
        }
        if (["best", "techno", "trance", "ukraine", "pop", "search"].includes(tabName) || customTabs.includes(tabName)) {
          showToast("Така назва вкладки вже існує!", "error");
          return;
        }
        if (tabName.length > 10 || !/^[a-z0-9_-]+$/.test(tabName)) {
          showToast("Назва вкладки не може перевищувати 10 символів і має містити лише латинські літери, цифри, дефіс або підкреслення.", "error");
          return;
        }
        if (customTabs.length >= 7) {
          showToast("Досягнуто максимум 7 кастомних вкладок!", "error");
          return;
        }
        customTabs.push(tabName);
        stationLists[tabName] = [];
        userAddedStations[tabName] = [];
        localStorage.setItem("customTabs", JSON.stringify(customTabs));
        localStorage.setItem("stationLists", JSON.stringify(stationLists));
        localStorage.setItem("userAddedStations", JSON.stringify(userAddedStations));
        renderTabs();
        switchTab(tabName);
        closeModal();
        showToast(`Вкладку "${tabName}" створено!`, "success");
      };

      const keypressHandler = (e) => {
        if (e.key === "Enter") createBtn.click();
      };

      createBtn.addEventListener("click", createTabHandler);
      cancelBtn.addEventListener("click", closeModal);
      overlay.addEventListener("click", closeModal);
      input.addEventListener("keypress", keypressHandler);
    }

    function showEditTabModal(tab) {
      const overlay = document.querySelector(".edit-tab-modal");
      const modal = overlay.querySelector(".modal");
      const input = document.getElementById("renameTabName");
      const renameBtn = document.getElementById("renameTabBtn");
      const deleteBtn = document.getElementById("deleteTabBtn");
      const cancelBtn = modal.querySelector(".modal-cancel-btn");

      overlay.style.display = "block";
      input.value = tab;
      input.focus();

      const closeModal = () => {
        overlay.style.display = "none";
        renameBtn.removeEventListener("click", renameTabHandler);
        deleteBtn.removeEventListener("click", deleteTabHandler);
        cancelBtn.removeEventListener("click", closeModal);
        overlay.removeEventListener("click", closeModal);
        input.removeEventListener("keypress", keypressHandler);
      };

      const renameTabHandler = () => {
        const newName = input.value.trim().toLowerCase();
        if (!newName) {
          showToast("Введіть нову назву вкладки!", "error");
          return;
        }
        if (["best", "techno", "trance", "ukraine", "pop", "search"].includes(newName) || customTabs.includes(newName)) {
          showToast("Така назва вкладки вже існує!", "error");
          return;
        }
        if (newName.length > 10 || !/^[a-z0-9_-]+$/.test(newName)) {
          showToast("Назва вкладки не може перевищувати 10 символів і має містити лише латинські літери, цифри, дефіс або підкреслення.", "error");
          return;
        }
        const index = customTabs.indexOf(tab);
        customTabs[index] = newName;
        stationLists[newName] = stationLists[tab] || [];
        userAddedStations[newName] = userAddedStations[tab] || [];
        delete stationLists[tab];
        delete userAddedStations[tab];
        localStorage.setItem("customTabs", JSON.stringify(customTabs));
        localStorage.setItem("stationLists", JSON.stringify(stationLists));
        localStorage.setItem("userAddedStations", JSON.stringify(userAddedStations));
        if (currentTab === tab) switchTab(newName);
        renderTabs();
        closeModal();
        showToast(`Вкладку перейменовано на "${newName}"`, "success");
      };

      const deleteTabHandler = () => {
        if (confirm(`Ви впевнені, що хочете видалити вкладку "${tab.toUpperCase()}"?`)) {
          customTabs = customTabs.filter(t => t !== tab);
          delete stationLists[tab];
          delete userAddedStations[tab];
          localStorage.setItem("customTabs", JSON.stringify(customTabs));
          localStorage.setItem("stationLists", JSON.stringify(stationLists));
          localStorage.setItem("userAddedStations", JSON.stringify(userAddedStations));
          if (currentTab === tab) {
            const newTab = customTabs.length > 0 ? customTabs[0] : "techno";
            switchTab(newTab);
          }
          renderTabs();
          closeModal();
          showToast(`Вкладку "${tab}" видалено`, "success");
        }
      };

      const keypressHandler = (e) => {
        if (e.key === "Enter") renameBtn.click();
      };

      renameBtn.addEventListener("click", renameTabHandler);
      deleteBtn.addEventListener("click", deleteTabHandler);
      cancelBtn.addEventListener("click", closeModal);
      overlay.addEventListener("click", closeModal);
      input.addEventListener("keypress", keypressHandler);
    }

    const themes = {
      "shadow-pulse": {
        bodyBg: "#000000",
        containerBg: "#000000",
        accent: "#00E676",
        text: "#FFFFFF",
        accentGradient: "linear-gradient(45deg, #00B248, #00E676)",
        shadow: "rgba(0, 230, 118, 0.3)"
      },
      "dark-abyss": {
        bodyBg: "#000000",
        containerBg: "#000000",
        accent: "#AA00FF",
        text: "#FFFFFF",
        accentGradient: "linear-gradient(45deg, #6A1B9A, #AA00FF)",
        shadow: "rgba(170, 0, 255, 0.3)"
      },
      "emerald-glow": {
        bodyBg: "#000000",
        containerBg: "#000000",
        accent: "#2EC4B6",
        text: "#FFFFFF",
        accentGradient: "linear-gradient(45deg, #1B998B, #2EC4B6)",
        shadow: "rgba(46, 196, 182, 0.3)"
      },
      "retro-wave": {
        bodyBg: "#000000",
        containerBg: "#000000",
        accent: "#FF69B4",
        text: "#FFFFFF",
        accentGradient: "linear-gradient(45deg, #C71585, #FF69B4)",
        shadow: "rgba(255, 105, 180, 0.3)"
      },
      "neon-pulse": {
        bodyBg: "#000000",
        containerBg: "#000000",
        accent: "#00F0FF",
        text: "#FFFFFF",
        accentGradient: "linear-gradient(45deg, #0077B6, #00F0FF)",
        shadow: "rgba(0, 240, 255, 0.3)"
      },
      "lime-surge": {
        bodyBg: "#000000",
        containerBg: "#000000",
        accent: "#B2FF59",
        text: "#FFFFFF",
        accentGradient: "linear-gradient(45deg, #00B248, #B2FF59)",
        shadow: "rgba(178, 255, 89, 0.3)"
      },
      "flamingo-flash": {
        bodyBg: "#000000",
        containerBg: "#000000",
        accent: "#FF4081",
        text: "#FFFFFF",
        accentGradient: "linear-gradient(45deg, #C71585, #FF4081)",
        shadow: "rgba(255, 64, 129, 0.3)"
      },
      "aqua-glow": {
        bodyBg: "#000000",
        containerBg: "#000000",
        accent: "#26C6DA",
        text: "#FFFFFF",
        accentGradient: "linear-gradient(45deg, #0077B6, #26C6DA)",
        shadow: "rgba(38, 198, 218, 0.3)"
      },
      "aurora-haze": {
        bodyBg: "#000000",
        containerBg: "#000000",
        accent: "#64FFDA",
        text: "#FFFFFF",
        accentGradient: "linear-gradient(45deg, #1B998B, #64FFDA)",
        shadow: "rgba(100, 255, 218, 0.3)"
      },
      "starlit-amethyst": {
        bodyBg: "#000000",
        containerBg: "#000000",
        accent: "#B388FF",
        text: "#FFFFFF",
        accentGradient: "linear-gradient(45deg, #6A1B9A, #B388FF)",
        shadow: "rgba(179, 136, 255, 0.3)"
      },
      "lunar-frost": {
        bodyBg: "#000000",
        containerBg: "#000000",
        accent: "#40C4FF",
        text: "#FFFFFF",
        accentGradient: "linear-gradient(45deg, #0077B6, #40C4FF)",
        shadow: "rgba(64, 196, 255, 0.3)"
      }
    };
    
    let currentTheme = localStorage.getItem("selectedTheme") || "shadow-pulse";
    if (!themes[currentTheme]) {
      currentTheme = "shadow-pulse";
      localStorage.setItem("selectedTheme", currentTheme);
    }

    function applyTheme(theme) {
      if (!themes[theme]) {
        theme = "shadow-pulse";
        localStorage.setItem("selectedTheme", theme);
      }
      const root = document.documentElement;
      root.style.setProperty("--body-bg", themes[theme].bodyBg);
      root.style.setProperty("--container-bg", themes[theme].containerBg);
      root.style.setProperty("--accent", themes[theme].accent);
      root.style.setProperty("--text", themes[theme].text);
      root.style.setProperty("--accent-gradient", themes[theme].accentGradient);
      root.style.setProperty("--shadow", themes[theme].shadow);
      localStorage.setItem("selectedTheme", theme);
      currentTheme = theme;
      document.documentElement.setAttribute("data-theme", theme);
      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        themeColorMeta.setAttribute("content", themes[theme].accent);
      }
    }

    function toggleTheme() {
      const themesOrder = [
        "shadow-pulse", "dark-abyss", "emerald-glow", "retro-wave",
        "neon-pulse", "lime-surge", "flamingo-flash", "aqua-glow",
        "aurora-haze", "starlit-amethyst", "lunar-frost"
      ];
      const nextTheme = themesOrder[(themesOrder.indexOf(currentTheme) + 1) % themesOrder.length];
      applyTheme(nextTheme);
      provideHapticFeedback();
      showToast(`Тему змінено на ${nextTheme}`, "info");
    }

    themeToggle.addEventListener("click", toggleTheme);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").then(registration => {
        registration.update();
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "activated" && navigator.serviceWorker.controller) {
                if (window.confirm("Доступна нова версія радіо. Оновити?")) {
                  window.location.reload();
                }
              }
            });
          }
        });
      });

      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data.type === "CACHE_UPDATED") {
          const currentCacheVersion = localStorage.getItem("cacheVersion") || "0";
          if (currentCacheVersion !== event.data.cacheVersion) {
            favoriteStations = favoriteStations.filter((name) =>
              Object.values(stationLists).flat().some((s) => s.name === name)
            );
            localStorage.setItem("favoriteStations", JSON.stringify(favoriteStations));
            localStorage.setItem("cacheVersion", event.data.cacheVersion);
            loadStations();
            showToast("Додаток оновлено!", "success");
          }
        }
        if (event.data.type === "NETWORK_STATUS" && event.data.online && intendedPlaying && stationItems?.length && currentIndex < stationItems.length) {
          debouncedTryAutoPlay();
        }
      });
    }

    let autoPlayTimeout = null;
    function debouncedTryAutoPlay(retryCount = 2, delay = 1000) {
      if (isAutoPlayPending) return;
      const now = Date.now();
      const currentStationUrl = stationItems?.[currentIndex]?.dataset?.value;
      const normalizedCurrentUrl = normalizeUrl(currentStationUrl);
      const normalizedAudioSrc = normalizeUrl(audio.src);
      if (now - lastSuccessfulPlayTime < 500 && normalizedAudioSrc === normalizedCurrentUrl) return;
      if (autoPlayTimeout) clearTimeout(autoPlayTimeout);
      autoPlayRequestId++;
      const currentRequestId = autoPlayRequestId;
      autoPlayTimeout = setTimeout(() => tryAutoPlay(retryCount, delay, currentRequestId), 0);
    }

    async function tryAutoPlay(retryCount = 2, delay = 1000, requestId) {
      if (isAutoPlayPending) return;
      if (requestId !== autoPlayRequestId) return;
      isAutoPlayPending = true;

      try {
        if (!navigator.onLine) return;
        if (!intendedPlaying || !stationItems?.length || currentIndex >= stationItems.length) {
          updateWaveVisualizer(false);
          return;
        }
        const currentStationUrl = stationItems[currentIndex].dataset.value;
        const initialStationUrl = currentStationUrl;
        const normalizedCurrentUrl = normalizeUrl(currentStationUrl);
        const normalizedAudioSrc = normalizeUrl(audio.src);
        if (normalizedAudioSrc === normalizedCurrentUrl && !audio.paused && !audio.error && audio.readyState >= 2 && audio.currentTime > 0) return;
        if (!isValidUrl(currentStationUrl)) {
          errorCount++;
          if (errorCount >= ERROR_LIMIT) resetStationInfo();
          return;
        }

        const attemptPlay = async (attemptsLeft) => {
          if (streamAbortController) {
            streamAbortController.abort();
            streamAbortController = null;
          }
          if (stationItems[currentIndex].dataset.value !== initialStationUrl) return;
          if (requestId !== autoPlayRequestId) return;

          streamAbortController = new AbortController();
          audio.pause();
          audio.src = null;
          audio.load();
          
          // Використовуємо HTTPS замість HTTP
          const secureUrl = currentStationUrl.replace('http://', 'https://');
          audio.src = secureUrl + "?nocache=" + Date.now();

          try {
            await audio.play();
            errorCount = 0;
            isPlaying = true;
            lastSuccessfulPlayTime = Date.now();
            updateWaveVisualizer(true);
            playPauseBtn.classList.add("playing");
            localStorage.setItem("isPlaying", isPlaying);
            if (stationItems[currentIndex]) {
              updateCurrentStation(stationItems[currentIndex]);
            }
          } catch (error) {
            if (error.name === 'AbortError') return;
            updateWaveVisualizer(false);
            playPauseBtn.classList.remove("playing");
            if (attemptsLeft > 1) {
              if (stationItems[currentIndex].dataset.value !== initialStationUrl) return;
              if (requestId !== autoPlayRequestId) return;
              await new Promise(resolve => setTimeout(resolve, delay));
              await attemptPlay(attemptsLeft - 1);
            } else {
              errorCount++;
              if (errorCount >= ERROR_LIMIT) resetStationInfo();
            }
          } finally {
            streamAbortController = null;
          }
        };

        await attemptPlay(retryCount);
      } finally {
        isAutoPlayPending = false;
        streamAbortController = null;
      }
    }

    function switchTab(tab) {
      const validTabs = ["best", "techno", "trance", "ukraine", "pop", "search", ...customTabs];
      if (!validTabs.includes(tab)) tab = "techno";
      
      document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tab === tab);
        btn.setAttribute("aria-selected", btn.dataset.tab === tab ? "true" : "false");
      });
      
      if (viewTransitionSupported) {
        document.startViewTransition(() => {
          performTabSwitch(tab);
        });
      } else {
        stationList.classList.add("fade-out");
        setTimeout(() => {
          performTabSwitch(tab);
          stationList.classList.remove("fade-out");
          stationList.classList.add("fade-in");
          setTimeout(() => stationList.classList.remove("fade-in"), 300);
        }, 150);
      }
    }

    function performTabSwitch(tab) {
      currentTab = tab;
      localStorage.setItem("currentTab", tab);
      const savedIndex = parseInt(localStorage.getItem(`lastStation_${tab}`)) || 0;
      let maxIndex = 0;
      
      if (tab === "best") {
        maxIndex = favoriteStations.length - 1;
      } else if (tab === "search") {
        maxIndex = 0;
      } else {
        maxIndex = (stationLists[tab]?.length || 0) - 1;
      }
      
      currentIndex = savedIndex <= maxIndex && savedIndex >= 0 ? savedIndex : 0;
      searchInput.style.display = tab === "search" ? "flex" : "none";
      searchQuery.value = "";
      searchCountry.value = "";
      searchGenre.value = "";
      if (tab === "search") populateSearchSuggestions();
      updateStationList();
      renderTabs();
    }

    // Drag and Drop Functions
    function enableDragMode() {
      dragEnabled = true;
      showToast("Режим перетягування увімкнено. Перетягуйте за ручку для зміни порядку.", "info", 2000);
      
      stationItems.forEach(item => {
        item.setAttribute("draggable", "true");
        // Забороняємо виділення тексту
        item.style.userSelect = "none";
        item.style.webkitUserSelect = "none";
      });
    }

    function disableDragMode() {
      dragEnabled = false;
      dragStartIndex = null;
      
      stationItems.forEach(item => {
        item.setAttribute("draggable", "false");
        item.style.userSelect = "";
        item.style.webkitUserSelect = "";
      });
    }

    function setupDragAndDrop() {
      stationItems.forEach((item, index) => {
        const dragHandle = item.querySelector(".drag-handle");
        if (!dragHandle) return;

        dragHandle.removeEventListener("pointerdown", handleDragHandleClick);
        dragHandle.removeEventListener("touchstart", handleLongPress);
        dragHandle.removeEventListener("pointerup", handlePointerUp);
        dragHandle.removeEventListener("pointerleave", handlePointerLeave);
        item.removeEventListener("dragstart", handleDragStart);
        item.removeEventListener("dragend", handleDragEnd);
        item.removeEventListener("dragover", handleDragOver);
        item.removeEventListener("dragleave", handleDragLeave);
        item.removeEventListener("drop", handleDrop);
        
        dragHandle.addEventListener("pointerdown", handleDragHandleClick);
        dragHandle.addEventListener("touchstart", handleLongPress);
        dragHandle.addEventListener("pointerup", handlePointerUp);
        dragHandle.addEventListener("pointerleave", handlePointerLeave);
        
        item.setAttribute("draggable", dragEnabled ? "true" : "false");
        item.dataset.index = index;
        
        item.addEventListener("dragstart", handleDragStart);
        item.addEventListener("dragend", handleDragEnd);
        item.addEventListener("dragover", handleDragOver);
        item.addEventListener("dragleave", handleDragLeave);
        item.addEventListener("drop", handleDrop);
      });
    }

    function handleDragHandleClick(e) {
      e.preventDefault();
      e.stopPropagation();
      
      if (!dragEnabled) {
        enableDragMode();
        provideHapticFeedback();
        
        const item = e.target.closest(".station-item");
        if (item) {
          setTimeout(() => {
            const dragEvent = new DragEvent('dragstart', {
              bubbles: true,
              cancelable: true,
              dataTransfer: new DataTransfer()
            });
            item.dispatchEvent(dragEvent);
          }, 50);
        }
        return;
      }
    }

    function handleDragStart(e) {
      if (!dragEnabled) {
        e.preventDefault();
        return;
      }
      
      const item = e.target.closest(".station-item");
      if (!item) return;

      dragStartIndex = parseInt(item.dataset.index);
      item.classList.add("dragging");
      
      e.dataTransfer.setData("text/plain", dragStartIndex);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setDragImage(item, 20, 20);
      
      provideHapticFeedback();
    }

    function handleDragEnd(e) {
      const item = e.target.closest(".station-item");
      if (item) {
        item.classList.remove("dragging");
      }
      
      document.querySelectorAll(".station-item").forEach(i => {
        i.classList.remove("drag-over");
      });
      
      dragStartIndex = null;
    }

    function handleDragOver(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      
      const item = e.target.closest(".station-item");
      if (item && dragEnabled && item !== stationItems[dragStartIndex]) {
        item.classList.add("drag-over");
      }
    }

    function handleDragLeave(e) {
      const item = e.target.closest(".station-item");
      if (item) {
        item.classList.remove("drag-over");
      }
    }

    function handleDrop(e) {
      e.preventDefault();
      e.stopPropagation();
      
      const targetItem = e.target.closest(".station-item");
      if (!targetItem || dragStartIndex === null || !dragEnabled) return;

      targetItem.classList.remove("drag-over");
      
      const dragEndIndex = parseInt(targetItem.dataset.index);
      if (dragStartIndex === dragEndIndex) return;

      reorderStations(dragStartIndex, dragEndIndex);
      
      document.querySelectorAll(".station-item").forEach(item => {
        item.classList.remove("dragging", "drag-over");
      });
      
      dragStartIndex = null;
      disableDragMode();
      provideHapticFeedback();
      showToast("Порядок станцій оновлено!", "success");
    }

    function handleLongPress(e) {
      e.preventDefault();
      e.stopPropagation();
      
      const item = e.target.closest(".station-item");
      if (!item) return;

      longPressTimer = setTimeout(() => {
        if (!dragEnabled) {
          enableDragMode();
          item.classList.add("long-press");
          setTimeout(() => item.classList.remove("long-press"), 500);
          provideHapticFeedback([100]);
          
          setTimeout(() => {
            const dragEvent = new DragEvent('dragstart', {
              bubbles: true,
              cancelable: true,
              dataTransfer: new DataTransfer()
            });
            item.dispatchEvent(dragEvent);
          }, 50);
        }
      }, 500);
    }

    function handlePointerUp() {
      clearTimeout(longPressTimer);
    }

    function handlePointerLeave() {
      clearTimeout(longPressTimer);
    }

    function reorderStations(fromIndex, toIndex) {
      if (currentTab === "best") {
        const [movedStation] = favoriteStations.splice(fromIndex, 1);
        favoriteStations.splice(toIndex, 0, movedStation);
        localStorage.setItem("favoriteStations", JSON.stringify(favoriteStations));
      } else {
        const stations = stationLists[currentTab];
        if (!stations) return;
        
        const [movedStation] = stations.splice(fromIndex, 1);
        stations.splice(toIndex, 0, movedStation);
        
        if (userAddedStations[currentTab]) {
          const userStationIndex = userAddedStations[currentTab].findIndex(s => s.name === movedStation.name);
          if (userStationIndex !== -1) {
            const [movedUserStation] = userAddedStations[currentTab].splice(userStationIndex, 1);
            userAddedStations[currentTab].splice(toIndex, 0, movedUserStation);
          }
        }
        
        localStorage.setItem("stationLists", JSON.stringify(stationLists));
        localStorage.setItem("userAddedStations", JSON.stringify(userAddedStations));
      }
      
      animateStationReorder();
    }

    function animateStationReorder() {
      if (viewTransitionSupported) {
        document.startViewTransition(() => {
          updateStationList();
        });
      } else {
        stationList.classList.add("fade-out");
        setTimeout(() => {
          updateStationList();
          stationList.classList.remove("fade-out");
          stationList.classList.add("fade-in");
          setTimeout(() => stationList.classList.remove("fade-in"), 300);
        }, 150);
      }
    }

    async function loadStations() {
      console.time("loadStations");
      showLoading();
      stationList.innerHTML = "<div class='station-item empty'>Завантаження...</div>";
      try {
        abortController.abort();
        abortController = new AbortController();
        const response = await fetch(`stations.json?t=${Date.now()}`, {
          cache: "no-store",
          signal: abortController.signal
        });
        const mergedStationLists = {};
        if (response.ok) {
          const newStations = await response.json();
          Object.keys(newStations).forEach(tab => {
            const uniqueStations = new Map();
            (userAddedStations[tab] || []).forEach(s => {
              if (!deletedStations.includes(s.name)) {
                // Конвертуємо HTTP в HTTPS
                if (s.value) s.value = s.value.replace('http://', 'https://');
                if (s.favicon) s.favicon = s.favicon.replace('http://', 'https://');
                uniqueStations.set(s.name, s);
              }
            });
            newStations[tab].forEach(s => {
              if (!deletedStations.includes(s.name)) {
                // Конвертуємо HTTP в HTTPS
                if (s.value) s.value = s.value.replace('http://', 'https://');
                if (s.favicon) s.favicon = s.favicon.replace('http://', 'https://');
                uniqueStations.set(s.name, s);
              }
            });
            mergedStationLists[tab] = Array.from(uniqueStations.values());
          });
        }
        customTabs.forEach(tab => {
          const uniqueStations = new Map();
          (userAddedStations[tab] || []).forEach(s => {
            if (!deletedStations.includes(s.name)) {
              // Конвертуємо HTTP в HTTPS
              if (s.value) s.value = s.value.replace('http://', 'https://');
              if (s.favicon) s.favicon = s.favicon.replace('http://', 'https://');
              uniqueStations.set(s.name, s);
            }
          });
          (stationLists[tab] || []).forEach(s => {
            if (!deletedStations.includes(s.name)) {
              // Конвертуємо HTTP в HTTPS
              if (s.value) s.value = s.value.replace('http://', 'https://');
              if (s.favicon) s.favicon = s.favicon.replace('http://', 'https://');
              uniqueStations.set(s.name, s);
            }
          });
          mergedStationLists[tab] = Array.from(uniqueStations.values());
        });
        stationLists = mergedStationLists;
        localStorage.setItem("stationLists", JSON.stringify(stationLists));
        favoriteStations = favoriteStations.filter(name => 
          Object.values(stationLists).flat().some(s => s.name === name)
        );
        localStorage.setItem("favoriteStations", JSON.stringify(favoriteStations));
        const validTabs = [...Object.keys(stationLists), "best", "search", ...customTabs];
        if (!validTabs.includes(currentTab)) {
          currentTab = validTabs[0] || "techno";
          localStorage.setItem("currentTab", currentTab);
        }
        currentIndex = parseInt(localStorage.getItem(`lastStation_${currentTab}`)) || 0;
        showToast("Станції успішно завантажено!", "success");
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error("Error loading stations:", error);
          stationList.innerHTML = "<div class='station-item empty'>Не вдалося завантажити станції</div>";
          showToast("Не вдалося завантажити станції", "error");
        }
      } finally {
        console.timeEnd("loadStations");
        hideLoading();
      }
    }

    function updateStationList() {
      if (!stationList) return;
      let stations = currentTab === "best"
        ? favoriteStations
            .map(name => Object.values(stationLists).flat().find(s => s.name === name))
            .filter(s => s)
        : stationLists[currentTab] || [];

      if (!stations.length) {
        currentIndex = 0;
        stationItems = [];
        stationList.innerHTML = `<div class="station-item empty">${currentTab === "best" ? "Немає улюблених станцій" : "Немає станцій у цій категорії"}</div>`;
        return;
      }

      const fragment = document.createDocumentFragment();
      stations.forEach((station, index) => {
        const item = document.createElement("div");
        item.className = `station-item ${index === currentIndex ? "selected" : ""}`;
        item.dataset.value = station.value;
        item.dataset.name = station.name;
        item.dataset.genre = shortenGenre(station.genre);
        item.dataset.country = station.country;
        item.dataset.favicon = station.favicon && isValidUrl(station.favicon) ? station.favicon.replace('http://', 'https://') : "";
        item.dataset.index = index;
        item.setAttribute("draggable", "false");
        item.setAttribute("role", "listitem");
        item.style.setProperty('--item-index', index);
        
        const iconHtml = item.dataset.favicon 
          ? `<img data-src="${item.dataset.favicon}" alt="${station.name} icon" style="width: 32px; height: 32px; object-fit: contain; margin-right: 10px;" onerror="this.outerHTML='🎵 ';">` 
          : "🎵 ";
        
        const deleteButton = ["techno", "trance", "ukraine", "pop", ...customTabs].includes(currentTab)
          ? `<button class="delete-btn" aria-label="Видалити станцію">🗑</button>`
          : "";
        
        const dragHandle = ["techno", "trance", "ukraine", "pop", ...customTabs, "best"].includes(currentTab)
          ? `<button class="drag-handle" aria-label="Перетягнути для зміни порядку">⋮⋮</button>`
          : "";
        
        item.innerHTML = `
          ${iconHtml}
          <span class="station-name">${station.name}</span>
          <div class="buttons-container">
            ${dragHandle}
            ${deleteButton}
            <button class="favorite-btn${favoriteStations.includes(station.name) ? " favorited" : ""}" aria-label="${favoriteStations.includes(station.name) ? "Видалити з улюблених" : "Додати до улюблених"}">★</button>
          </div>`;
        fragment.appendChild(item);
      });
      
      stationList.innerHTML = "";
      stationList.appendChild(fragment);
      stationItems = stationList.querySelectorAll(".station-item");

      // Налаштовуємо lazy loading для зображень
      stationItems.forEach(item => {
        const img = item.querySelector('img');
        if (img) {
          lazyLoadObserver.observe(img);
        }
      });

      setupDragAndDrop();
      
      stationList.addEventListener("dragover", handleDragOver);
      stationList.addEventListener("dragleave", handleDragLeave);
      stationList.addEventListener("drop", handleDrop);
      
      stationItems.forEach(item => {
        const dragHandle = item.querySelector(".drag-handle");
        if (dragHandle) {
          dragHandle.addEventListener("pointerup", handlePointerUp);
          dragHandle.addEventListener("pointerleave", handlePointerLeave);
        }
      });

      if (stationItems.length && stationItems[currentIndex] && !stationItems[currentIndex].classList.contains("empty")) {
        stationItems[currentIndex].scrollIntoView({ behavior: "smooth", block: "center" });
      }

      stationList.onclick = e => {
        const item = e.target.closest(".station-item");
        const favoriteBtn = e.target.closest(".favorite-btn");
        const deleteBtn = e.target.closest(".delete-btn");
        const dragHandle = e.target.closest(".drag-handle");
        
        if (item && !item.classList.contains("empty") && !dragHandle) {
          e.preventDefault();
          currentIndex = Array.from(stationItems).indexOf(item);
          changeStation(currentIndex);
          provideHapticFeedback();
        }
        if (favoriteBtn) {
          e.stopPropagation();
          e.preventDefault();
          toggleFavorite(item.dataset.name);
          provideHapticFeedback();
        }
        if (deleteBtn) {
          e.stopPropagation();
          e.preventDefault();
          if (confirm(`Ви впевнені, що хочете видалити станцію "${item.dataset.name}" зі списку?`)) {
            deleteStation(item.dataset.name);
            provideHapticFeedback();
          }
        }
      };
    }

    function toggleFavorite(stationName) {
      if (favoriteStations.includes(stationName)) {
        favoriteStations = favoriteStations.filter(name => name !== stationName);
        showToast(`Видалено з улюблених`, "info");
      } else {
        favoriteStations.unshift(stationName);
        showToast(`Додано до улюблених`, "success");
      }
      localStorage.setItem("favoriteStations", JSON.stringify(favoriteStations));
      if (currentTab === "best") switchTab("best");
      else updateStationList();
    }

    function deleteStation(stationName) {
      if (Array.isArray(stationLists[currentTab])) {
        const station = stationLists[currentTab].find(s => s.name === stationName);
        if (!station) return;
        
        stationLists[currentTab] = stationLists[currentTab].filter(s => s.name !== stationName);
        userAddedStations[currentTab] = userAddedStations[currentTab]?.filter(s => s.name !== stationName) || [];
        
        if (!station.isFromSearch && !deletedStations.includes(stationName)) {
          if (!Array.isArray(deletedStations)) deletedStations = [];
          deletedStations.push(stationName);
          localStorage.setItem("deletedStations", JSON.stringify(deletedStations));
        }
        
        localStorage.setItem("stationLists", JSON.stringify(stationLists));
        localStorage.setItem("userAddedStations", JSON.stringify(userAddedStations));
        favoriteStations = favoriteStations.filter(name => name !== stationName);
        localStorage.setItem("favoriteStations", JSON.stringify(favoriteStations));
        
        if (stationLists[currentTab].length === 0) {
          currentIndex = 0;
        } else if (currentIndex >= stationLists[currentTab].length) {
          currentIndex = stationLists[currentTab].length - 1;
        }
        switchTab(currentTab);
        showToast(`Станцію видалено`, "info");
      }
    }

    function changeStation(index) {
      if (!stationItems || index < 0 || index >= stationItems.length || stationItems[index].classList.contains("empty")) return;
      const item = stationItems[index];
      stationItems.forEach(i => i.classList.remove("selected"));
      item.classList.add("selected");
      currentIndex = index;
      
      // Анімація затемнення при зміні треку
      currentStationInfo.classList.add("fade-out");
      setTimeout(() => {
        updateCurrentStation(item);
        currentStationInfo.classList.remove("fade-out");
        currentStationInfo.classList.add("fade-in");
        setTimeout(() => currentStationInfo.classList.remove("fade-in"), 300);
      }, 150);
      
      localStorage.setItem(`lastStation_${currentTab}`, index);
      if (intendedPlaying) {
        const normalizedCurrentUrl = normalizeUrl(item.dataset.value);
        const normalizedAudioSrc = normalizeUrl(audio.src);
        if (normalizedAudioSrc !== normalizedCurrentUrl || audio.paused || audio.error || audio.readyState < 2 || audio.currentTime === 0) {
          isAutoPlayPending = false;
          debouncedTryAutoPlay();
        }
      }
    }

    function updateCurrentStation(item) {
      if (!currentStationInfo || !item.dataset) {
        resetStationInfo();
        return;
      }
      const stationNameElement = currentStationInfo.querySelector(".station-name");
      const stationGenreElement = currentStationInfo.querySelector(".station-genre");
      const stationCountryElement = currentStationInfo.querySelector(".station-country");
      const stationIconElement = currentStationInfo.querySelector(".station-icon");
      const currentTrackElement = document.getElementById("currentTrack");

      if (stationNameElement) stationNameElement.textContent = item.dataset.name || "";
      if (stationGenreElement) stationGenreElement.textContent = `жанр: ${item.dataset.genre || ""}`;
      if (stationCountryElement) stationCountryElement.textContent = `країна: ${item.dataset.country || ""}`;
      
      if (stationIconElement) {
        if (item.dataset.favicon && isValidUrl(item.dataset.favicon)) {
          stationIconElement.innerHTML = "";
          stationIconElement.style.backgroundImage = `url(${item.dataset.favicon})`;
          stationIconElement.style.backgroundSize = "contain";
          stationIconElement.style.backgroundRepeat = "no-repeat";
          stationIconElement.style.backgroundPosition = "center";
        } else {
          stationIconElement.innerHTML = "🎵";
          stationIconElement.style.backgroundImage = "none";
        }
      }

      if (currentTrackElement) {
        currentTrackElement.textContent = "🎵 Трек: завантаження...";
        currentTrackElement.classList.add("loading");
      }
      
      stopMetadataStreaming();
      
      if (isPlaying) {
        fetchTrackMetadata(item.dataset.value, item.dataset.name);
      }

      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: item.dataset.name || "Unknown Station",
          artist: `${item.dataset.genre || ""} | ${item.dataset.country || ""}`,
          album: "Radio Music S O",
          artwork: item.dataset.favicon && isValidUrl(item.dataset.favicon) ? [
            { src: item.dataset.favicon, sizes: "96x96", type: "image/png" },
            { src: item.dataset.favicon, sizes: "128x128", type: "image/png" },
            { src: item.dataset.favicon, sizes: "192x192", type: "image/png" },
            { src: item.dataset.favicon, sizes: "256x256", type: "image/png" },
            { src: item.dataset.favicon, sizes: "384x384", type: "image/png" },
            { src: item.dataset.favicon, sizes: "512x512", type: "image/png" }
          ] : []
        });
      }
    }

    function prevStation() {
      if (!stationItems?.length) return;
      currentIndex = currentIndex > 0 ? currentIndex - 1 : stationItems.length - 1;
      if (stationItems[currentIndex].classList.contains("empty")) currentIndex = 0;
      changeStation(currentIndex);
      provideHapticFeedback();
    }

    function nextStation() {
      if (!stationItems?.length) return;
      currentIndex = currentIndex < stationItems.length - 1 ? currentIndex + 1 : 0;
      if (stationItems[currentIndex].classList.contains("empty")) currentIndex = 0;
      changeStation(currentIndex);
      provideHapticFeedback();
    }

    function togglePlayPause() {
      if (!playPauseBtn || !audio) return;
      
      if (audio.paused) {
        isPlaying = true;
        intendedPlaying = true;
        debouncedTryAutoPlay();
        playPauseBtn.textContent = "⏸";
        playPauseBtn.setAttribute("aria-label", "Пауза");
        playPauseBtn.classList.add("playing");
        updateWaveVisualizer(true);
      } else {
        audio.pause();
        isPlaying = false;
        intendedPlaying = false;
        playPauseBtn.textContent = "▶";
        playPauseBtn.setAttribute("aria-label", "Грати");
        playPauseBtn.classList.remove("playing");
        updateWaveVisualizer(false);
        stopMetadataStreaming();
        const currentTrackElement = document.getElementById("currentTrack");
        if (currentTrackElement) {
          currentTrackElement.textContent = "🎵 Трек: невідомо";
          currentTrackElement.classList.remove("loading", "marquee");
        }
      }
      localStorage.setItem("isPlaying", isPlaying);
      localStorage.setItem("intendedPlaying", intendedPlaying);
    }

    const eventListeners = {
      keydown: e => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          prevStation();
          provideHapticFeedback();
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          nextStation();
          provideHapticFeedback();
        }
        if (e.key === " ") {
          e.preventDefault();
          togglePlayPause();
          provideHapticFeedback();
        }
        if (e.key === "Escape" && dragEnabled) {
          disableDragMode();
          showToast("Режим перетягування вимкнено", "info");
        }
      },
      visibilitychange: () => {
        if (document.hidden || !intendedPlaying || !navigator.onLine || !stationItems?.length || currentIndex >= stationItems.length) return;
        const normalizedCurrentUrl = normalizeUrl(stationItems[currentIndex].dataset.value);
        const normalizedAudioSrc = normalizeUrl(audio.src);
        if (normalizedAudioSrc !== normalizedCurrentUrl || audio.paused || audio.error || audio.readyState < 2 || audio.currentTime === 0) {
          isAutoPlayPending = false;
          debouncedTryAutoPlay();
        }
      },
      resume: () => {
        if (!intendedPlaying || !navigator.onLine || !stationItems?.length || currentIndex >= stationItems.length) return;
        const normalizedCurrentUrl = normalizeUrl(stationItems[currentIndex].dataset.value);
        const normalizedAudioSrc = normalizeUrl(audio.src);
        if (normalizedAudioSrc !== normalizedCurrentUrl || audio.paused || audio.error || audio.readyState < 2 || audio.currentTime === 0) {
          isAutoPlayPending = false;
          debouncedTryAutoPlay();
        }
      }
    };

    function addEventListeners() {
      document.addEventListener("keydown", eventListeners.keydown);
      document.addEventListener("visibilitychange", eventListeners.visibilitychange);
      document.addEventListener("resume", eventListeners.resume);
    }

    function removeEventListeners() {
      document.removeEventListener("keydown", eventListeners.keydown);
      document.removeEventListener("visibilitychange", eventListeners.visibilitychange);
      document.removeEventListener("resume", eventListeners.resume);
    }

    audio.addEventListener("playing", () => {
      isPlaying = true;
      playPauseBtn.textContent = "⏸";
      playPauseBtn.setAttribute("aria-label", "Пауза");
      playPauseBtn.classList.add("playing");
      updateWaveVisualizer(true);
      localStorage.setItem("isPlaying", isPlaying);
      if (errorTimeout) {
        clearTimeout(errorTimeout);
        errorTimeout = null;
      }
      if (stationItems && stationItems[currentIndex]) {
        fetchTrackMetadata(stationItems[currentIndex].dataset.value, stationItems[currentIndex].dataset.name);
      }
    });

    audio.addEventListener("pause", () => {
      isPlaying = false;
      playPauseBtn.textContent = "▶";
      playPauseBtn.setAttribute("aria-label", "Грати");
      playPauseBtn.classList.remove("playing");
      updateWaveVisualizer(false);
      localStorage.setItem("isPlaying", isPlaying);
      stopMetadataStreaming();
      const currentTrackElement = document.getElementById("currentTrack");
      if (currentTrackElement) {
        currentTrackElement.textContent = "🎵 Трек: невідомо";
        currentTrackElement.classList.remove("loading", "marquee");
      }
      if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
    });

    audio.addEventListener("error", () => {
      updateWaveVisualizer(false);
      playPauseBtn.classList.remove("playing");
      stopMetadataStreaming();
      const currentTrackElement = document.getElementById("currentTrack");
      if (currentTrackElement) {
        currentTrackElement.textContent = "🎵 Трек: помилка";
        currentTrackElement.classList.remove("loading", "marquee");
      }
      if (intendedPlaying && errorCount < ERROR_LIMIT && !errorTimeout) {
        errorCount++;
        errorTimeout = setTimeout(() => {
          debouncedTryAutoPlay();
          errorTimeout = null;
        }, 1000);
      } else if (errorCount >= ERROR_LIMIT) {
        resetStationInfo();
      }
    });

    audio.addEventListener("volumechange", () => {
      localStorage.setItem("volume", audio.volume);
    });

    audio.addEventListener("loadedmetadata", () => {
      // Не робимо нічого, метадані отримуємо через fetchTrackMetadata
    });

    window.addEventListener("online", () => {
      showToast("Мережу відновлено", "success");
      if (intendedPlaying && stationItems?.length && currentIndex < stationItems.length) {
        isAutoPlayPending = false;
        debouncedTryAutoPlay();
      }
    });

    window.addEventListener("offline", () => {
      showToast("З'єднання з мережею втрачено", "error");
      updateWaveVisualizer(false);
      playPauseBtn.classList.remove("playing");
      errorCount = 0;
      stopMetadataStreaming();
    });

    addEventListeners();

    window.addEventListener("beforeunload", () => {
      removeEventListeners();
      stopMetadataStreaming();
    });

    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("play", () => {
        if (!intendedPlaying) togglePlayPause();
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        if (isPlaying) togglePlayPause();
      });
      navigator.mediaSession.setActionHandler("previoustrack", prevStation);
      navigator.mediaSession.setActionHandler("nexttrack", nextStation);
    }

    applyTheme(currentTheme);
  }
});