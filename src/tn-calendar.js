// ── Tamil Calendar Engine (Fully Dynamic) ────────────────────────────────
// Offline-first: All dates computed algorithmically. No hardcoded year limits.
// Provides: Tamil month/date, Moon phases (Amavasai/Pournami/Ekadashi),
//           Festivals & government holidays for TN.
//
// Accuracy:
// • Tamil month starts    — ±1 day (approximate solar ingress)
// • Hindu lunar festivals — ±1 day (synodic month approximation)
// • Islamic festivals     — ±1–2 days (Hijri year projection)
// • Easter / Good Friday  — Exact (Computus algorithm)
// • Fixed-date holidays   — Exact

// ── Tamil Months ──────────────────────────────────────────────────────────

const TAMIL_MONTHS = [
  { name: "சித்திரை", nameEn: "Chithirai", short: "சித்" },
  { name: "வைகாசி", nameEn: "Vaigasi", short: "வை" },
  { name: "ஆனி", nameEn: "Aani", short: "ஆனி" },
  { name: "ஆடி", nameEn: "Aadi", short: "ஆடி" },
  { name: "ஆவணி", nameEn: "Aavani", short: "ஆவ" },
  { name: "புரட்டாசி", nameEn: "Purattasi", short: "புர" },
  { name: "ஐப்பசி", nameEn: "Aippasi", short: "ஐப்" },
  { name: "கார்த்திகை", nameEn: "Karthigai", short: "கார்" },
  { name: "மார்கழி", nameEn: "Margazhi", short: "மார்" },
  { name: "தை", nameEn: "Thai", short: "தை" },
  { name: "மாசி", nameEn: "Masi", short: "மாசி" },
  { name: "பங்குனி", nameEn: "Panguni", short: "பங்" },
];

// ── Dynamic Tamil Month Start Dates ──────────────────────────────────────
// Approximate solar ingress dates — stable to ±1 day across centuries.
// [gregorianMonth (1-indexed), approximateDay, tamilMonthIndex]
// Months 1–3 fall in the NEXT Gregorian year relative to the Tamil year start.

const _MONTH_TEMPLATES = [
  [4, 14, 0],   // Chithirai  (Mesha Sankranti)
  [5, 15, 1],   // Vaigasi
  [6, 15, 2],   // Aani
  [7, 17, 3],   // Aadi
  [8, 17, 4],   // Aavani
  [9, 17, 5],   // Purattasi
  [10, 18, 6],  // Aippasi
  [11, 17, 7],  // Karthigai
  [12, 16, 8],  // Margazhi
  [1, 14, 9],   // Thai        (next Gregorian year)
  [2, 13, 10],  // Masi        (next Gregorian year)
  [3, 14, 11],  // Panguni     (next Gregorian year)
];

const _tamilStartsCache = new Map();

/**
 * Get Tamil month start dates for a Tamil year (starts in April).
 * @param {number} tamilYearStart — Gregorian year when Chithirai begins
 * @returns {Array<{dateKey: string, monthIndex: number}>}
 */
function _getTamilMonthStarts(tamilYearStart) {
  if (_tamilStartsCache.has(tamilYearStart)) return _tamilStartsCache.get(tamilYearStart);

  // Bound cache size
  if (_tamilStartsCache.size >= 10) {
    const oldest = _tamilStartsCache.keys().next().value;
    _tamilStartsCache.delete(oldest);
  }

  const starts = [];
  for (const [gMonth, gDay, tIdx] of _MONTH_TEMPLATES) {
    const gYear = gMonth >= 4 ? tamilYearStart : tamilYearStart + 1;
    const dk = `${gYear}-${String(gMonth).padStart(2, "0")}-${String(gDay).padStart(2, "0")}`;
    starts.push({ dateKey: dk, monthIndex: tIdx });
  }

  _tamilStartsCache.set(tamilYearStart, starts);
  return starts;
}

/**
 * Get the Tamil date for a Gregorian date.
 * @param {string} dateKey — "YYYY-MM-DD"
 * @returns {{ month: object, monthIndex: number, tamilDay: number, tamilYear: string } | null}
 */
