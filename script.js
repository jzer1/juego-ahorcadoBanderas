// =================================================================
// FIREBASE SETUP (Mandatory Global Variables)
// =================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Global variables provided by the Canvas environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

let db, auth, userId;
let isAuthReady = false;

async function setupFirebase() {
    if (!firebaseConfig) {
        console.warn("Firebase configuration not found. Running in local session mode.");
        isAuthReady = true;
        return;
    }
    try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }
        
        userId = auth.currentUser?.uid || crypto.randomUUID();
        console.log("Firebase initialized. User ID:", userId);
        isAuthReady = true;
        
    } catch (error) {
        console.error("Error setting up Firebase:", error);
        isAuthReady = true;
    }
}

// =================================================================
// GAME LOGIC
// =================================================================

const CONTINENTS = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania'];
const MAX_TROOPS = 3;
const API_URL = 'https://restcountries.com/v3.1/region/';

// Game State
let gameState = {
    currentView: 'menu',
    continentStatus: {}, // e.g., { Africa: 'available', Europe: 'dominated' }
    currentStreak: 0,
    bestStreak: 0, // TODO: This should be saved with Firestore
    
    // In-Game State
    currentContinent: '',
    countries: [],      // All countries in the current continent
    dominated: [],      // List of country names already dominated
    currentCountry: null, // The country object currently being guessed
    targetWord: '',     // Cleaned country name (UPPERCASE)
    guessedLetters: new Set(),
    troops: MAX_TROOPS,
    isGameActive: false,
};

// DOM Elements
const $d = (id) => document.getElementById(id);
const elements = {
    // Views
    views: {
        menu: $d('menu-view'),
        continentSelect: $d('continent-select-view'),
        game: $d('game-view'),
        ranking: $d('ranking-view'),
    },
    
    // Menu
    startButton: $d('start-game-button'),
    rankingButton: $d('ranking-button'),
    
    // Map
    continentGrid: $d('continent-grid'),
    backToMenuFromMap: $d('back-to-menu-from-map'),
    
    // Ranking
    bestStreakDisplay: $d('best-streak-display'),
    backToMenuFromRanking: $d('back-to-menu-from-ranking'),

    // Game
    continentName: $d('continent-name'),
    dominatedCount: $d('dominated-count'),
    troopsDisplay: $d('troops-display'),
    streakDisplay: $d('streak-display'),
    backToMapButton: $d('back-to-map-button'),
    flagImage: $d('flag-image'),
    wordDisplay: $d('word-display'),
    keyboard: $d('keyboard'),
    messageArea: $d('message-area'),
    
    // Modal
    modal: $d('game-modal'),
    modalTitle: $d('modal-title'),
    modalBody: $d('modal-body'),
    modalButton: $d('modal-button'),
};

// --- Utility Functions ---

/**
 * Manages which view is visible.
 * @param {string} viewId - 'menu', 'continentSelect', 'game', or 'ranking'
 */
function showView(viewId) {
    Object.keys(elements.views).forEach(key => {
        elements.views[key].classList.add('hidden');
    });
    elements.views[viewId].classList.remove('hidden');
    gameState.currentView = viewId;
}

function cleanWord(name) {
    return name
        .toUpperCase()
        .replace(/\s*\(.*?\)\s*/g, '') 
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") 
        .replace(/[^A-Z\s]/g, '')
        .trim();
}

function getCountryKey(country) {
    return cleanWord(country.name.common) + country.area;
}

function showMessage(text, colorClass = 'text-white') {
    elements.messageArea.className = `h-8 text-center text-lg font-semibold mb-6 ${colorClass}`;
    elements.messageArea.textContent = text;
    setTimeout(() => {
        if (gameState.isGameActive) {
            elements.messageArea.textContent = '';
            elements.messageArea.className = 'h-8 text-center text-lg font-semibold mb-6';
        }
    }, 2500);
}

// --- Core Render Functions ---

