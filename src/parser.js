const CATEGORY_RULES = [
  {
    category: "Groceries",
    words: [
      "grocery", "groceries", "vegetable", "vegetables", "milk", "supermarket",
      "rice", "dal", "oil", "flour", "sugar", "salt", "egg", "eggs", "curd",
      "butter", "ghee", "atta", "maida", "wheat", "pulses",
      "orange", "apple", "banana", "mango", "grapes", "fruits", "fruit",
      "onion", "tomato", "potato",
      // Tanglish - Groceries & Kitchen
      "arisi", "paruppu", "ennai", "kadalai", "ellu", "thengai",
      "maavu", "sakkarai", "uppu", "paal", "thayir", "vennai", "nei",
      "muttai", "mor", "rasam", "sambar",
      // Tanglish - Vegetables & Fruits
      "kaai", "keerai", "vengayam", "thakkali", "urulaikilangu",
      "pazham", "vaazhaipazham", "maadhulai", "koyyapazham",
      "drumstick", "murungakkai", "kathirikai", "vendakkai",
      // Tanglish - Market/Shop
      "santhai", "santhaiyil", "maligai", "provision",
      // Tanglish - Cattle/Farm supplies
      "punnakku", "thavidu", "vaikkol", "thaaniyam"
    ]
  },
  {
    category: "Food",
    words: [
      "breakfast", "lunch", "dinner", "food", "snack", "snacks",
      "tea", "coffee", "restaurant", "swiggy", "zomato", "hotel",
      "biryani", "biriyani", "pizza", "burger", "noodles", "parcel",
      // Tanglish - Food
      "saapadu", "sapadu", "tiffin", "dosai", "dosa", "idli", "idly",
      "parotta", "chapathi", "poori", "pongal", "upma", "vadai",
      "bajji", "bonda", "murukku", "mixture", "chips",
      "kaapi", "theneer", "juice", "lassi", "buttermilk",
      "mess", "kadai saapadu", "saapaadu"
    ]
  },
  {
    category: "Transport",
    words: [
      "petrol", "diesel", "fuel", "bus", "train", "taxi", "uber",
      "ola", "auto", "parking", "toll", "travel",
      // Tanglish
      "vandy", "vandi", "bike", "scooter",
      "bus ticket", "train ticket",
      "perundhu", "reyil", "vaadagai"
    ]
  },
  {
    category: "Bills",
    words: [
      "electricity", "current bill", "water bill", "internet", "wifi",
      "mobile bill", "recharge", "rent", "emi", "gas bill",
      // Tanglish
      "current", "kaasu", "thண்ணீர்", "vaadasai", "vaadagai",
      "cylinder", "gas"
    ]
  },
  {
    category: "Shopping",
    words: [
      "shopping", "dress", "shirt", "shoe", "shoes", "amazon", "flipkart",
      // Tanglish
      "thunி", "pudhu dress", "saree", "sattai", "lungi", "chappal"
    ]
  },
  {
    category: "Health",
    words: [
      "medicine", "medical", "doctor", "hospital", "pharmacy", "health",
      // Tanglish
      "marundhu", "maatthirai", "clinic", "lab", "test", "scan"
    ]
  },
  {
    category: "Education",
    words: [
      "course", "book", "books", "school", "college", "training", "exam",
      // Tanglish
      "fees", "palli", "padippu", "notebook", "tuition", "class"
    ]
  },
  {
    category: "Entertainment",
    words: [
      "movie", "cinema", "netflix", "prime", "game", "games",
      // Tanglish
      "padam", "padam ticket", "theatre", "theater", "park", "outing"
    ]
  }
];

const PAYMENT_RULES = [
  { value: "UPI", words: ["upi", "gpay", "google pay", "phonepe", "paytm"] },
  { value: "Credit Card", words: ["credit card", "creditcard"] },
  { value: "Debit Card", words: ["debit card", "debitcard"] },
  { value: "Card", words: ["card"] },
  { value: "Cash", words: ["cash"] },
  { value: "Bank Transfer", words: ["bank transfer", "neft", "imps", "rtgs"] }
];

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(text) {
  const now = new Date();
  const lower = text.toLowerCase();

  if (lower.includes("yesterday")) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday;
  }

  const match = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
  if (match) {
    const [, day, month, year] = match;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return now;
}

function detectAmount(text) {
  const normalized = text.replace(/,/g, "");
  const matches = normalized.match(/(?<![A-Za-z])\d+(?:\.\d{1,2})?(?![A-Za-z])/g);
  if (!matches) return null;

  const amounts = matches
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);

  if (amounts.length === 0) return null;
  return amounts[amounts.length - 1];
}

function detectType(text) {
  const lower = text.toLowerCase();
  const incomeWords = [
    "salary", "income", "received", "credited", "bonus", "freelance payment",
    "sambalam", "vaangune", "vanthathu"
  ];
  return incomeWords.some((word) => lower.includes(word))
    ? "income"
    : "expense";
}

function detectCategory(text, type) {
  if (type === "income") return "Income";

  const lower = text.toLowerCase();
  let bestCategory = "Other";
  let bestLength = 0;

  for (const rule of CATEGORY_RULES) {
    for (const word of rule.words) {
      if (lower.includes(word) && word.length > bestLength) {
        bestLength = word.length;
        bestCategory = rule.category;
      }
    }
  }

  return bestCategory;
}

function detectPaymentMethod(text) {
  const lower = text.toLowerCase();
  const matched = PAYMENT_RULES.find((rule) =>
    rule.words.some((word) => lower.includes(word))
  );
  return matched?.value || "Not specified";
}

export function parseExpense(text) {
  const rawText = String(text || "").trim();
  const amount = detectAmount(rawText);

  if (!rawText) {
    return { valid: false, error: "Enter an expense message." };
  }

  if (!amount) {
    return {
      valid: false,
      error: "I could not find an amount. Example: Lunch 150"
    };
  }

  const type = detectType(rawText);
  const date = parseDate(rawText);

  return {
    valid: true,
    amount,
    type,
    category: detectCategory(rawText, type),
    paymentMethod: detectPaymentMethod(rawText),
    description: rawText,
    dateKey: localDateKey(date),
    occurredAt: date.toISOString()
  };
}