export function getTamilDate(dateKey) {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  const day = Number(dateKey.slice(8, 10));

  // Tamil year starts Apr 14. Determine which Tamil year this date falls in.
  const tamilYearStart = (month > 4 || (month === 4 && day >= 14)) ? year : year - 1;

  // Search current Tamil year, then fall back to previous if needed
  for (const tyStart of [tamilYearStart, tamilYearStart - 1]) {
    const starts = _getTamilMonthStarts(tyStart);
    let best = null;
    for (const s of starts) {
      if (s.dateKey <= dateKey) best = s;
    }
    if (best) {
      const startDate = new Date(best.dateKey + "T00:00:00");
      const targetDate = new Date(dateKey + "T00:00:00");
      const tamilDay = Math.floor((targetDate - startDate) / 86400000) + 1;
      const tamilYear = _getTamilYearName(tamilYearStart);

      return {
        month: TAMIL_MONTHS[best.monthIndex],
        monthIndex: best.monthIndex,
        tamilDay,
        tamilYear,
      };
    }
  }
  return null;
}

/** 60-year cycle Tamil year names */
function _getTamilYearName(gregorianYear) {
  const names = [
    "பிரபவ", "விபவ", "சுக்ல", "பிரமோதூத", "பிரஜோத்பத்தி",
    "ஆங்கீரச", "ஸ்ரீமுக", "பவ", "யுவ", "தாது",
    "ஈஸ்வர", "வெகுதான்ய", "பிரமாதி", "விக்ரம", "விஷு",
    "சித்திரபானு", "சுபானு", "தாரண", "பார்த்திப", "விய",
    "சர்வஜித்", "சர்வதாரி", "விரோதி", "விக்ருதி", "கர",
    "நந்தன", "விஜய", "ஜய", "மன்மத", "துர்முகி",
    "ஹேவிளம்பி", "விளம்பி", "விகாரி", "சார்வரி", "பிலவ",
    "சுபகிருது", "சோபகிருது", "குரோதி", "விசுவாவசு", "பராபவ",
    "பிலவங்க", "கீலக", "சௌமிய", "சாதாரண", "விரோதகிருது",
    "பரிதாபி", "பிரமாதீச", "ஆனந்த", "ராட்சச", "நள",
    "பிங்கள", "காளயுக்தி", "சித்தார்த்தி", "ரௌத்ரி", "துன்மதி",
    "துந்துபி", "ருத்ரோத்காரி", "ரக்தாட்சி", "குரோதன", "அட்சய",
  ];
  const index = ((gregorianYear - 2000 + 37) % 60 + 60) % 60;
  return names[index] || "";
}

// ── Moon Phase Engine ─────────────────────────────────────────────────────

// Reference new moon: Jan 29, 2025 12:36 UTC
const REF_NEW_MOON = new Date(Date.UTC(2025, 0, 29, 12, 36, 0)).getTime();
const SYNODIC_MONTH = 29.530588853; // days
const SYNODIC_MS = SYNODIC_MONTH * 86400000;

/**
 * Get moon age in days (0 = New Moon, ~14.77 = Full Moon)
 * @param {string} dateKey — "YYYY-MM-DD"
 * @returns {number} days since last new moon (0–29.53)
 */
export function getMoonAge(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const target = new Date(y, m - 1, d, 12, 0, 0).getTime();
  const age = ((target - REF_NEW_MOON) % SYNODIC_MS + SYNODIC_MS) % SYNODIC_MS;
  return age / 86400000;
}

/**
 * Get the moon phase info for a date.
 * @param {string} dateKey — "YYYY-MM-DD"
 * @returns {{ phase: string, emoji: string, nameTA: string, nameEn: string, isSpecial: boolean }}
 */