function renderTroops() {
    const iconSize = 24;
    const troopIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shield text-red-500"><path d="M20 13c-1.47 0-2.3-1.07-3-2c-.7-.93-1.53-2-3-2c-1.47 0-2.3 1.07-3 2c-.7.93-1.53 2-3 2c-1.47 0-2.3-1.07-3-2c-.7-.93-1.53-2-3 2v6l1 1h16l1-1z"/></svg>`;
    const emptyIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shield-off text-gray-500"><path d="M19 6V5c0-1.7-1.3-3-3-3s-3 1.3-3 3v1"/><path d="M10.87 2.14a3 3 0 0 1 4.26 0"/><path d="M11 20H4l1-1V9"/><path d="m2 2 20 20"/><path d="M21 16V9L15 2H9l-2.09 2.15"/></svg>`;
    
    let html = '<span class="mr-2">Tropas:</span>';
    for (let i = 0; i < MAX_TROOPS; i++) {
        html += i < gameState.troops ? troopIcon : emptyIcon;
    }
    elements.troopsDisplay.innerHTML = html;
}

function renderStreak() {
    elements.streakDisplay.textContent = gameState.currentStreak;
    // Update best streak if current is higher
    if (gameState.currentStreak > gameState.bestStreak) {
        gameState.bestStreak = gameState.currentStreak;
        // TODO: Save to Firestore
    }
}

function renderWordDisplay() {
    // ... (función sin cambios)
    if (!gameState.targetWord) return;

    let html = gameState.targetWord.split('').map(char => {
        if (char === ' ') {
            return '<div class="mx-2 w-4 h-full"></div>'; // Space placeholder
        }
        const isGuessed = gameState.guessedLetters.has(char);
        const displayChar = isGuessed ? char : '_';
        return `<div class="letter-slot">${displayChar}</div>`;
    }).join('');

    elements.wordDisplay.innerHTML = html;
}

function renderKeyboard() {
    // ... (función sin cambios)
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let html = '';
    
    letters.split('').forEach(letter => {
        let statusClass = 'bg-gray-600 hover:bg-gray-500 text-white';
        let isDisabled = gameState.guessedLetters.has(letter);
        
        if (isDisabled) {
            if (gameState.targetWord.includes(letter)) {
                statusClass = 'guessed-correct';
            } else {
                statusClass = 'guessed-incorrect';
            }
        }

        html += `
            <button 
                class="keyboard-button ${statusClass} font-bold py-2 rounded-md uppercase"
                data-letter="${letter}"
                ${isDisabled ? 'disabled' : ''}
            >
                ${letter}
            </button>
        `;
    });
    elements.keyboard.innerHTML = html;

    // Attach event listeners to new buttons
    elements.keyboard.querySelectorAll('button:not(:disabled)').forEach(button => {
        button.onclick = () => guessLetter(button.dataset.letter);
    });
}

function renderContinentSelect() {
    const container = elements.continentGrid;
    container.innerHTML = '';
    const icons = {
        Africa: '🌍', Asia: '🌏', Americas: '🌎', Europe: '🌍', Oceania: '🌊'
    };
    
    CONTINENTS.forEach(continent => {
        const status = gameState.continentStatus[continent];
        const isDominated = status === 'dominated';
        
        const card = document.createElement('div');
        card.className = `continent-card p-6 text-center rounded-lg shadow-lg ${isDominated ? 'dominated' : ''}`;
        card.innerHTML = `
            <div class="text-5xl mb-4">${icons[continent] || '❓'}</div>
            <h3 class="text-2xl font-bold mb-2">${continent}</h3>
            <p class="font-semibold ${isDominated ? 'text-white' : 'text-green-400'}">
                ${isDominated ? '¡DOMINADO!' : 'Listo para la Invasión'}
            </p>
        `;
        
        if (!isDominated) {
            card.onclick = () => startGame(continent);
        }
        
        container.appendChild(card);
    });
}

function renderRanking() {
    elements.bestStreakDisplay.textContent = gameState.bestStreak;
}

// --- Game Flow Functions ---