export function getMoonPhase(dateKey) {
  const age = getMoonAge(dateKey);

  if (age < 1 || age > SYNODIC_MONTH - 1) {
    return { phase: "new", emoji: "🌑", nameTA: "அமாவாசை", nameEn: "Amavasai", isSpecial: true };
  }
  if (age >= 13.77 && age <= 15.77) {
    return { phase: "full", emoji: "🌕", nameTA: "பௌர்ணமி", nameEn: "Pournami", isSpecial: true };
  }
  if (age < 7.38) {
    return { phase: "waxing-crescent", emoji: "🌒", nameTA: "வளர்பிறை", nameEn: "Waxing Crescent", isSpecial: false };
  }
  if (age < 11.07) {
    return { phase: "first-quarter", emoji: "🌓", nameTA: "வளர்பிறை அரை", nameEn: "First Quarter", isSpecial: false };
  }
  if (age < 13.77) {
    return { phase: "waxing-gibbous", emoji: "🌔", nameTA: "வளர்பிறை முக்கால்", nameEn: "Waxing Gibbous", isSpecial: false };
  }
  if (age < 22.15) {
    return { phase: "waning-gibbous", emoji: "🌖", nameTA: "தேய்பிறை முக்கால்", nameEn: "Waning Gibbous", isSpecial: false };
  }
  if (age < 25.84) {
    return { phase: "last-quarter", emoji: "🌗", nameTA: "தேய்பிறை அரை", nameEn: "Last Quarter", isSpecial: false };
  }
  return { phase: "waning-crescent", emoji: "🌘", nameTA: "தேய்பிறை", nameEn: "Waning Crescent", isSpecial: false };
}

/**
 * Get Thithi (lunar day) — important for Tamil panchang
 * @param {string} dateKey
 * @returns {{ thithi: number, paksha: "shukla"|"krishna", pakshaTA: string, name: string, dayInPaksha: number, isEkadashi: boolean, isPradosham: boolean, isChaturthi: boolean }}
 */
export function getThithi(dateKey) {
  const age = getMoonAge(dateKey);
  const thithiAngle = age / SYNODIC_MONTH * 30;
  const thithiNum = Math.floor(thithiAngle) + 1;

  const paksha = thithiNum <= 15 ? "shukla" : "krishna";
  const dayInPaksha = thithiNum <= 15 ? thithiNum : thithiNum - 15;

  const thithiNames = [
    "பிரதமை", "துவிதியை", "திருதியை", "சதுர்த்தி", "பஞ்சமி",
    "சஷ்டி", "சப்தமி", "அஷ்டமி", "நவமி", "தசமி",
    "ஏகாதசி", "துவாதசி", "திரயோதசி", "சதுர்த்தசி",
    paksha === "shukla" ? "பௌர்ணமி" : "அமாவாசை",
  ];

  return {
    thithi: thithiNum,
    paksha,
    pakshaTA: paksha === "shukla" ? "வளர்பிறை" : "தேய்பிறை",
    name: thithiNames[dayInPaksha - 1] || "",
    dayInPaksha,
    isEkadashi: dayInPaksha === 11,
    isPradosham: dayInPaksha === 13,
    isChaturthi: dayInPaksha === 4,
  };
}


// ── Festival Computation Engine ──────────────────────────────────────────

/** Format a Date object to "YYYY-MM-DD" */
function _dk(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Add n days to a dateKey string, return new dateKey */
function _addDays(dateKey, n) {
  const d = new Date(dateKey + "T00:00:00");
  d.setDate(d.getDate() + n);
  return _dk(d);
}

/**
 * Find the date closest to a moon phase within a search window.
 * Returns the single best match (minimizes distance from ideal phase).
 * @param {"new"|"full"} phase
 * @param {string} from — "YYYY-MM-DD"
 * @param {string} to   — "YYYY-MM-DD"
 * @returns {string|null} dateKey of best match
 */
function _findPhase(phase, from, to) {
  const d = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  let bestDk = null;
  let bestDist = Infinity;

  while (d <= end) {
    const dk = _dk(d);
    const age = getMoonAge(dk);
    const dist = phase === "new"
      ? Math.min(age, SYNODIC_MONTH - age)   // distance from age 0
      : Math.abs(age - SYNODIC_MONTH / 2);   // distance from full moon
    if (dist < bestDist && dist < 1.5) {
      bestDist = dist;
      bestDk = dk;
    }
    d.setDate(d.getDate() + 1);
  }
  return bestDk;
}

/**
 * Find the first date matching a specific thithi in a date range.
 * @param {"shukla"|"krishna"} paksha
 * @param {number} dayInPaksha — 1–15
 * @param {string} from — "YYYY-MM-DD"
 * @param {string} to   — "YYYY-MM-DD"
 * @returns {string|null} dateKey of first match
 */
function _findThithi(paksha, dayInPaksha, from, to) {
  const d = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  while (d <= end) {
    const dk = _dk(d);
    const t = getThithi(dk);
    if (t.paksha === paksha && t.dayInPaksha === dayInPaksha) return dk;
    d.setDate(d.getDate() + 1);
  }
  return null;
}

/**
 * Compute Easter Sunday for any year (Anonymous Gregorian Computus).
 * Exact for all years in the Gregorian calendar.
 * @param {number} year
 * @returns {Date}
 */
function _easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/**
 * Project an Islamic festival date to a target Gregorian year.
 * Uses known 2026 reference dates + Hijri year length (~354.367 days).
 * Accuracy: ±1–2 days. Handles year-boundary wrap-around.
 * @param {Date} refDate — known Gregorian date of the festival in 2026
 * @param {number} targetYear
 * @returns {string|null} dateKey
 */
function _islamicFestival(refDate, targetYear) {
  const refYear = refDate.getFullYear();
  const baseOffset = targetYear - refYear;
  // Try offsets around the expected Hijri year count to handle year boundaries
  for (let n = baseOffset - 1; n <= baseOffset + 1; n++) {
    const d = new Date(refDate);
    d.setDate(d.getDate() + Math.round(n * 354.36667));
    if (d.getFullYear() === targetYear) return _dk(d);
  }
  return null;
}

// Islamic festival reference dates (known for 2026)
const _ISLAMIC_REF = {
  eidFitr:   new Date(2026, 3, 30),  // Eid ul-Fitr:   Apr 30, 2026
  bakrid:    new Date(2026, 5, 7),   // Bakrid:        Jun 7, 2026
  muharram:  new Date(2026, 6, 6),   // Muharram:      Jul 6, 2026
  miladNabi: new Date(2026, 8, 5),   // Milad un-Nabi: Sep 5, 2026
};


// ── Year Events Cache & Computation ──────────────────────────────────────

const _eventsCache = new Map();
const _MAX_CACHE_YEARS = 5; // Keep at most 5 years cached to bound memory

/**
 * Compute all public holidays & festivals for a Gregorian year.
 * Results are cached (LRU eviction at 5 years) — first call per year
 * triggers computation, subsequent calls return the same object instantly.
 * @param {number} year
 * @returns {Object<string, CalendarEvent[]>}
 */
function _computeYearEvents(year) {
  if (_eventsCache.has(year)) return _eventsCache.get(year);
  // Evict oldest entry if cache is full
  if (_eventsCache.size >= _MAX_CACHE_YEARS) {
    const oldest = _eventsCache.keys().next().value;
    _eventsCache.delete(oldest);
  }
  const E = {};

  function add(dk, name, nameTA, type, emoji) {
    if (!dk) return;
    if (!E[dk]) E[dk] = [];
    E[dk].push({ name, nameTA, type, emoji });
  }

  const Y = String(year);

  // ── Fixed Gregorian Date Holidays ──────────────────────────────────────

  add(`${Y}-01-01`, "New Year",             "புத்தாண்டு",              "government", "🎉");
  add(`${Y}-01-14`, "Pongal",               "பொங்கல்",                "festival",   "🎍");
  add(`${Y}-01-15`, "Thiruvalluvar Day",     "திருவள்ளுவர் தினம்",       "government", "📚");
  add(`${Y}-01-16`, "Uzhavar Thirunal",      "உழவர் திருநாள்",          "government", "🌾");
  add(`${Y}-01-17`, "Kaanum Pongal",         "காணும் பொங்கல்",          "festival",   "🐂");
  add(`${Y}-01-26`, "Republic Day",          "குடியரசு தினம்",           "national",   "🇮🇳");
  add(`${Y}-04-14`, "Tamil New Year",        "தமிழ்ப் புத்தாண்டு",       "festival",   "🌅");
  add(`${Y}-04-14`, "Dr. Ambedkar Jayanti",  "அம்பேத்கர் ஜெயந்தி",      "government", "⚖️");
  add(`${Y}-05-01`, "May Day",               "தொழிலாளர் தினம்",         "government", "✊");
  add(`${Y}-07-17`, "Periyar Birthday",      "பெரியார் பிறந்த நாள்",    "regional",   "🎂");
  add(`${Y}-08-15`, "Independence Day",      "சுதந்திர தினம்",          "national",   "🇮🇳");
  add(`${Y}-10-02`, "Gandhi Jayanti",        "காந்தி ஜெயந்தி",          "national",   "🕊️");
  add(`${Y}-12-25`, "Christmas",             "கிறிஸ்துமஸ்",             "government", "🎄");

  // ── Hindu Lunar Festivals (computed from moon engine) ──────────────────

  // Maha Shivaratri: Krishna Chaturdashi in Masi/Phalguna (Feb–Mar)
  add(_findThithi("krishna", 14, `${Y}-02-10`, `${Y}-03-10`),
    "Maha Shivaratri", "மகா சிவராத்திரி", "festival", "🙏");

  // Holi: Phalguna Pournami — full moon in Feb–Mar
  add(_findPhase("full", `${Y}-02-20`, `${Y}-03-22`),
    "Holi", "ஹோலி", "festival", "🎨");

  // Buddha Purnima: Vaigasi Pournami — full moon in Apr–May
  add(_findPhase("full", `${Y}-04-22`, `${Y}-05-22`),
    "Buddha Purnima", "புத்த பூர்ணிமா", "government", "☸️");

  // Krishna Jayanthi: Krishna Ashtami in Bhadrapada (Aug–Sep)
  // Anchor on Shravan/Aavani full moon, then find Krishna Ashtami after it
  const shravanPournami = _findPhase("full", `${Y}-07-20`, `${Y}-08-20`);
  if (shravanPournami) {
    const kj = _findThithi("krishna", 8, shravanPournami, _addDays(shravanPournami, 14));
    if (kj) add(kj, "Krishna Jayanthi", "கிருஷ்ண ஜெயந்தி", "festival", "🦚");
  }

  // Vinayagar Chaturthi: Shukla Chaturthi in Bhadrapada (Aug–Sep)
  // Anchor on Bhadrapada Amavasai (new moon in late Aug–Sep)
  const bhadrapadaAmav = _findPhase("new", `${Y}-08-20`, `${Y}-09-20`);
  if (bhadrapadaAmav) {
    const vc = _findThithi("shukla", 4, bhadrapadaAmav, _addDays(bhadrapadaAmav, 10));
    if (vc) add(vc, "Vinayagar Chaturthi", "விநாயகர் சதுர்த்தி", "festival", "🐘");
  }

  // Navaratri → Ayudha Pooja → Vijayadashami (Sep–Oct)
  // Anchor on Sharad Amavasai (new moon in Purattasi/Ashwin period)
  const sharadAmav = _findPhase("new", `${Y}-09-15`, `${Y}-10-15`);
  if (sharadAmav) {
    const nStart = _addDays(sharadAmav, 1); // Shukla Prathamai
    add(nStart, "Navaratri", "நவராத்திரி", "festival", "🪔");
    add(_addDays(nStart, 8), "Ayudha Pooja", "ஆயுத பூஜை", "festival", "🔧");
    add(_addDays(nStart, 9), "Vijayadashami", "விஜயதசமி", "festival", "🏆");
  }

  // Diwali: Aippasi/Kartik Amavasai (new moon in Oct–Nov)
  const diwaliAmav = _findPhase("new", `${Y}-10-15`, `${Y}-11-15`);
  if (diwaliAmav) {
    add(diwaliAmav, "Diwali", "தீபாவளி", "festival", "🪔");
    add(_addDays(diwaliAmav, 1), "Diwali Holiday", "தீபாவளி விடுமுறை", "government", "🎆");
  }

  // Karthigai Deepam: Pournami in Karthigai month (Nov–Dec)
  add(_findPhase("full", `${Y}-11-10`, `${Y}-12-10`),
    "Karthigai Deepam", "கார்த்திகை தீபம்", "festival", "🔥");

  // ── Easter / Good Friday (Computus — exact) ────────────────────────────

  const easterDate = _easter(year);
  const goodFriday = new Date(easterDate);
  goodFriday.setDate(easterDate.getDate() - 2);
  add(_dk(goodFriday), "Good Friday", "புனித வெள்ளி", "government", "✝️");

  // ── Islamic Festivals (projected from 2026 reference, ±1–2 days) ───────

  add(_islamicFestival(_ISLAMIC_REF.eidFitr, year),
    "Eid ul-Fitr", "ரமலான் பெருநாள்", "festival", "🌙");
  add(_islamicFestival(_ISLAMIC_REF.bakrid, year),
    "Bakrid", "பக்ரீத்", "festival", "🐑");
  add(_islamicFestival(_ISLAMIC_REF.muharram, year),
    "Muharram", "முஹர்ரம்", "festival", "🏴");
  add(_islamicFestival(_ISLAMIC_REF.miladNabi, year),
    "Milad un-Nabi", "நபிகள் நாயகம் பிறந்த நாள்", "festival", "🌙");

  _eventsCache.set(year, E);
  return E;
}


// ── Personal Events (recurring yearly) ──────────────────────────────────

/**
 * @typedef {Object} CalendarEvent
 * @property {string} name
 * @property {string} [nameTA]
 * @property {"festival"|"government"|"national"|"regional"|"birthday"|"anniversary"} type
 * @property {string} [emoji]
 */

const BIRTHDAYS = [
  { month: 1,  day: 12, name: "Dad's Birthday",           nameTA: "அப்பா பிறந்தநாள்" },
  { month: 2,  day: 4,  name: "Boopathi Mama Birthday",   nameTA: "பூபதி மாமா பிறந்தநாள்" },
  { month: 8,  day: 22, name: "Siva Birthday",            nameTA: "சிவா பிறந்தநாள்" },
  { month: 9,  day: 29, name: "Mom's Birthday",           nameTA: "அம்மா பிறந்தநாள்" },
  { month: 10, day: 4,  name: "Srija Birthday",           nameTA: "ஸ்ரீஜா பிறந்தநாள்" },
  { month: 10, day: 23, name: "Akka Birthday",            nameTA: "அக்கா பிறந்தநாள்" },
  { month: 11, day: 15, name: "Sangeetha Birthday",       nameTA: "சங்கீதா பிறந்தநாள்" },
  { month: 11, day: 24, name: "Vijay Birthday",           nameTA: "விஜய் பிறந்தநாள்" },
];

const ANNIVERSARIES = [
  { month: 8, day: 30, name: "Appa Amma Wedding Day",         nameTA: "அப்பா அம்மா திருமண நாள்" },
  { month: 8, day: 31, name: "Akka Mama Wedding Day",         nameTA: "அக்கா மாமா திருமண நாள்" },
  // Wedding on Feb 18, 2027 → recurring anniversary from 2028+
  { month: 2, day: 18, name: "Vijay & Sangeetha Anniversary", nameTA: "விஜய் & சங்கீதா திருமண நாள்", startYear: 2028 },
];

// One-time special dates (not recurring)
const SPECIAL_DATES = [
  { year: 2027, month: 2, day: 18, name: "Vijay & Sangeetha Wedding", nameTA: "விஜய் & சங்கீதா திருமணம்", type: "anniversary", emoji: "💍" },
];

/**
 * Get personal recurring events (birthdays & anniversaries) for a date.
 * Works for ANY year — no hardcoded year list.
 */
function getPersonalEvents(dateKey) {
  const year = Number(dateKey.slice(0, 4));
  const mm = Number(dateKey.slice(5, 7));
  const dd = Number(dateKey.slice(8, 10));
  const result = [];

  for (const b of BIRTHDAYS) {
    if (b.month === mm && b.day === dd) {
      result.push({ name: b.name, nameTA: b.nameTA, type: "birthday", emoji: "🎂" });
    }
  }
  for (const a of ANNIVERSARIES) {
    if (a.month === mm && a.day === dd) {
      if (a.startYear && year < a.startYear) continue;
      result.push({ name: a.name, nameTA: a.nameTA, type: "anniversary", emoji: "💞" });
    }
  }
  for (const s of SPECIAL_DATES) {
    if (s.year === year && s.month === mm && s.day === dd) {
      result.push({ name: s.name, nameTA: s.nameTA, type: s.type, emoji: s.emoji });
    }
  }
  return result;
}


// ── Public API ──────────────────────────────────────────────────────────

export function getEventsForDate(dateKey) {
  const year = Number(dateKey.slice(0, 4));
  const yearEvents = _computeYearEvents(year);
  const fixed = yearEvents[dateKey] || [];
  const personal = getPersonalEvents(dateKey);
  return personal.length ? [...fixed, ...personal] : fixed;
}

export function getEventsForMonth(monthKey) {
  const map = new Map();
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));

  // Public holidays/festivals (dynamically computed)
  const yearEvents = _computeYearEvents(year);
  for (const [dk, events] of Object.entries(yearEvents)) {
    if (dk.startsWith(monthKey)) map.set(dk, [...events]);
  }

  // Recurring personal events — check every day in the month
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const dk = `${monthKey}-${String(d).padStart(2, "0")}`;
    const personal = getPersonalEvents(dk);
    if (personal.length) {
      if (map.has(dk)) map.get(dk).push(...personal);
      else map.set(dk, personal);
    }
  }
  return map;
}