function startGame(continent) {
    showView('game');
    elements.messageArea.textContent = `Cargando países de ${continent}...`;
    loadContinent(continent);
}

async function loadContinent(continent) {
    try {
        const response = await fetch(API_URL + continent.toLowerCase());
        if (!response.ok) throw new Error(`Error HTTP: ${response.status}`);
        
        const data = await response.json();
        
        gameState.countries = data
            .filter(c => c.name.common && c.flags.svg && c.population > 100000)
            .map(c => ({
                name: c.name.common,
                flag: c.flags.svg,
                key: getCountryKey(c),
                isDominated: false
            }));

        if (gameState.countries.length === 0) {
            throw new Error("No se encontraron países válidos.");
        }

        gameState.currentContinent = continent;
        gameState.dominated = [];
        
        elements.continentName.textContent = continent;
        elements.messageArea.textContent = '';
        
        newRound();

    } catch (error) {
        console.error("Error al cargar continente:", error);
        showMessage(`Error al cargar: ${error.message}.`, 'text-red-500');
        setTimeout(() => showView('continentSelect'), 2000); // Go back
    }
}

function newRound() {
    // Find a country that hasn't been dominated yet
    const availableCountries = gameState.countries.filter(c => !c.isDominated);

    if (availableCountries.length === 0) {
        handleContinentWin();
        return;
    }

    // Pick a random country
    const countryIndex = Math.floor(Math.random() * availableCountries.length);
    gameState.currentCountry = availableCountries[countryIndex];
    gameState.targetWord = cleanWord(gameState.currentCountry.name);
    gameState.guessedLetters.clear();
    gameState.troops = MAX_TROOPS;
    gameState.isGameActive = true;
    
    // Render everything for the new round
    elements.flagImage.src = gameState.currentCountry.flag;
    elements.flagImage.alt = `Bandera de un país en ${gameState.currentContinent}`;
    elements.dominatedCount.textContent = `${gameState.dominated.length}/${gameState.countries.length}`;
    
    renderTroops();
    renderStreak(); // Renders current streak
    renderWordDisplay();
    renderKeyboard();
    showMessage(`¡Dominación en ${gameState.currentContinent}!`, 'text-yellow-400');
}

function guessLetter(letter) {
    if (!gameState.isGameActive) return;
    
    const upperLetter = letter.toUpperCase();
    
    const button = elements.keyboard.querySelector(`[data-letter="${upperLetter}"]`);
    if (button) button.disabled = true;

    if (gameState.guessedLetters.has(upperLetter)) return;
    
    gameState.guessedLetters.add(upperLetter);

    if (gameState.targetWord.includes(upperLetter)) {
        // Correct guess
        showMessage('¡Correcto!', 'text-green-400');
        if (button) button.classList.add('guessed-correct');
        // Streak no se incrementa hasta ganar la palabra
    } else {
        // Incorrect guess
        gameState.troops--;
        showMessage('¡Incorrecto! Pierdes una tropa.', 'text-red-500');
        if (button) button.classList.add('guessed-incorrect');
        
        // Incorrect guess breaks the streak
        gameState.currentStreak = 0;
        renderStreak();
    }

    renderTroops();
    renderWordDisplay();

    checkGameStatus();
}

function checkGameStatus() {
    if (!gameState.isGameActive) return;
    
    const wordLetters = new Set(gameState.targetWord.replace(/\s/g, '').split(''));
    const correctlyGuessed = [...wordLetters].every(letter => gameState.guessedLetters.has(letter));

    if (correctlyGuessed) {
        // WIN COUNTRY
        gameState.isGameActive = false;
        
        // Increment streak
        gameState.currentStreak++;
        renderStreak(); // This also updates bestStreak
        
        const countryKey = gameState.currentCountry.key;
        const countryInList = gameState.countries.find(c => c.key === countryKey);
        if (countryInList) {
            countryInList.isDominated = true;
            gameState.dominated.push(countryInList.name);
        }

        elements.dominatedCount.textContent = `${gameState.dominated.length}/${gameState.countries.length}`;
        
        handleModal(
            `¡País Dominado!`,
            `Has adivinado ${gameState.currentCountry.name}. ¡Racha actual: ${gameState.currentStreak}!`,
            'bg-green-600 hover:bg-green-700',
            newRound
        );

    } else if (gameState.troops <= 0) {
        // LOSE GAME
        gameState.isGameActive = false;
        
        // Streak was already reset on the incorrect guess
        
        handleModal(
            '¡Derrota de Tropas!',
            `El país era: ${gameState.currentCountry.name}. Has perdido tus tropas. Debes reagruparte.`,
            'bg-red-600 hover:bg-red-700',
            newRound // Restart on the same continent
        );
    }
}

function handleContinentWin() {
    // Mark continent as dominated
    gameState.continentStatus[gameState.currentContinent] = 'dominated';
    
    // Check for global victory
    const allDominated = CONTINENTS.every(c => gameState.continentStatus[c] === 'dominated');
    
    if (allDominated) {
         handleModal(
            '¡VICTORIA GLOBAL!',
            '¡Felicidades! Has dominado todos los continentes. ¡Tu racha final es increíble!',
            'bg-yellow-500 hover:bg-yellow-600',
            () => {
                initializeAppUI(); // Reset game
                showView('menu');
            }
        );
    } else {
        handleModal(
            '¡Continente Conquistado!',
            `Has dominado ${gameState.currentContinent}. ¡Vuelve al mapa para elegir tu próximo objetivo!`,
            'bg-blue-600 hover:bg-blue-700',
            () => {
                renderContinentSelect(); // Update map UI
                showView('continentSelect');
            }
        );
    }
}

function handleModal(title, body, buttonClass, action) {
    elements.modalTitle.textContent = title;
    elements.modalBody.textContent = body;
    elements.modalButton.className = `btn ${buttonClass}`; // Tailwind classes added here
    elements.modalButton.onclick = () => {
        elements.modal.classList.add('opacity-0', 'invisible');
        action();
    };
    
    elements.modal.classList.remove('invisible', 'opacity-0');
    elements.modal.classList.add('opacity-100');
}

function initializeAppUI() {
    // Initialize continent statuses
    CONTINENTS.forEach(continent => {
        if (!gameState.continentStatus[continent]) {
            gameState.continentStatus[continent] = 'available';
        }
    });

    // Attach menu listeners
    elements.startButton.onclick = () => showView('continentSelect');
    elements.rankingButton.onclick = () => {
        renderRanking();
        showView('ranking');
    };
    
    // Attach map listeners
    elements.backToMenuFromMap.onclick = () => showView('menu');

    // Attach ranking listeners
    elements.backToMenuFromRanking.onclick = () => showView('menu');
    
    // Attach game listeners
    elements.backToMapButton.onclick = () => {
        gameState.isGameActive = false; // Stop current game
        gameState.currentStreak = 0; // Reset streak when quitting
        renderContinentSelect(); // Update map (in case one was dominated)
        showView('continentSelect');
    };
    
    // Render dynamic content
    renderContinentSelect();
    
    // Show first view
    showView('menu');
}

// --- Event Listeners and Initialization ---

window.onload = function() {
    // Start Firebase setup
    setupFirebase();
    
    const checkAuthInterval = setInterval(() => {
        if (isAuthReady) {
            clearInterval(checkAuthInterval);
            // TODO: Load gameState.bestStreak and gameState.continentStatus from Firestore
            
            // Initialize the UI
            initializeAppUI();
        }
    }, 100);

    // Listen for physical keyboard input
    document.addEventListener('keydown', (e) => {
        if (gameState.currentView === 'game' && gameState.isGameActive) {
            const letter = e.key.toUpperCase();
            if (letter.length === 1 && letter.match(/[A-Z]/)) {
                const button = elements.keyboard.querySelector(`[data-letter="${letter}"]`);
                if (button && !button.disabled) {
                    button.click(); 
                }
            }
        }
    });
};