// ── Combined Day Info ────────────────────────────────────────────────────

/**
 * Get all Tamil calendar info for a single day.
 * @param {string} dateKey — "YYYY-MM-DD"
 * @returns {{ tamilDate: object|null, moon: object, thithi: object, events: CalendarEvent[] }}
 */
export function getDayInfo(dateKey) {
  return {
    tamilDate: getTamilDate(dateKey),
    moon: getMoonPhase(dateKey),
    thithi: getThithi(dateKey),
    events: getEventsForDate(dateKey),
  };
}

/**
 * Get a compact Tamil date label for heatmap cells.
 * @param {string} dateKey
 * @returns {string} e.g. "கார் 03" or ""
 */
export function getTamilDateShort(dateKey) {
  const td = getTamilDate(dateKey);
  if (!td) return "";
  return `${td.month.short} ${String(td.tamilDay).padStart(2, "0")}`;
}

/**
 * Get the Tamil month names that overlap a Gregorian month.
 * e.g. November 2026 → "ஐப்பசி / கார்த்திகை"
 * @param {number} year
 * @param {number} month — 1-indexed
 * @returns {{ label: string, year: string }}
 */
export function getTamilMonthsForGregorianMonth(year, month) {
  const firstDk = `${year}-${String(month).padStart(2, "0")}-01`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const lastDk = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;

  const firstTamil = getTamilDate(firstDk);
  const lastTamil = getTamilDate(lastDk);

  if (!firstTamil || !lastTamil) return { label: "", year: "" };

  const tamilYear = lastTamil.tamilYear;

  if (firstTamil.monthIndex === lastTamil.monthIndex) {
    return { label: firstTamil.month.name, year: tamilYear };
  }
  return { label: `${firstTamil.month.name} / ${lastTamil.month.name}`, year: tamilYear };
}
